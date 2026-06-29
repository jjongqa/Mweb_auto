# Kurly QA Worker v1.0 Phase 1 설치 가이드

## ⚠️ Phase 1 현재 상태

이건 v1.0 의 *첫 번째 단계*예요. 지금은 **등록 + heartbeat 만** 동작.

| 기능 | 상태 |
|---|---|
| 워커 등록 | ✅ Phase 1 |
| 상태 표시 | ✅ Phase 1 |
| Job 받기 / 처리 | ❌ Phase 3 |
| 결과 저장 / 보고 | ❌ Phase 3 |
| 캔슬 / 재시작 | ❌ Phase 4 |

**Phase 1 만으로는 실제 자동화 안 됨**. 시연용으로 사용 X. v0.4b-cumulative 사용 권장.

## 사전 준비 (Phase 3 부터 필요, Phase 1 은 Node.js 만)

### 필수 (Phase 1)
- Node.js 18+
  ```bash
  node --version  # v18 이상
  ```

### Phase 3 부터 필수 (지금은 안 깔아도 됨)
- claude CLI + 본인 Claude Max 로그인
- Playwright MCP
- QA-Cowork 폴더 (prompts, knowledge 등)

## 설치

### 1. 워커 패키지 받기
종관님이 슬랙으로 `kurly-qa-worker-v1.0-phase1.zip` 공유.

```bash
unzip kurly-qa-worker-v1.0-phase1.zip -d ~/
cd ~/kurly-qa-worker-v1
npm install
```

### 2. 환경 설정
```bash
cp .env.example .env
```

`.env` 편집:
```bash
# 본인 PC 이름 (드롭다운에 이 이름으로 표시됨)
WORKER_NAME=jiho-mac

# 종관님 어드민 IP (변경되면 종관님이 슬랙에 공유)
CENTRAL_URL=http://172.20.39.127:3000

# 본인 PC 능력
WORKER_CAN_WEB=true
WORKER_CAN_APP=false
```

본인 PC 호스트네임 확인:
```bash
hostname  # 결과를 WORKER_NAME 으로 사용
```

### 3. 워커 시작
```bash
npm start
```

성공 시 출력:
```
[2026-05-15 ...] [info] ==========================
[2026-05-15 ...] [info] Kurly QA Worker v1.0 (Phase 1)
[2026-05-15 ...] [info] 워커 이름: jiho-mac
[2026-05-15 ...] [info] 중앙 서버: http://172.20.39.127:3000
[2026-05-15 ...] [info] ==========================
[2026-05-15 ...] [info] 중앙 등록 시도: ...
[2026-05-15 ...] [info] ✓ 등록 성공: 워커 'jiho-mac' 등록 성공
[2026-05-15 ...] [info] 워커 동작 중. Ctrl+C 로 종료.
```

**"✓ 등록 성공"** 보이면 Phase 1 동작 확인!

### 4. 종료
- `Ctrl+C` 로 종료
- 워커가 *꺼지면 1분 후* 중앙에서 자동으로 *꺼짐* 상태로 변경

## Phase 1 검증

종관님 어드민에서 확인:
```bash
curl http://172.20.39.127:3000/api/workers/list
```

응답에 본인 워커가 *대기 중* 상태로 표시되면 OK.

## 트러블슈팅

### "중앙 서버 연결 실패"
- 종관님 맥북이 켜져있는지 확인
- 사내망 동일한지 확인 (`ping 172.20.39.127`)
- 종관님 어드민 IP 변경됐는지 확인 (종관님께 문의)

### "워커 이름(name) 필수"
`.env` 의 `WORKER_NAME` 이 비어있음. 본인 식별 가능한 이름 입력.

## 다음 Phase 에서 추가될 것

- Phase 2: 종관님 어드민의 *새 실행 폼* 에 "실행 워커 선택" 드롭다운 추가
- Phase 3: 워커가 실제 Job 받아서 claude CLI 실행 (자동화 시작)
- Phase 4: 캔슬 전파, 재시작, 안정화
