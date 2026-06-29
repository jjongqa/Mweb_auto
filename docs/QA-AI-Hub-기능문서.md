# QA AI Hub (kurly-qa-admin) — 기능 문서

> AI 기반 QA 자동화 어드민. 기획서를 받아 **QA 설계 → TC 생성 → 기능/애드혹 테스트 자동 수행 → 결과·Jira 연동**까지 한 흐름으로 처리한다.
> 엔진은 Claude Code(`claude -p`) + Playwright/Mobile MCP. 작성 기준일 2026-06-24.

---

## 1. 개요

| 항목 | 내용 |
|---|---|
| 정체 | QA 자동화 어드민 (Next.js 15 단일 웹앱) + 분산 워커 |
| 핵심 가치 | 기획서 → TC → 실제 STG 환경 자동 검증 → 결과/버그 Jira 등록을 **사람 개입 최소화**로 |
| AI 엔진 | Claude Code 헤드리스(`claude -p`, Opus/Sonnet) — 워커 PC에서 실행 |
| 자동화 엔진 | Playwright(웹) / Mobile MCP(앱) — STG 브라우저 조작 |
| 상태 저장 | SQLite(임베디드 단일 파일) — 잡/워커/설정 메타데이터 |
| 접근 | 사내망(내부 IP), 무인증 (STG 한정) |

상단 메뉴: **🤖 AI 테스트**(QA설계·TC생성·기능테스트·애드혹) · 🧪 테스트 데이터 · 🕘 히스토리 · 📁 스위트 · 🪲 Jira · 🖥️ 워커 · 🎮 에이전트 · 📝 프롬프트 · 📖 가이드

---

## 2. 전체 아키텍처

```
[인바운드 — 내부망]                [코어 — 단일 인스턴스]              [통신 대상 — egress]
  QA팀 브라우저  ──:3000──▶   ┌──────────────────────────┐   ┌─ Anthropic API (claude) *워커
  외부 워커     ──HTTP API──▶ │ QA AI Hub (Next.js 15)    │   ├─ Kurly STG/QA API (테스트데이터)
                             │  · 웹 UI + API 라우트       │──▶├─ 내부 RDS mysql:3306 (VIP·3P)
                             │  · SQLite (잡/설정 메타)    │   ├─ kafka-ui REST:443 (3P 배송)
                             │  · 오케스트레이션           │   ├─ Google Drive (프롬프트 동기화)
                             └──────────────────────────┘   └─ Atlassian (Confluence·Jira)
                                       │ 잡 배분
                                       ▼
                             [워커 = PC] claude -p + Playwright/Mobile MCP
```

- **서버(관제탑)**: 웹/API/SQLite/오케스트레이션. 테스트데이터·Drive·Atlassian egress. (배포 시 `DISABLE_BUILTIN_WORKER` → claude 미실행)
- **워커**: 빌트인(어드민 호스트) + 외부(팀원 Mac). 각자 claude 로그인. 잡을 claim해 실행 후 결과 회신.
- 상세 egress·이관 사항은 인프라 요청서 / 별도 아키텍처 다이어그램 참조.

---

## 3. 핵심 흐름 — AI 테스트 4단계

```
기획서(Confluence/PDF/텍스트)
   │
   ├─▶ 🔬 QA 설계 ── 리스크/엣지/모호점 분석 ──┐
   │                                          ▼
   ├─▶ 🧬 TC 생성 ── 도메인 정책+스킬 → TC CSV ──┐ (설계 분석 주입 가능)
   │                                          ▼
   └─▶ 📋 기능 풀 테스트 ── TC CSV 자동 수행 ── PASS/FAIL/BLOCKED + 스크린샷
       🔍 애드혹 테스트 ── TC 없이 AI가 시나리오 도출 → 탐색 검증 → report.md
```

### 3.1 🔬 QA 설계 (`/qa-design`)
- 기획서를 **QA 관점**으로 먼저 분석: 핵심 정책 요약 · **리스크 등급(R1~R4)** · 리스크 영역 · 엣지/모호점 · 중점 검증 포인트.
- **개선 재생성**: 결과가 아쉬우면 피드백 지시로 다시 분석.
- **TC생성으로 보내기**: 대상 POC(시트분류) 선택 → 이 분석을 반영한 TC가 생성됨.

### 3.2 🧬 TC 생성 (`/tc-gen`)
- 입력: 기획서 또는 QA 설계 결과. + 도메인 **마스터 정책** + **TC 작성 스킬**(Drive 동기화).
- 출력: 표준 21컬럼 TC **CSV** (No·시트분류·Type·…·Pre-condition·Test Steps·Expected Result).
- **POC(시트분류) 다중 선택**: 대상 시스템/화면별로 TC 분류.
- **컬럼 밀림 자동 복구**: 모델이 빈 조건 컬럼을 빠뜨려 Expected Result가 밀리면 정규화로 복구.
- 완료 후 **기능테스트로 보내기**(자동 업로드) 또는 다운로드.

### 3.3 📋 기능 풀 테스트 (`/upload`)
- TC CSV 업로드 → 정의된 케이스를 **전부 자동 실행**.
- **POC별 잡 분할**: 시트분류 선택 시 POC별로 잡이 나뉘어 실행(앱→Mobile MCP, 웹→Playwright).
- 결과: 각 TC **PASS/FAIL/BLOCKED** + 스크린샷(FAIL 필수) + `summary.csv`.
- 실시간 진행률(`TC-{No}: PASS/FAIL/BLOCKED` 마커 집계), FAIL/BLOCKED 재실행(모델·우선순위 오버라이드).

### 3.4 🔍 애드혹 테스트 (`/adhoc`)
- TC 없이 **기획서 + 포커스 텍스트**만으로 AI가 시나리오 5~15개 도출 → 탐색적 검증.
- 출력: `summary.csv` + **`report.md`**(요약·발견 버그·의문점·범위·추천 액션).

---

## 4. 🎮 에이전트 오피스 — 멀티 분할/병렬 (`/agents`)

워커마다 "에이전트" 페르소나를 두고, **한 작업을 여러 에이전트가 나눠 병렬 처리 → 합본**.

- **메인 에이전트** = 오케스트레이터(어드민 로직): 분석·분할·배분·합본.
- **서브 에이전트** = 워커 PC에서 도는 `claude` 1개. 멀티면 N개 동시 실행.
- 구성: 워커별 **메인 1 + 설계/작성/수행 3그룹**(그룹마다 단일/멀티 토글, 이름·지시 편집).
- **자기 워커 자동 고정**(접속 IP 감지).

| 그룹 | 멀티 동작 |
|---|---|
| 🔬 설계 / ✍️ 작성 | **같은 기획서**를 에이전트별 지시(focus)대로 병렬 분석/작성 → 합본 (작성=CSV union+재넘버링) |
| ▶️ 수행 | TC를 **연속 범위 N등분**(예 39→13/13/13) → 병렬 수행 → **통합 summary.csv** 합산 |

- **진짜 동시 실행 = 워커 슬롯**: 수행 `WORKER_MAX_CONCURRENT`, 설계/작성 `WORKER_TCGEN_CONCURRENT`(기본 3). 슬롯<청크면 일부 순차 + 경고.
- 결과: 잡 상세 **그룹 합산** + 히스토리 **▶ 한 묶음 접힘** + 통합 CSV.
- 상세: [/guide/agents](../app/guide/agents/page.tsx) 가이드.

---

## 5. 🧪 테스트 데이터 생성 (`/test-data`)

테스트 사전 데이터를 **API 호출 또는 DB 직접**으로 N건 생성. 커머스/물류 BU 토글.

**커머스**: 회원/계정 · 멤버스(구독·해지예약·이용권) · **VIP/VVIP**(RDS 직접 UPSERT) · 쿠폰 · **쿠폰팩** · 상품(1P·3P) · 할인 · 프로모션 · 적립금/캐시 · **주문(쿠키리스)** · **혼합주문** · 상품후기 · **3P 배송상태**(kafka-ui REST + PARTNER3P 조회).

**물류**: KLS · 쿠를리로(kurlyro) · 쿠를리웍스 · TMS · 발주(PO/PO-v2/PO-capa) · 작업유형·작업검증 · 주문 · 1P배송.

- 대부분 **API(게이트웨이) 호출**. **직접 DB 쿼리는 2개뿐** — VIP 세팅(쓰기, stg-commerce-cms), 3P 배송조회(읽기, stg-commerce-thirdparty).
- 진행은 **SSE 스트림**으로 실시간 표시.

---

## 6. 🖥️ 워커 시스템 (`/workers`)

- **빌트인 워커**(`worker/index.js`, 어드민 호스트): DB 직접 + 잡 실행. `npm run worker`=동시 슬롯 3.
- **외부 워커**(`external-worker/`, 팀원 Mac): HTTP API로 잡 claim/결과/heartbeat. 별도 패키지(재배포 필요).
- 공통 런타임: `claude -p`(생성/설계/수행) + Playwright/Mobile MCP(브라우저).
- 안정성: 좀비 잡 회수 + Chromium cleanup, cancel ~2초 내 종료, 동시성 슬롯, 진행 마커 강제.
- **플릿 헬스**: 온라인/슬롯/하트비트 한 줄 표시. 구버전 워커 업데이트 배너(online 워커만).

---

## 7. 📝 프롬프트 / 날리지 (`/prompts`, Drive 동기화)

- TC 작성 스킬 · 도메인 마스터 정책 · 기능테스트 프롬프트가 **팀 공유 Google Drive에서 자동 동기화**.
- 잡 생성 시 admin이 base/도메인/CLAUDE/knowledge를 **inline 조립**해 워커에 주입 → 외부 워커도 Drive 최신본 사용(워커 키 불필요).
- 갱신 버튼으로 방금 고친 프롬프트 즉시 반영.

---

## 8. 🪲 Jira / Confluence 연동 (`/jira-settings`, `/guide/jira`)

- **워커별 Atlassian 토큰 1회 등록** → ① Confluence 기획서 **본문 자동 추출**(인증 페이지 HTML 방지) ② FAIL 건 **Jira 이슈 자동 등록**(reporter=본인).
- 실행자 이름 매칭으로 본인 토큰 사용. 토큰은 AES-256-GCM 암호화 저장(master.key).
- 사전 spec 검증: Confluence URL [검증] → 본문 미리보기 + 토큰/권한 즉시 확인.

---

## 9. 결과 관리

| 기능 | 경로 | 설명 |
|---|---|---|
| 🕘 히스토리 | `/history` | 최근 200건. **재실행·에이전트 멀티 분할은 ▶로 그룹 접힘**. 검색/상태/도메인/요청자 필터, 내 잡만 |
| 📁 회귀 스위트 | `/suites` | 자주 쓰는 잡 설정(파일·도메인·환경·모델·필터) 저장 → 한 번에 재실행 |
| 📊 결과 비교 | `/compare` | 여러 실행의 TC별 결과 나란히 비교(fix 전후 등), 바뀐 TC 주황 강조 |
| 📈 분석 | `/analytics` | 도메인/기간별 PASS율·실행시간·flaky 추이 대시보드 |
| 잡 상세 | `/jobs/[id]` | 결과 히어로(그룹이면 합산) · 진행 로그 · FAIL/BLOCKED 카드 · 재실행 · 스크린샷 · 잡 설정 컨텍스트 |

- **flaky 탐지**: 재실행 체인에서 PASS↔FAIL/BLOCKED 뒤집힌 TC 주황 배지.
- **duration**: 잡 완료 시 자동 기록 → 다음 잡 예상시간 추정에 활용.

---

## 10. 결과물 형식

- **`summary.csv`** (UTF-8 BOM): No · Priority · Type · TC Title · Test Step · Expected/Actual Result · Result · Notes · Screenshot. Notes는 비개발자용 완성된 한국어 문장.
- **`fail-detail.csv`**: FAIL 케이스만.
- **스크린샷**: `TC-{No}/` 하위 (PASS 생략 가능, FAIL 필수).
- **`report.md`** (애드혹): 요약·버그·의문점·범위·추천.
- 멀티 분할: **통합 summary.csv**(전체 합본, No 재넘버링).

---

## 11. 기술 스택 / 데이터 저장

- **런타임**: Next.js 15.0.3(App Router) · React 19 · TypeScript · Tailwind · `next start -p 3000`.
- **DB**: better-sqlite3 11.x(WAL), `data/qa-admin.db` — 잡/워커/에이전트/tc_gen/jira/스위트 등. EBS 영속·단일 인스턴스 전제(EFS 금지).
- **영속 파일**: `data/`(SQLite) · `uploads/`(TC·스펙) · `tc-gen-output/` · `results/`(30일 cleanup) · `_drive-backup/`.
- **시크릿**: `~/.config/kurly-qa/master.key`(토큰 복호화) · Drive 서비스계정 키. STG 자격증명은 단일 소스.
- **분산**: 빌트인 + 외부 워커. 잡 claim 원자성은 단일 프로세스 가정.

---

## 12. 용어

| 용어 | 뜻 |
|---|---|
| POC (시트분류) | 실행 대상 시스템/화면 분류 (컬리몰웹/앱, La-CMS, 파트너오피스 등) |
| 청크(chunk) | 멀티 수행 시 TC를 나눈 한 덩어리 (chunk_group_id로 묶임) |
| 합본/합산 | 멀티 분할 결과를 하나로 합친 것 |
| 핸드오프 | QA설계 → TC생성, TC생성 → 기능테스트로 결과를 넘기는 것 |
| 워커 슬롯 | 한 워커가 동시에 돌릴 수 있는 claude 수 |
| 빌트인/외부 워커 | 어드민 호스트 워커 / 팀원 PC 워커 |

---

_본 문서는 구현 기준 요약입니다. 단계별 사용법은 어드민 내 **📖 가이드** 페이지를, 인프라/이관은 인프라 요청서를 참조하세요._
