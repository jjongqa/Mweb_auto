# Worker Changelog

각 항목은 워커에 영향 가는 패치만 기록합니다. 어드민 측 UI/페이지 변경은 제외.
어드민 `/workers/install` 의 "재설치" 섹션이 이 파일 상단 N개 항목을 자동으로 표시합니다.

## v1.15.0 — 2026-06-26

- **claude stdout UTF-8 디코딩 수정 — 한글 깨짐(`�`) 제거.** `proc.stdout` 수집 시 청크마다 `chunk.toString()` 으로 독립 디코딩하던 것을 `setEncoding("utf8")` + 문자열 누적으로 변경 → 멀티바이트(한글) 글자가 청크 경계에서 잘려 U+FFFD(`�`)로 깨지던 현상 해결. TC생성 CSV(`runClaudeP`)와 기능테스트 stream-json 양쪽 적용. (실측: 작성멀티 재생성 시 "모바일 웹"→"모바일 �" 등 산발 깨짐) **재배포 권장.**

## v1.14.0 — 2026-06-26

- **한 머신 N병렬 하네스 실행(잡별 격리)** — 하네스 잡을 잡별 격리 cwd(`_jobs/<id>`: `.claude`/`references`/`CLAUDE.md` 심링크 + `_workspace`/`_inbox`/`.cache` 잡별 실폴더)에서 실행 → 공유 워크스페이스·`/tmp` 파싱캐시 충돌 제거. 동시 한도 `WORKER_HARNESS_CONCURRENT`(기본 **1**, 자원 안전 — 머신 여유 있을 때만 상향). 하네스 클론의 파싱 캐시도 `/tmp/ref_schemas.json` → cwd 상대 `.cache/`로 이동(harness.zip 재배포 시 반영). 잡 끝나면 격리 폴더 자동 정리.

## v1.13.0 — 2026-06-26

- **하네스(커머스+물류 TC생성 엔진) 지원** — admin 이 `__HARNESS__` 프롬프트로 보낸 TC생성 잡을, 이 워커가 로컬 하네스 클론(`KURLY_HARNESS_PATH`)을 `claude -p`(cwd=클론)로 실행 → 6단계 파이프라인(분석·정답파싱·생성·형식게이트·품질평가) → 산출 xlsx 를 python 어댑터로 admin CSV(커머스 21열/물류 13열 사인오프)로 변환해 회신. 진행 단계·품질 점수도 실시간 보고. ⚠️ **하네스 잡 실행은 `KURLY_HARNESS_PATH` + python3 deps(openpyxl/xlsxwriter/pyyaml/allpairspy)가 있어야 함** — `/workers/install` 재설치 시 하네스 zip 자동 다운로드 + deps 설치 + env 세팅. 미설치 워커가 하네스 잡을 claim 하면 실패(레거시 단순 TC생성은 정상). 하네스 잡은 공유 워크스페이스라 워커당 1건 직렬 실행.

## v1.9.0 — 2026-06-19

- **기능테스트/애드혹도 admin Drive 동기화 기반으로 실행** — 기존엔 워커가 자기 PC 로컬의 `prompts/`·`knowledge/`·`CLAUDE.md` 를 읽어 프롬프트를 조립 → 외부 워커는 admin 의 Drive 자동 동기화가 안 닿아 옛 로컬 파일을 썼다. 이제 admin 이 잡 생성 시 동기화된 내용을 **inline 컨텍스트**(`job.inlined_context`)로 박아 보내고, 워커는 그걸 그대로 사용. ⚠️ **이 버전부터 외부 워커도 기능테스트가 Drive 최신본으로 돌아갑니다.** 신규 워커는 로컬에 프롬프트가 없어도 동작(admin 이 내용 제공). 구버전(v1.8) 워커는 자기 로컬 파일 사용(동작은 하나 Drive 최신 미반영) → **업데이트 권장**. inline 이 없는 잡(구 admin)은 자동으로 기존 로컬 방식 폴백.
- **워커 버전 heartbeat 보고** — heartbeat 에 `version` 포함. admin 이 구버전 워커를 감지해 **그 워커 PC 메인페이지에 업데이트 배너**를 띄움(최신 워커는 안 보임). 구 v1.8 은 버전 미보고 → admin 이 구버전으로 간주해 배너 노출.

## v1.8.0 — 2026-06-17

- **TC 설계/작성 분배 처리 추가** — 기존엔 어드민 서버 1대에서만 TC생성/QA설계를 돌렸는데, 이제 워커가 `GET /api/tc-gen/next` 로 잡을 가져와 **각 워커의 로컬 claude** 로 실행(`claude -p`) 후 `POST /api/tc-gen/:id/result` 로 회신. 기능테스트 수행과 동일한 분산 구조 — 본인이 만든 TC생성이 본인 워커의 claude 토큰으로 돌아감. ⚠️ **이 버전으로 업데이트해야 TC생성 잡을 가져갑니다** (구버전 워커는 기능테스트만 처리). 어드민은 조립/CSV추출만 담당.

## v1.7.6 — 2026-06-12

- **동시 처리 슬롯 default 1 → 3** — 한 워커가 동시 3개 잡 처리. 어드민 워커 페이지에 0/3 로 표시. 큐가 빈 경우엔 영향 X, 여러 잡 동시 pending 일 때 처리량 3배. PC 사양 안 좋으면 `WORKER_MAX_CONCURRENT=1` 또는 `=2` 로 env 조정 가능 (잡당 RAM 1~2GB + Chrome 1개 spawn).
- **좀비 Chromium 청소 강화 (BFS)** — 잡 캔슬 시 Playwright MCP 가 띄운 Chromium 이 좀비로 남던 문제. 기존엔 프로세스 그룹 kill 만 해서 `--isolated` 모드(/var/folders/.../mcp-chrome-*) 의 손자/증손자 chromium 못 잡음 → ps -ax 로 PID 트리 BFS 수집해서 전부 SIGKILL 추가.

## v1.7.5 — 2026-06-10

- **잡별 모델 선택** — 어드민 폼에서 잡 만들 때 Claude 모델(Sonnet 4.6 / Opus 4.7) 선택 가능. 워커는 `job.claude_model` 있으면 그것 사용, 없으면 워커 env default. 까다로운 케이스만 Opus 사용 가능.

## v1.7.4 — 2026-06-10

- **속도 최적화** — 워커 prompt 단호하게 강화. TodoWrite 호출 전면 금지, PASS screenshot 금지, 같은 selector 재시도 금지(즉시 evaluate 우회), 도구 호출 상한(단순 ≤5 / 일반 ≤10 / 복잡 ≤15) 명시. 격려 모드도 한 TC 10회 상한. 도구 호출 30~50% 감소 예상.

## v1.7.3 — 2026-06-10

- **모델 통일** — `--model claude-sonnet-4-6` 명시. 워커 PC 마다 default 모델이 달라 속도/품질 편차 컸던 문제 해소. Opus 4.6/4.7/4.8 → Sonnet 4.6 (2~3배 빠름, 토큰 비용 1/5). 필요시 `CLAUDE_MODEL` env 로 override.

## v1.7.2 — 2026-06-10

- **버그 수정** — close handler 의 summary.csv 카운트 집계가 quoted field 안의 콤마를 잘못 분리하던 문제. 단순 `split(",")` → RFC 4180 호환 `parseSimpleCsvRow` 로 교체. 결과적으로 PASS/FAIL/BLOCKED 가 0 으로 잘못 보고되는 회귀 제거.

## v1.7.1 — 2026-06-10

- 멀티 동시 처리 (multi-concurrency) — `WORKER_MAX_CONCURRENT` env (기본 1). 한 워커가 동시 N잡 처리. PoC 병렬 검증용.
- heartbeat status — `busy` / `online` 을 `activeJobs > 0` 기준으로 판정

## v1.7.0 — 2026-06-10

- 끼어들기 메시지 지원 — Claude CLI `--input-format stream-json` 모드로 잡 진행 중에도 사용자가 추가 명령 push 가능
- Mweb (모바일 웹) 지원 — Playwright MCP `--device "iPhone 15"` 자동 emulation
- `--mcp-config` 잡별 격리 — platform 에 맞춰 `_mcp.json` 동적 작성 후 `--strict-mcp-config` 로 어드민/사용자 mcp 설정과 분리
- 캔슬 회귀 패치 — stream-json input 모드에서 SIGTERM 만으로 죽지 않던 좀비 방지를 위해 `stdin.end()` 먼저 + polling/timer cleanup
- HTTP polling 으로 끼어들기 메시지 가져옴 — `GET /api/jobs/:id/messages/next`

## v1.0.0-phase3b — 2026-05 (이전)

- 분산 워커 초기 — 등록 / heartbeat / 잡 클레임 / MOCK & REAL 처리 / 결과 업로드
