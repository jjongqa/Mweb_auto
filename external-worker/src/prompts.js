// 프롬프트 생성 — admin-v1/worker/index.js 와 동일. drift 주의.
// (장기적으로 공유 패키지로 통합 권장)

const path = require("node:path");
const fs = require("node:fs");
const { findRelevantKnowledge } = require("./knowledge-matcher");

const DOMAIN_FILE_MAP = {
  "멤버스": { web: "base-prompt-멤버스.md", app: "base-prompt-멤버스-app.md" },
  "회원":   { web: "base-prompt-회원.md",   app: "base-prompt-회원-app.md" },
  "3P":     { web: "base-prompt-3P.md",     app: null },
};

const DOMAIN_KNOWLEDGE_MAP = {
  "멤버스": "멤버스", "회원": "회원", "3P": "3P",
  "상품": "상품", "홈전시추천": "홈전시추천", "검색광고": "검색광고",
  "주문": "주문", "결제": "결제", "클레임": "클레임", "프로모션": "프로모션",
};

function buildRuntimeTestDataHandoffBlock(adminUrl, jobId) {
  const baseUrl = (adminUrl || "http://localhost:3000").replace(/\/$/, "");
  return `
## 🧪 수행 중 테스트데이터 에이전트 핸드오프

테스트 데이터는 TC 생성 직후 미리 추정해서 만들지 않는다. **수행 중 실제로 데이터가 없어서 TC가 막히는 순간에만** 아래 절차를 사용한다.
데이터 요청은 중앙 큐(${baseUrl}/api/data-requests)에 등록하고, 테스트데이터 큐 워커가 하나씩 순차 처리한다.

### A. 수행 에이전트가 데이터 필요를 발견했을 때
- 기존 데이터로 TC를 계속할 수 있는지 먼저 확인한다.
- 회원/주문/상품/쿠폰/프로모션/멤버십/배송/클레임/리뷰/물류 등 특정 상태 데이터가 필요해서 진행 불가하면, 해당 TC만 멈추고 테스트데이터 에이전트에게 요청한다.
- 3P OpenAPI 콘솔은 무조건 제외 대상이다. "3P" 키워드는 상품등록 데이터(/test-data/product-3p 등) 맥락으로만 해석한다.
- 운영(production) 데이터 생성/수정은 절대 금지. STG/QA 환경에서만 처리한다.

요청 형식:
\`\`\`
[DATA_AGENT_REQUEST]
TC: TC 번호와 제목
Need: 필요한 데이터 종류와 상태
Reason: 현재 데이터로 수행할 수 없는 이유
Inputs: 알고 있는 입력값 또는 제약조건
PreferredTool: 사용할 수 있는 테스트 데이터 페이지/API 후보, 모르면 unknown
\`\`\`

큐 등록 예시:
\`\`\`bash
curl -s -X POST "${baseUrl}/api/data-requests" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceJobId": "${jobId || "현재 잡 ID"}",
    "sourceAgent": "러너/대시/스프린트 등 현재 수행 에이전트명",
    "tcRef": "TC-번호와 제목",
    "need": "필요한 데이터 종류와 상태",
    "reason": "현재 데이터로 수행 불가한 이유",
    "inputs": {"known": "알고 있는 값"},
    "preferredTool": "사용 후보 또는 unknown"
  }'
\`\`\`

등록 응답의 \`request.id\`를 저장하고 아래처럼 조회한다. status가 \`ready\`가 될 때까지 10~20초 간격으로 기다리되, 10분을 넘기면 해당 TC는 BLOCKED 처리한다.
\`\`\`bash
curl -s "${baseUrl}/api/data-requests/{request.id}"
\`\`\`

### B. 테스트데이터 에이전트 역할
- 요청을 받으면 필요한 데이터 종류를 확정하고, 테스트 데이터 페이지/API를 사용해 최소 데이터만 생성한다.
- 3P OpenAPI 콘솔은 사용하지 않는다. 3P는 상품등록/상품상세 데이터 준비로만 처리한다.
- 생성 전 필수 입력값, 권한, 계정, 승인 조건이 부족하면 임의로 만들지 말고 BLOCKED로 반환한다.
- 데이터 생성 후 반드시 조회/화면/API 등 가능한 방식으로 검증한다.

응답 형식:
\`\`\`
[DATA_AGENT_RESULT]
TC: TC 번호와 제목
Status: READY | BLOCKED | FAILED
DataContext:
- key: value
Verification: 생성 데이터 검증 방법과 결과
Notes: 수행 에이전트가 이어서 쓸 경로/주의점
\`\`\`

### C. 다시 수행 에이전트로 복귀
- Status=READY면 DataContext를 사용해 같은 TC를 이어서 수행한다.
- Status=BLOCKED/FAILED면 해당 TC를 BLOCKED 처리하고, 구체적 이유를 Notes와 summary.csv에 남긴 뒤 다음 TC로 이동한다.
- 모든 데이터 생성은 필요한 TC 단위로만 수행한다. 전체 TC에 대한 사전 일괄 생성 금지.
`;
}

function resolvePrompts(QA_COWORK_HOME, domain, platform) {
  const promptsDir = path.join(QA_COWORK_HOME, "prompts");

  let baseDir = path.join(promptsDir, "베이스");
  if (!fs.existsSync(baseDir)) {
    const altBase = path.join(promptsDir, "base");
    if (fs.existsSync(altBase)) baseDir = altBase;
  }
  const baseFile = platform === "app" ? "base-prompt-app.md" : "base-prompt-Web.md";
  const basePromptPath = path.join(baseDir, baseFile);

  const map = DOMAIN_FILE_MAP[domain];
  let domainPromptPath = null;
  let isFallback = false;

  function findDomainPrompt(domainFile) {
    if (!domainFile) return null;
    const candidates = [
      path.join(promptsDir, domainFile),
      path.join(baseDir, domainFile),
      path.join(promptsDir, "도메인", domainFile),
    ];
    for (const c of candidates) { if (fs.existsSync(c)) return c; }
    return null;
  }

  if (map) {
    const domainFile = platform === "app" ? map.app : map.web;
    const found = findDomainPrompt(domainFile);
    if (found) domainPromptPath = found;
    else isFallback = true;
  } else {
    isFallback = true;
  }

  // knowledge 폴더 — knowledge/{commerce|logistics}/{도메인}(중첩) 우선, 없으면 knowledge/{도메인}(평면, 레거시).
  // BU 판별: 폴더명이 "물류"로 시작하면 logistics, 아니면 commerce. (admin/빌트인 워커와 동일 규칙 — drift 주의)
  const knowledgeFolder = DOMAIN_KNOWLEDGE_MAP[domain] || domain;
  const kgParent = knowledgeFolder.startsWith("물류") ? "logistics" : "commerce";
  const kgNested = path.join(QA_COWORK_HOME, "knowledge", kgParent, knowledgeFolder);
  const knowledgeFolderPath = fs.existsSync(kgNested) ? kgNested : path.join(QA_COWORK_HOME, "knowledge", knowledgeFolder);
  if (!fs.existsSync(knowledgeFolderPath)) {
    try { fs.mkdirSync(knowledgeFolderPath, { recursive: true }); } catch (_) {}
  }

  return { domainPromptPath, basePromptPath, knowledgeFolderPath, isFallback };
}

function buildClaudeMessage(QA_COWORK_HOME, input) {
  const { domain, platform, qaEnv, taskName, tcFiles, resultDirAbsPath, resolution, filterDesc, additionalInstructions, specUrl, specFilename, specText } = input;
  const files = Array.isArray(tcFiles) && tcFiles.length > 0
    ? tcFiles
    : (input.tcCsvAbsPath ? [{ path: input.tcCsvAbsPath, filename: path.basename(input.tcCsvAbsPath) }] : []);
  const tcListBlock = files.length === 1
    ? `- TC CSV 파일: ${files[0].path}`
    : `- TC CSV 파일 (${files.length}개, 순서대로 처리):\n${files.map((f, i) => `    ${i + 1}. ${f.path}  (원본명: ${f.filename})`).join("\n")}\n  → 각 파일을 순서대로 끝까지 실행하고, **모든 결과를 통합한 단일 ${resultDirAbsPath}/summary.csv** 한 파일에 누적 기록.\n  → No 컬럼은 파일 간 충돌 시 \`<파일인덱스>-<원본No>\` 형식으로 유니크하게 (예: 2-15).`;
  const platformKor = platform === "app" ? "앱"
    : platform === "mweb" ? "모바일 웹"
    : "데스크톱 웹";
  const envKor = qaEnv === "stg" ? "기본 STG" : qaEnv.toUpperCase();
  const baseHost = qaEnv === "stg" ? "stg.kurly.com" : `${qaEnv}.stg.kurly.com`;

  // v1.7 mweb 분기: Playwright MCP 가 iPhone 15 device emulation 으로 떠있음 (어드민이 --device 지정).
  const mwebBlock = platform === "mweb" ? `
## 📱 모바일 웹(Mweb) 검증 — Playwright iPhone 15 emulation 자동 적용됨

어드민이 Playwright MCP 를 \`--device "iPhone 15"\` 옵션으로 시작 — UA / viewport / DPR / touch 모두 모바일.
별도 \`browser_resize\` 나 UA 변경 코드 **불필요**.

### 모바일 관점 검증 포인트
1. **모바일 레이아웃 표지 확인** — 햄버거 메뉴 / 바텀 네비 / 1열 카드 / 모달 풀스크린. 데스크톱 그리드 (3~4열) 나오면 사이트 UA 인식 실패 — \`m-${qaEnv === "stg" ? "stg" : qaEnv + ".stg"}.kurly.com\` 등 모바일 도메인 우회.
2. **터치 인터랙션** — \`browser_click\` 이 touchstart/touchend 디스패치.
3. **모바일 전용 시나리오** — 한 손 조작 / 회전 / 모달 닫기 제스처 등.
4. **스크린샷** — 캡처가 모바일 사이즈 (390x844) 로 찍힘 확인.

` : "";
  const basePromptRel = path.relative(QA_COWORK_HOME, resolution.basePromptPath);
  const knowledgeRel = path.relative(QA_COWORK_HOME, resolution.knowledgeFolderPath);
  const filterBlock = filterDesc ? `\n## 실행 범위 필터\n${filterDesc}\n` : "";

  let domainPromptLine;
  if (resolution.domainPromptPath) {
    const domainPromptRel = path.relative(QA_COWORK_HOME, resolution.domainPromptPath);
    domainPromptLine = `- ${domainPromptRel} (도메인 전용)`;
  } else {
    domainPromptLine = `- (도메인 전용 베이스 프롬프트 없음 — fallback 모드. prompts/ 폴더의 ${domain} 관련 .md 파일이 있으면 모두 읽고, knowledge/${DOMAIN_KNOWLEDGE_MAP[domain] || domain}/ 의 모든 .md 파일을 참고)`;
  }

  // admin 이 Drive 동기화 기반으로 base/도메인/CLAUDE/knowledge 내용을 inline 해 보냈으면(v1.9+),
  // 로컬 파일 매칭/참조 대신 그 내용을 그대로 사용 → 외부 워커도 Drive 최신본. 없으면 기존 로컬 방식.
  const inlined = input.inlinedContext;
  let coreKnowledgeBlock = "";
  if (!inlined) {
    try {
      const matched = findRelevantKnowledge(resolution.knowledgeFolderPath, taskName, QA_COWORK_HOME);
      if (matched.length > 0) {
        const top = matched.slice(0, 5);
        const lines = top.map((m, i) => {
          const sizeKb = (m.size / 1024).toFixed(1);
          const marker = i === 0 ? " ⭐ (가장 핵심)" : "";
          return `- ${m.relPath} (${sizeKb} KB)${marker}`;
        });
        coreKnowledgeBlock = `\n## 📚 이 과제의 핵심 참고 자료 (반드시 시작 전 정독)\n\n과제명 "${taskName.replace(/__RETRY_ENCOURAGE__/g, "").trim()}" 기반으로 자동 추출:\n\n${lines.join("\n")}\n\n**작업 시작 전 위 ${top.length}개 파일은 반드시 정독.**\n`;
      }
    } catch (_) {}
  }

  // 참조 자료 블록 — inline 모드면 내용 임베드, 아니면 파일 경로 참조.
  const referenceBlock = inlined && inlined.trim()
    ? `## 참조 자료 (Drive 최신본 — 시작 전 반드시 숙지)\n\n아래는 공통 베이스 프롬프트 + 도메인 프롬프트 + 전역 규칙(CLAUDE.md) + 이 도메인 knowledge 전문입니다. **별도 파일 읽기 불필요 — 아래 내용을 그대로 따르세요.**\n\n${inlined.trim()}\n\n- ⚠️ 위 자료와 아래 "검증 정확성 vs 속도 균형" 충돌 시 속도 블록이 우선`
    : `## 참조 프롬프트\n- ${basePromptRel} (공통 베이스)\n${domainPromptLine}\n- ${knowledgeRel}/ 폴더의 모든 .md 파일을 시작 전 반드시 읽기\n- CLAUDE.md의 모든 규칙을 따른다\n- ⚠️ base-prompt 와 위 "검증 정확성 vs 속도 균형" 충돌 시 **위 블록이 우선**`;

  let specBlock = "";
  if ((specText && specText.trim()) || specUrl) {
    const parts = [];
    if (specUrl) parts.push(`원문 URL: ${specUrl}`);
    if (specFilename) parts.push(`첨부 파일: ${specFilename}`);
    const meta = parts.length ? parts.join(" / ") + "\n\n" : "";
    const body = specText && specText.trim() ? specText.trim() : "(본문 미추출 — 위 URL을 사람이 직접 참고)";
    specBlock = `\n## 📎 기획 문서 (이번 과제 참고용)\n\n${meta}${body}\n\n> TC가 모호한 경우 기획서에 명시된 사양을 우선. 기획서 vs 동작 차이는 FAIL 처리.\n`;
  }

  let additionalBlock = "";
  if (additionalInstructions && additionalInstructions.trim()) {
    additionalBlock = `\n## 📝 추가 지시사항 (최우선 적용)\n\n${additionalInstructions.trim()}\n`;
  }

  const ENCOURAGEMENT_MARKER = "__RETRY_ENCOURAGE__";
  let cleanTaskName = taskName;
  let encouragementBlock = "";
  if (taskName && taskName.includes(ENCOURAGEMENT_MARKER)) {
    cleanTaskName = taskName.replace(ENCOURAGEMENT_MARKER, "").trim();
    encouragementBlock = `\n## ⚠️ 재실행 격려 — 미리 한계 선언 금지\n\n이전 BLOCKED 케이스 재시도. knowledge 다시 정독하고 다른 방법(다른 selector, page.evaluate, URL 직접 진입, 다른 시나리오 변형) 시도 후 정말 안 될 때만 BLOCKED.\n\n### ⏱ 격려 모드 시도 상한 (단호)\n- **한 TC 당 최대 10회 도구 호출** — 그 안에서 우회 시도 다 해본다.\n- 10회 초과 시 BLOCKED 인정하고 즉시 다음 TC 로. 한 TC 만 붙들고 있지 마.\n- 격려는 *깊이* 가 아니라 *다양성* — 5가지 방법을 5회 안에 다 시도하는 게 핵심.\n`;
  }

  return `${domain} 도메인 TC를 ${platformKor}으로 ${envKor} 환경에서 돌려줘.
${mwebBlock}${additionalBlock}${specBlock}${encouragementBlock}${coreKnowledgeBlock}${buildRuntimeTestDataHandoffBlock(input.adminUrl, input.jobId)}
## 🎯 검증 정확성 vs 속도 균형 (최우선)

이 작업은 **어드민 자동 실행 모드**입니다. 사용자 가이드 없음.

### ⛔ 절대 깨지 말 것
- **NO BATCH PASS**: 각 TC 개별 실행 후 결과 기록. "위와 동일", "동일 패턴 PASS" 금지.
- **FAIL 시 스크린샷 필수**.
- base-prompt 의 검증 정확성 규칙 모두 따른다.

### 🚦 속도 최우선 규칙 (단호 적용)
1. **TodoWrite 호출 전면 금지** — 아래 "진행률 보고"의 한 줄 결과 마커로 진행률 충분.
2. **PASS 케이스 screenshot 호출 금지** — accessibility tree(snapshot) 로 판정. screenshot 은 FAIL/BLOCKED 만.
3. **같은 상태 재확인 금지** — 동일 페이지 snapshot/evaluate 2번 이상 금지.
4. **같은 selector 재시도 금지** — 1회 실패 시 즉시 evaluate 로 JS 직접 우회.
5. **도구 호출 상한** — 단순 TC ≤5회 / 일반 ≤10회 / 복잡(결제·풀사이클) ≤15회. 초과 시 BLOCKED + 즉시 다음 TC.
6. 풀 사이클 가이드는 TC 가 명시 요구할 때만.

### 📊 속도 가이드라인 (실측 기준)
- 단순 TC: 30초~1분 (≤5회)
- 일반 TC: 1~2분 (≤10회)
- 복잡 TC: 3~5분 (≤15회)
- 5분 초과 또는 호출 상한 초과 → BLOCKED + 즉시 다음 TC (추론 PASS 절대 금지)

### 🧱 BLOCKED 최후 판정 규칙

BLOCKED는 사람이 봐도 "지금 자동 수행을 계속할 수 없다"가 명확할 때만 쓴다.
selector 탐색 실패, 클릭 실패, 일시 로딩 지연, 로그인 상태 불확실, 팝업/모달 가림, 현재 페이지 불일치만으로 즉시 BLOCKED 처리하지 않는다.

BLOCKED 처리 전 체크리스트:
1. 현재 URL이 TC 대상 화면인지 확인했다.
2. 로그인 상태가 TC 전제조건과 맞는지 확인했다.
3. 팝업/모달/배너가 주요 버튼을 가리지 않는지 확인했다.
4. 화면 로딩이 끝났는지 확인했다.
5. 동일 selector 반복 대신 대체 selector를 1회 시도했다.
6. 클릭/입력이 실패한 경우 evaluate 우회를 1회 시도했다.
7. TC 사전조건 자체가 맞지 않으면 복구 가능한지 판단했다.
8. 사람/권한/데이터/기간/환경이 필요하다고 명확할 때 최종 BLOCKED 처리했다.

BLOCKED 기록 시 반드시 아래 사유 코드 중 하나를 Notes 또는 사유 문장에 포함한다.

진짜 차단 코드:
- [BLOCKED_DATA_REQUIRED] 필요한 테스트 데이터가 없음
- [BLOCKED_PERMISSION_REQUIRED] 계정/권한 부족
- [BLOCKED_ENV_EXPIRED] 프로모션/이벤트/기간 만료
- [BLOCKED_EXTERNAL_DEPENDENCY] 외부 시스템/배치/승인 대기
- [BLOCKED_MANUAL_APPROVAL_REQUIRED] 사람 승인/수동 조치 필요

재시도 후보 코드:
- [BLOCKED_RETRY_SELECTOR] selector/요소 탐색 실패
- [BLOCKED_RETRY_TIMEOUT] 일시 로딩/응답 지연
- [BLOCKED_RETRY_LOGIN_STATE] 로그인/세션 상태 꼬임
- [BLOCKED_RETRY_OVERLAY] 팝업/모달/배너 가림
- [BLOCKED_RETRY_STATE_MISMATCH] 화면/데이터 상태가 TC 전제와 다름

재시도 후보 코드는 체크리스트와 1회 복구 시도 후에도 실패할 때만 BLOCKED로 남긴다.
예: \`TC-12: BLOCKED — [BLOCKED_RETRY_OVERLAY] 앱 설치 유도 팝업이 장바구니 버튼을 가려 클릭할 수 없습니다.\`

---

## 실행 정보
${tcListBlock}
- 환경: ${envKor} (${baseHost})
- 도메인: ${domain}
- 플랫폼: ${platformKor}
- 과제명: ${cleanTaskName}
- 결과 저장 위치: ${resultDirAbsPath}
${filterBlock}
${referenceBlock}

## 결과 출력 형식
${resultDirAbsPath} 폴더 안에 다음 파일들을 생성해줘:
- summary.csv (UTF-8 BOM, 컬럼: No, Priority, Type, TC Title${platform === "app" ? ", Platform" : ""}, Test Step, Expected Result, Actual Result, Result, Notes, Screenshot)
- fail-detail.csv (UTF-8 BOM, FAIL 케이스만)
- TC-{No}/ 하위에 케이스별 스크린샷 (PASS 는 생략 가능, FAIL 은 필수)

## 🟢 진행률 보고 (필수 — 라이브 진행률 집계에 직결)
- **각 TC 판정을 끝낼 때마다 즉시, 독립된 한 줄로** 다음 형식 중 하나만 정확히 출력:
  - \`TC-{No}: PASS\`  /  \`TC-{No}: FAIL — 사유\`  /  \`TC-{No}: BLOCKED — 사유\`
  - 예: \`TC-28: PASS\` , \`TC-30: FAIL — 배송비 0원 미표시\`
- ⛔ 서술 문장("TC-28 결과 확인 완료", "확인됨" 등)으로 **대체 금지**. PASS/FAIL/BLOCKED 단어가 그 줄에 없으면 어드민 진행률이 **0으로 멈춰** 보인다.
- 판정 직후 **즉시 1줄** (요약을 마지막에 몰아 출력 X). 한 TC = 정확히 한 줄의 결과 마커.

## 주의
- 운영(production) 절대 접근 금지. STG 전용.
- NO BATCH PASS — 모든 TC 개별 실행.
`;
}

function buildAdhocMessage(QA_COWORK_HOME, input) {
  const { domain, platform, qaEnv, taskName, resultDirAbsPath, resolution, additionalInstructions, specUrl, specFilename, specText, adhocFocus } = input;
  const platformKor = platform === "app" ? "앱"
    : platform === "mweb" ? "모바일 웹"
    : "데스크톱 웹";
  const envKor = qaEnv === "stg" ? "기본 STG" : qaEnv.toUpperCase();
  const baseHost = qaEnv === "stg" ? "stg.kurly.com" : `${qaEnv}.stg.kurly.com`;

  // v1.7 mweb (애드혹) — Playwright iPhone 15 emulation 자동 적용
  const mwebBlock = platform === "mweb" ? `
## 📱 모바일 웹(Mweb) 애드혹 — Playwright iPhone 15 emulation 자동 적용됨

어드민이 \`--device "iPhone 15"\` 옵션으로 시작 — UA/viewport/DPR/touch 모두 모바일.
별도 resize / UA 설정 **불필요**.

### 모바일 관점 시나리오 필수 포함
- 햄버거 메뉴 / 바텀 네비 / 1열 카드 / 모달 풀스크린 UX 검증
- 한 손 조작 / 가로↔세로 회전 / 스와이프 제스처 시나리오
- 데스크톱 그리드가 나오면 UA 인식 실패 — \`m-${qaEnv === "stg" ? "stg" : qaEnv + ".stg"}.kurly.com\` 모바일 도메인 우회

` : "";
  const basePromptRel = path.relative(QA_COWORK_HOME, resolution.basePromptPath);
  const knowledgeRel = path.relative(QA_COWORK_HOME, resolution.knowledgeFolderPath);

  const inlined = input.inlinedContext;
  let domainPromptLine;
  if (resolution.domainPromptPath) {
    const domainPromptRel = path.relative(QA_COWORK_HOME, resolution.domainPromptPath);
    domainPromptLine = `- ${domainPromptRel} (도메인 전용)`;
  } else {
    domainPromptLine = `- (도메인 전용 베이스 프롬프트 없음 — knowledge/${DOMAIN_KNOWLEDGE_MAP[domain] || domain}/ 의 모든 .md 파일을 참고)`;
  }

  // 참조 자료 블록 — inline(v1.9+) 이면 내용 임베드, 아니면 파일 경로 참조.
  const referenceBlock = inlined && inlined.trim()
    ? `## 참조 자료 (Drive 최신본 — 시작 전 반드시 숙지)\n\n아래는 공통 베이스 프롬프트 + 도메인 프롬프트 + 전역 규칙(CLAUDE.md) + 이 도메인 knowledge 전문입니다. **별도 파일 읽기 불필요 — 아래 내용을 그대로 따르세요.**\n\n${inlined.trim()}`
    : `## 참조 프롬프트\n- ${basePromptRel} (공통 베이스)\n${domainPromptLine}\n- ${knowledgeRel}/ 폴더의 모든 .md 파일을 시작 전 반드시 읽기\n- CLAUDE.md 의 모든 규칙을 따른다`;

  let specBlock = "";
  if ((specText && specText.trim()) || specUrl) {
    const parts = [];
    if (specUrl) parts.push(`원문 URL: ${specUrl}`);
    if (specFilename) parts.push(`첨부 파일: ${specFilename}`);
    const meta = parts.length ? parts.join(" / ") + "\n\n" : "";
    const body = specText && specText.trim() ? specText.trim() : "(본문 미추출 — 위 URL을 사람이 직접 참고)";
    specBlock = `\n## 📎 기획 문서 (애드혹 테스트의 기준)\n\n${meta}${body}\n`;
  }

  let focusBlock = "";
  if (adhocFocus && adhocFocus.trim()) {
    focusBlock = `\n## 🎯 포커스 영역 (요청자가 집중 검증을 원하는 부분)\n\n${adhocFocus.trim()}\n\n> 위 포커스 영역을 우선으로 시나리오를 만들고, 시간이 남으면 일반 탐색도 진행해.\n`;
  }

  let additionalBlock = "";
  if (additionalInstructions && additionalInstructions.trim()) {
    additionalBlock = `\n## 📝 추가 지시사항 (최우선 적용)\n\n${additionalInstructions.trim()}\n`;
  }

  return `${domain} 도메인 ${platformKor} (${envKor}) 환경에서 **애드혹 테스트** 진행.
${mwebBlock}${additionalBlock}${specBlock}${focusBlock}
## 🎯 애드혹 테스트란?
미리 정의된 TC 없이, 기획 문서 + QA 직관으로 **탐색적** 검증.

### 진행 방식
1. **시나리오 도출** — 기획서 + knowledge 읽고 5~15개 도출. 정상/엣지/부정/회귀 균형.
2. **순서대로 실행** — \`TC-N\` 번호, PASS/FAIL/BLOCKED 판정.
3. **버그/의문점 기록** — 재현 단계 + 스크린샷.

### 출력 (반드시 둘 다 생성)
**${resultDirAbsPath}/summary.csv** (UTF-8 BOM, 컬럼: No, Priority(추정), Type(정상/엣지/부정/회귀), TC Title, Test Step, Expected Result, Actual Result, Result, Notes, Screenshot)

**${resultDirAbsPath}/report.md** (마크다운):
- ## 요약 — 시나리오 N건, PASS X / FAIL Y / BLOCKED Z
- ## 발견된 버그 — [심각도] 제목 + 재현 + 기대/실제 + 스크린샷
- ## 의문점 / 추가 검증 필요
- ## 테스트 범위 — 다룬 / 못 다룬
- ## 추천 다음 액션

### 진행 상황 표준출력 (필수 — 라이브 진행률 집계에 직결)
- 각 시나리오 판정 직후 **즉시, 독립된 한 줄로** \`TC-{N}: PASS\` / \`TC-{N}: FAIL — 사유\` / \`TC-{N}: BLOCKED — 사유\` 중 하나만 출력.
- ⛔ 서술("확인 완료" 등)로 대체 금지 — PASS/FAIL/BLOCKED 단어가 그 줄에 없으면 어드민 진행률이 0으로 멈춰 보인다.

---

## 환경 정보
- 환경: ${envKor} (${baseHost})
- 도메인: ${domain}
- 플랫폼: ${platformKor}
- 과제명: ${taskName || "(미지정)"}
- 결과 저장 위치: ${resultDirAbsPath}

${referenceBlock}

## 주의
- 운영(production) 절대 접근 금지. STG 전용.
- 5~15 시나리오, 30분 이내 권장.
- FAIL 시 스크린샷 필수. 추론 PASS 금지.
`;
}

module.exports = { resolvePrompts, buildClaudeMessage, buildAdhocMessage, DOMAIN_KNOWLEDGE_MAP };
