// 백그라운드 워커 v0.3
// 추가: 중단 처리, TC 필터(P1만/범위), started_at/finished_at 시각 기록
// v1.0 Phase 3: DISABLE_BUILTIN_WORKER=true 면 즉시 종료 (외부 워커만 사용)

const Database = require("better-sqlite3");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { findRelevantKnowledge } = require("../shared/knowledge-matcher");
const { splitCsvLines: sharedSplitCsvLines, parseCsvRow: sharedParseCsvRow } = require("../shared/csv-parser");

// .env.local 로드 — next dev 는 자동으로 읽지만 raw node 빌트인 워커는 안 읽음.
// 하네스 env(KURLY_HARNESS_PATH 등)를 .env.local 단일소스로 영구화하기 위함. (파일 없으면 무시)
try { process.loadEnvFile(path.join(__dirname, "..", ".env.local")); } catch { /* .env.local 없으면 무시 */ }

// v1.0 Phase 3: 외부 워커만 쓰려면 내장 워커 비활성화
if (process.env.DISABLE_BUILTIN_WORKER === "true") {
  console.log("[worker] DISABLE_BUILTIN_WORKER=true, 내장 워커 비활성화. 외부 워커만 사용하세요.");
  console.log("[worker] kurly-qa-worker-v1 패키지로 워커를 별도 실행하세요.");
  // 죽지 않고 idle 상태로 (concurrently 가 죽음으로 인식하지 않게)
  setInterval(() => {}, 1 << 30);
} else {

const ROOT = __dirname.endsWith("worker") ? path.dirname(__dirname) : __dirname;
const DB_PATH = path.join(ROOT, "data", "qa-admin.db");
const RESULTS_DIR = path.join(ROOT, "results");
const POLL_MS = 2000;
const CANCEL_CHECK_MS = 1500;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const ADMIN_URL = process.env.ADMIN_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
// v1.7 모델 통일 — 속도/비용 균형 default. env 로 override 가능.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const QA_COWORK_HOME =
  process.env.KURLY_QA_HOME ||
  path.join(os.homedir(), "Documents", "QA-Cowork", "AI_Test");

function buildRuntimeTestDataHandoffBlock(jobId) {
  return `
## 🧪 수행 중 테스트데이터 에이전트 핸드오프

테스트 데이터는 TC 생성 직후 미리 추정해서 만들지 않는다. **수행 중 실제로 데이터가 없어서 TC가 막히는 순간에만** 아래 절차를 사용한다.
데이터 요청은 중앙 큐(${ADMIN_URL}/api/data-requests)에 등록하고, 테스트데이터 큐 워커가 하나씩 순차 처리한다.

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
curl -s -X POST "${ADMIN_URL}/api/data-requests" \\
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
curl -s "${ADMIN_URL}/api/data-requests/{request.id}"
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

fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * 후손 프로세스 트리를 BFS 로 수집해서 전부 SIGKILL.
 * - Playwright MCP 가 --isolated 모드로 spawn 하는 Chromium 처럼
 *   PID 매칭으로는 못 잡히는 손자/증손자까지 ps -ax -o pid,ppid 로 추적.
 * - 후손부터 죽이고 root 는 마지막에.
 * - rootPid 자신은 죽이지 않음 (호출자가 별도 처리).
 * @returns {number} 죽인 후손 개수
 */
function killDescendantsTree(rootPid) {
  if (!rootPid || typeof rootPid !== "number") return 0;
  try {
    const { execSync } = require("node:child_process");
    const out = execSync("ps -ax -o pid,ppid", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const lines = out.split("\n").slice(1);
    const childrenOf = new Map();
    for (const line of lines) {
      const m = line.trim().match(/^(\d+)\s+(\d+)/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      const ppid = parseInt(m[2], 10);
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
      if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
      childrenOf.get(ppid).push(pid);
    }
    const descendants = [];
    const queue = [rootPid];
    const visited = new Set([rootPid]);
    while (queue.length > 0) {
      const p = queue.shift();
      const kids = childrenOf.get(p) ?? [];
      for (const c of kids) {
        if (visited.has(c)) continue;
        visited.add(c);
        descendants.push(c);
        queue.push(c);
      }
    }
    // 손자/증손자부터 → 자식 순서로 죽임 (역순)
    for (let i = descendants.length - 1; i >= 0; i--) {
      try { process.kill(descendants[i], "SIGKILL"); } catch (_) {}
    }
    return descendants.length;
  } catch (_) {
    return 0;
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    domain TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'web',
    qa_env TEXT NOT NULL DEFAULT 'stg',
    task_name TEXT,
    env TEXT NOT NULL DEFAULT 'stg',
    epic_key TEXT,
    tc_filename TEXT NOT NULL,
    tc_path TEXT NOT NULL,
    result_dir TEXT,
    total INTEGER DEFAULT 0,
    passed INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    blocked INTEGER DEFAULT 0,
    current_index INTEGER DEFAULT 0,
    error_message TEXT,
    requested_by TEXT,
    mode TEXT NOT NULL DEFAULT 'mock',
    generated_prompt TEXT,
    cancel_requested INTEGER DEFAULT 0,
    tc_filter TEXT,
    analyzer_summary TEXT
  );
  CREATE TABLE IF NOT EXISTS job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_logs_job ON job_logs(job_id, id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);

  -- v1.7 진행 중 끼어들기 메시지 큐 (어드민과 공유 — 안전망)
  CREATE TABLE IF NOT EXISTS pending_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pending_messages_job ON pending_messages(job_id, status);
`);

// v1.7 platform 별 MCP 서버 설정 — claude CLI 의 --mcp-config 로 잡마다 격리
//  - web:  desktop chromium playwright
//  - mweb: playwright + --device "iPhone 15" (UA/viewport/DPR/touch 모두 모바일)
//  - app:  mobile-mcp (실기기/시뮬레이터)
function buildMcpConfig(platform) {
  const servers = {};
  if (platform === "app") {
    servers["mobile-mcp"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@mobilenext/mobile-mcp@latest"],
    };
  } else {
    const args = ["-y", "@playwright/mcp@latest", "--browser=chromium", "--isolated"];
    if (platform === "mweb") {
      args.push("--device", "iPhone 15");
    }
    servers["playwright"] = {
      type: "stdio",
      command: "npx",
      args,
    };
  }
  return { mcpServers: servers };
}

// v1.7 끼어들기 메시지 큐 헬퍼 (lib/messages.ts 와 동일 로직, 워커에서는 CJS 직접 SQL)
function takeNextPendingMessage(jobId) {
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT id, content FROM pending_messages WHERE job_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1`
    ).get(jobId);
    if (!row) return null;
    db.prepare(
      `UPDATE pending_messages SET status='delivered', delivered_at=datetime('now') WHERE id = ?`
    ).run(row.id);
    return row;
  })();
}

// 마이그레이션
const cols = db.prepare(`PRAGMA table_info(jobs)`).all();
const colNames = new Set(cols.map((c) => c.name));
const migrations = [
  ["platform", `ALTER TABLE jobs ADD COLUMN platform TEXT NOT NULL DEFAULT 'web'`],
  ["qa_env", `ALTER TABLE jobs ADD COLUMN qa_env TEXT NOT NULL DEFAULT 'stg'`],
  ["task_name", `ALTER TABLE jobs ADD COLUMN task_name TEXT`],
  ["blocked", `ALTER TABLE jobs ADD COLUMN blocked INTEGER DEFAULT 0`],
  ["mode", `ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'mock'`],
  ["generated_prompt", `ALTER TABLE jobs ADD COLUMN generated_prompt TEXT`],
  ["started_at", `ALTER TABLE jobs ADD COLUMN started_at TEXT`],
  ["finished_at", `ALTER TABLE jobs ADD COLUMN finished_at TEXT`],
  ["cancel_requested", `ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER DEFAULT 0`],
  ["tc_filter", `ALTER TABLE jobs ADD COLUMN tc_filter TEXT`],
  ["analyzer_summary", `ALTER TABLE jobs ADD COLUMN analyzer_summary TEXT`],
  // v1.1 기획 문서 참조
  ["spec_url", `ALTER TABLE jobs ADD COLUMN spec_url TEXT`],
  ["spec_filename", `ALTER TABLE jobs ADD COLUMN spec_filename TEXT`],
  ["spec_text", `ALTER TABLE jobs ADD COLUMN spec_text TEXT`],
  // v1.2 다중 TC 파일
  ["tc_paths", `ALTER TABLE jobs ADD COLUMN tc_paths TEXT`],
  ["tc_filenames", `ALTER TABLE jobs ADD COLUMN tc_filenames TEXT`],
  // v1.3 애드혹 테스트
  ["job_type", `ALTER TABLE jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'full'`],
  ["adhoc_focus", `ALTER TABLE jobs ADD COLUMN adhoc_focus TEXT`],
];

// v1.2: Job 에서 TC 파일 목록 추출 (다중 우선, 단일 호환 폴백)
function getJobTcFiles(job) {
  let paths = [];
  let names = [];
  if (job.tc_paths) {
    try { paths = JSON.parse(job.tc_paths) || []; } catch (_) {}
  }
  if (job.tc_filenames) {
    try { names = JSON.parse(job.tc_filenames) || []; } catch (_) {}
  }
  if (paths.length === 0 && job.tc_path) paths = [job.tc_path];
  if (names.length === 0 && job.tc_filename) names = [job.tc_filename];
  // 길이 맞추기
  while (names.length < paths.length) names.push(path.basename(paths[names.length]));
  return paths.map((p, i) => ({ path: p, filename: names[i] || path.basename(p) }));
}
for (const [col, sql] of migrations) {
  if (!colNames.has(col)) db.exec(sql);
}

// ============== DB helpers ==============
// v1.0 Phase 2: 종관님 PC 의 *내장 워커* 도 워커 이름이 있어야 함
const BUILTIN_WORKER_NAME = process.env.BUILTIN_WORKER_NAME || "jjong-MacBookAir";

function claimNextPending() {
  const tx = db.transaction(() => {
    // Phase 2 라우팅:
    // - worker_name 이 null 이거나 (Phase 1 호환)
    // - worker_name 이 내 이름과 일치하면 가져감
    const job = db.prepare(`
      SELECT * FROM jobs
      WHERE status='pending'
        AND (worker_name IS NULL OR worker_name = ?)
      ORDER BY created_at ASC LIMIT 1
    `).get(BUILTIN_WORKER_NAME);
    if (!job) return null;
    db.prepare(`UPDATE jobs SET status='running', started_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(job.id);
    return db.prepare(`SELECT * FROM jobs WHERE id=?`).get(job.id);
  });
  return tx();
}
function isCancelRequested(jobId) {
  const r = db.prepare(`SELECT cancel_requested FROM jobs WHERE id=?`).get(jobId);
  return r && r.cancel_requested === 1;
}
function updateJob(id, patch) {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const set = fields.map((k) => `${k}=?`).join(", ");
  const values = fields.map((k) => patch[k]);
  db.prepare(`UPDATE jobs SET ${set}, updated_at=datetime('now') WHERE id=?`).run(...values, id);
}
function addLog(jobId, level, message) {
  db.prepare(`INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)`).run(jobId, level, message);
}
function closeDataRequestsForJob(jobId, reason) {
  try {
    db.prepare(`
      UPDATE data_requests
      SET status='blocked',
          finished_at=datetime('now'),
          updated_at=datetime('now'),
          error_message=?,
          notes=COALESCE(notes, '원 수행 잡이 종료되어 이 데이터 요청은 더 이상 사용되지 않습니다.')
      WHERE source_job_id=?
        AND status IN ('pending', 'running')
    `).run(reason, jobId);
  } catch {
    // Next 쪽 마이그레이션 전 단독 워커가 먼저 뜬 경우 data_requests 테이블이 없을 수 있다.
  }
}
function setStatus(id, status, errorMessage) {
  const finished = ["succeeded", "failed", "canceled"].includes(status);
  if (finished) {
    db.prepare(`UPDATE jobs SET status=?, error_message=?, finished_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(status, errorMessage ?? null, id);
    closeDataRequestsForJob(id, `원 수행 잡이 ${status} 상태로 종료되어 데이터 요청을 닫았습니다.`);
  } else {
    db.prepare(`UPDATE jobs SET status=?, error_message=?, updated_at=datetime('now') WHERE id=?`)
      .run(status, errorMessage ?? null, id);
  }
}

// ============== 프롬프트/메시지 ==============
// v0.4b: 도메인 10개 지원
// - 멤버스/회원: web + app 베이스 프롬프트 모두 있음
// - 3P: web 베이스만 있음 (app은 fallback)
// - 상품/홈전시추천/검색광고/주문/결제/클레임/프로모션: 베이스 없음 (fallback)
//
// fallback = 도메인 전용 .md 없이 공통 베이스(base-prompt-Web.md / -app.md)만 사용
// + 팀원이 prompts/ 폴더에 자기 .md 올리면 Claude가 알아서 읽음
const DOMAIN_FILE_MAP = {
  "멤버스": { web: "base-prompt-멤버스.md", app: "base-prompt-멤버스-app.md" },
  "회원":   { web: "base-prompt-회원.md",   app: "base-prompt-회원-app.md" },
  "3P":     { web: "base-prompt-3P.md",     app: null },
};

// knowledge 폴더명 매핑 (한글 폴더명 사용)
const DOMAIN_KNOWLEDGE_MAP = {
  "멤버스": "멤버스",
  "회원": "회원",
  "3P": "3P",
  "상품": "상품",
  "홈전시추천": "홈전시추천",
  "검색광고": "검색광고",
  "주문": "주문",
  "결제": "결제",
  "클레임": "클레임",
  "프로모션": "프로모션",
};

function resolvePrompts(domain, platform) {
  const promptsDir = path.join(QA_COWORK_HOME, "prompts");

  // 베이스 폴더 — 한글 "베이스" 또는 영문 "base" 둘 다 지원 (종관님 폴더 정리 호환)
  // 종관님 v0.4b 초기 = 베이스/, 정리 후 = base/. 둘 다 자동 인식.
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

  // 도메인 프롬프트 검색: 여러 위치 시도
  // 1) prompts/{도메인파일}.md (원래 위치)
  // 2) prompts/베이스/{도메인파일}.md 또는 prompts/base/{도메인파일}.md
  // 3) prompts/도메인/{도메인파일}.md
  function findDomainPrompt(domainFile) {
    if (!domainFile) return null;
    const candidates = [
      path.join(promptsDir, domainFile),
      path.join(baseDir, domainFile),
      path.join(promptsDir, "도메인", domainFile),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  if (map) {
    const domainFile = platform === "app" ? map.app : map.web;
    const found = findDomainPrompt(domainFile);
    if (found) {
      domainPromptPath = found;
    } else {
      isFallback = true;
    }
  } else {
    // 매핑이 없는 7개 도메인 (상품/홈/검색/주문/결제/클레임/프로모션)
    isFallback = true;
  }

  // knowledge 폴더 — knowledge/{commerce|logistics}/{도메인}(중첩) 우선, 없으면 knowledge/{도메인}(평면, 레거시).
  // BU 판별: 폴더명이 "물류"로 시작하면 logistics, 아니면 commerce. (admin functional-prompt.ts 와 동일 규칙 — drift 주의)
  const knowledgeFolder = DOMAIN_KNOWLEDGE_MAP[domain] || domain;
  const kgParent = knowledgeFolder.startsWith("물류") ? "logistics" : "commerce";
  const kgNested = path.join(QA_COWORK_HOME, "knowledge", kgParent, knowledgeFolder);
  const knowledgeFolderPath = fs.existsSync(kgNested) ? kgNested : path.join(QA_COWORK_HOME, "knowledge", knowledgeFolder);
  if (!fs.existsSync(knowledgeFolderPath)) {
    try { fs.mkdirSync(knowledgeFolderPath, { recursive: true }); } catch (_) {}
  }

  return {
    domainPromptPath,
    basePromptPath,
    knowledgeFolderPath,
    isFallback,
  };
}

function buildClaudeMessage(input) {
  const { domain, platform, qaEnv, taskName, tcFiles, resultDirAbsPath, resolution, filterDesc, additionalInstructions, specUrl, specFilename, specText } = input;
  // 호환: 과거 호출자는 tcCsvAbsPath 1개를 줄 수 있음
  const files = Array.isArray(tcFiles) && tcFiles.length > 0
    ? tcFiles
    : (input.tcCsvAbsPath ? [{ path: input.tcCsvAbsPath, filename: path.basename(input.tcCsvAbsPath) }] : []);
  // 프롬프트 표시용 블록
  const tcListBlock = files.length === 1
    ? `- TC CSV 파일: ${files[0].path}`
    : `- TC CSV 파일 (${files.length}개, 순서대로 처리):\n${files.map((f, i) => `    ${i + 1}. ${f.path}  (원본명: ${f.filename})`).join("\n")}\n  → 각 파일을 순서대로 끝까지 실행하고, **모든 결과를 통합한 단일 ${resultDirAbsPath}/summary.csv** 한 파일에 누적 기록.\n  → No 컬럼은 파일 간 충돌 시 \`<파일인덱스>-<원본No>\` 형식으로 유니크하게 (예: 2-15).`;
  const platformKor = platform === "app" ? "앱"
    : platform === "mweb" ? "모바일 웹"
    : "데스크톱 웹";
  const envKor = qaEnv === "stg" ? "기본 STG" : qaEnv.toUpperCase();
  const baseHost = qaEnv === "stg" ? "stg.kurly.com" : `${qaEnv}.stg.kurly.com`;
  const basePromptRel = path.relative(QA_COWORK_HOME, resolution.basePromptPath);
  const knowledgeRel = path.relative(QA_COWORK_HOME, resolution.knowledgeFolderPath);

  const filterBlock = filterDesc ? `\n## 실행 범위 필터\n${filterDesc}\n` : "";

  // v1.7 mweb 분기: Playwright MCP 가 iPhone 15 device emulation 으로 떠있음 (어드민이 --device 지정).
  // UA / viewport / DPR / touch 모두 모바일로 자동 설정됨 — Claude 는 모바일 관점 시나리오에 집중.
  const mwebBlock = platform === "mweb" ? `
## 📱 모바일 웹(Mweb) 검증 — Playwright iPhone 15 emulation 자동 적용됨

이 테스트는 **모바일 웹** 으로 검증합니다. 어드민이 Playwright MCP 를 \`--device "iPhone 15"\` 옵션으로 시작했으므로:
- User-Agent: iPhone Safari (모바일로 자동 인식됨)
- Viewport / DPR / Touch: iPhone 15 기준 자동 설정
- 별도 \`browser_resize\` 나 UA 변경 코드 **불필요**

### 모바일 관점 검증 포인트 (정확성을 위해 반드시 확인)
1. **모바일 레이아웃 표지 확인** — 햄버거 메뉴 / 바텀 네비 / 1열 카드 / 모달 풀스크린 등이 나오는지.
   데스크톱 그리드 (3~4열) 나오면 사이트가 UA 인식 실패 → URL 점검 (www-→m- 등 모바일 도메인 라우팅 있는지 확인).
2. **터치 인터랙션** — \`browser_click\` 이 touchstart/touchend 로 디스패치됨.
3. **모바일 전용 시나리오 포함** — 한 손 조작 / 가로/세로 회전 / 모달 닫기 제스처 등 모바일 특화 UX 도 시나리오에.
4. **스크린샷** — 캡처 시 모바일 사이즈 (390x844) 로 찍힘. 데스크톱 너비면 emulation 적용 실패한 것.

` : "";

  // 도메인 전용 프롬프트 라인 (fallback이면 안내문 다르게)
  let domainPromptLine;
  if (resolution.domainPromptPath) {
    const domainPromptRel = path.relative(QA_COWORK_HOME, resolution.domainPromptPath);
    domainPromptLine = `- ${domainPromptRel} (도메인 전용)`;
  } else {
    domainPromptLine = `- (도메인 전용 베이스 프롬프트 없음 — fallback 모드. prompts/ 폴더의 ${domain} 관련 .md 파일이 있으면 모두 읽고, knowledge/${DOMAIN_KNOWLEDGE_MAP[domain] || domain}/ 의 모든 .md 파일을 참고)`;
  }

  // v0.4b knowledge 자동 매칭: 과제명 기반으로 핵심 참고 자료 찾기
  let coreKnowledgeBlock = "";
  try {
    const matched = findRelevantKnowledge(resolution.knowledgeFolderPath, taskName, QA_COWORK_HOME);
    if (matched.length > 0) {
      // 점수 높은 순으로 최대 5개. 1순위(가장 핵심)는 강조
      const top = matched.slice(0, 5);
      const lines = top.map((m, i) => {
        const sizeKb = (m.size / 1024).toFixed(1);
        const marker = i === 0 ? " ⭐ (가장 핵심)" : "";
        return `- ${m.relPath} (${sizeKb} KB)${marker}`;
      });
      coreKnowledgeBlock = `
## 📚 이 과제의 핵심 참고 자료 (반드시 시작 전 정독)

과제명 "${taskName.replace(/__RETRY_ENCOURAGE__/g, "").trim()}" 기반으로 자동 추출된 가장 관련성 높은 knowledge 파일들:

${lines.join("\n")}

**작업 시작 전 위 ${top.length}개 파일은 반드시 정독.** 특히 ⭐ 표시는 이 과제의 핵심 정책/플로우/예외 케이스가 정리되어 있을 가능성 큼.
막혔을 때도 이 파일들에 답이 있을 가능성이 가장 높으니 다시 검색.
`;
    }
  } catch (_) {
    // 매칭 실패해도 작업은 계속 진행
  }

  // v1.1 기획 문서 컨텍스트
  let specBlock = "";
  if ((specText && specText.trim()) || specUrl) {
    const parts = [];
    if (specUrl) parts.push(`원문 URL: ${specUrl}`);
    if (specFilename) parts.push(`첨부 파일: ${specFilename}`);
    const meta = parts.length ? parts.join(" / ") + "\n\n" : "";
    const body = specText && specText.trim()
      ? specText.trim()
      : "(본문 미추출 — 위 URL을 사람이 직접 참고)";
    specBlock = `
## 📎 기획 문서 (이번 과제 참고용)

${meta}${body}

> 위 기획서를 **TC 실행/판정 기준**으로 활용. TC가 모호한 경우 기획서에 명시된 사양을 우선.
> 기획서와 실제 동작이 다르면 FAIL 처리하고 사유에 *기획 vs 동작 차이* 명시.
`;
  }

  // v0.4b 추가 지시사항: 종관님이 새 실행/재실행 시 입력한 현장 지시
  let additionalBlock = "";
  if (additionalInstructions && additionalInstructions.trim()) {
    additionalBlock = `
## 📝 추가 지시사항 (최우선 적용)

종관님(요청자)이 이번 실행에 대해 직접 명시한 지시사항이야. **다른 규칙보다 우선** 적용해.
인터랙티브 모드에서 "이런 식으로 해줘" 라고 알려주는 힌트와 동일하게 취급.

${additionalInstructions.trim()}
`;
  }

  // v0.4b BLOCKED 재실행: 격려 메시지 마커 감지
  const ENCOURAGEMENT_MARKER = "__RETRY_ENCOURAGE__";
  let cleanTaskName = taskName;
  let encouragementBlock = "";
  if (taskName && taskName.includes(ENCOURAGEMENT_MARKER)) {
    cleanTaskName = taskName.replace(ENCOURAGEMENT_MARKER, "").trim();
    encouragementBlock = `
## ⚠️ 중요: 미리 한계 선언 금지 (재실행 격려)

이전 실행에서 다음 케이스들이 BLOCKED 처리되었음. **시도해보지 않고 미리 "수동 회귀 필요" / "자동화 불가능" 같은 결론을 내리지 마.**

### 🚨 막혔을 때 가장 먼저 할 일: knowledge 다시 정독

이번 과제와 관련된 knowledge 파일들에 **답이 있을 가능성이 가장 큼**. BLOCKED 가 났다면 거의 확실히 *방법을 모른 것*. knowledge 파일을 처음부터 다시 검색:

- "이미지 업로드" 같은 단어 검색 → 어떤 selector / 방법 쓰는지 확인
- 비슷한 케이스의 성공 플로우 참고
- knowledge 에 안 나오는 새로운 기능이면 그제야 우회 시도

### 그 다음에 시도할 우회 방법

1. **다른 selector** — getByRole, getByText, getByLabel, xpath 등 여러 방법
2. **JavaScript 직접 실행** — page.evaluate() 로 DOM 직접 조작
3. **다른 페이지 경로** — 메뉴 클릭 대신 URL 직접 진입
4. **대기 시간 조정** — 짧은 timeout 으로 실패 시 더 길게 재시도
5. **Mobile MCP 다른 도구** — click 안 되면 tap, input 안 되면 paste 등
6. **시나리오 변형** — 정확히 동일하게 안 되면, 같은 목적의 다른 흐름 시도

위 6가지 방법을 시도해도 정말 안 되면 그제야 "BLOCKED — 구체적 사유" 기록.
**"이미지 업로드는 수동 회귀 필요" 같은 추상적 사유 금지.** 어디서 어떻게 막혔는지 명확히.

### ⏱ 격려 모드의 시도 상한 (단호)
- **한 TC 당 최대 10회 도구 호출** — 그 안에서 우회 시도 다 해본다.
- 10회 초과 시 BLOCKED 인정하고 즉시 다음 TC 로. 30분 동안 한 TC 만 붙들고 있지 마.
- 격려는 *깊이* 가 아니라 *다양성* — 5가지 방법을 5회 안에 다 시도하는 게 핵심.
`;
  }

  return `${domain} 도메인 TC를 ${platformKor}으로 ${envKor} 환경에서 돌려줘.
${mwebBlock}${additionalBlock}${specBlock}${encouragementBlock}${coreKnowledgeBlock}${buildRuntimeTestDataHandoffBlock(input.jobId)}
## 🎯 검증 정확성 vs 속도 균형 (최우선)

이 작업은 **어드민 자동 실행 모드**입니다. 옆에 사용자가 가이드하지 않습니다.

### ⛔ 절대 깨지 말 것 (정확성)
- **NO BATCH PASS**: 각 TC 는 반드시 *개별 실행 후* 결과 기록.
  - "위와 동일", "동일 패턴으로 PASS" 같은 추론 PASS 금지.
  - 추론으로 PASS 처리한 게 사실은 FAIL 이었던 이력 있음. 매번 *실제 화면 확인 후* 판정.
- **FAIL 시 스크린샷 필수**: 실패 화면 캡처 없으면 버그 등록 근거 없음.
- **base-prompt 의 검증 정확성 규칙은 모두 그대로 따른다**.

### 🚦 속도 최우선 규칙 (단호 적용 — 정확성과 충돌 시에만 양보)

1. **TodoWrite 호출 전면 금지**
   - 어드민이 표준출력 ("TC-N PASS/FAIL: 사유") 으로 진행률 집계함. TodoWrite 는 사용자가 안 보는 곳에 쓰는 메모이므로 불필요.

2. **PASS 케이스 screenshot 호출 금지**
   - PASS 는 accessibility tree (browser_snapshot) 확인만으로 판정. browser_take_screenshot 호출 X.
   - 스크린샷은 **FAIL/BLOCKED 케이스만** 필수.

3. **같은 상태 재확인 금지**
   - browser_snapshot 또는 browser_evaluate 로 동일 페이지 상태를 2번 이상 확인 금지.
   - 1회로 판정 부족하면 selector 를 *바꿔서* 1회 더 — 같은 호출 반복 X.

4. **같은 selector 재시도 금지**
   - browser_click / browser_type 등이 1회 실패하면 즉시 **browser_evaluate 로 직접 JS 우회** (DOM 조작 / nativeInputValueSetter 등).
   - 같은 selector 로 wait_for + retry 패턴 금지.

5. **도구 호출 상한 (단호)**
   - 단순 TC: **최대 5회** 도구 호출
   - 일반 TC: **최대 10회**
   - 복잡 TC (결제/풀 사이클): **최대 15회**
   - 상한 초과 시 BLOCKED 처리, 다음 TC 로. 우회 시도는 그 안에서만.

6. **풀 사이클 가이드 무조건 적용 금지**
   - 3p-full-cycle-guide.md / fbk-full-cycle-guide.md 는 *TC 가 명시적으로 풀 사이클 요구할 때만*.
   - 단순 UI 검증 TC 에 정산 등록 / 풀 사이클 단계 추가하지 마.

### 📊 속도 가이드라인 (실측 기준)
- 단순 TC: **30초~1분** (도구 호출 ≤ 5회)
- 일반 TC: **1~2분** (도구 호출 ≤ 10회)
- 복잡 TC: **3~5분** (도구 호출 ≤ 15회)
- 5분 초과 또는 도구 호출 상한 초과 → BLOCKED 처리 + 즉시 다음 TC. (추론 PASS 절대 금지)

---

## 실행 정보
${tcListBlock}
- 환경: ${envKor} (${baseHost})
- 도메인: ${domain}
- 플랫폼: ${platformKor}
- 과제명: ${cleanTaskName}
- 결과 저장 위치: ${resultDirAbsPath}
${filterBlock}
## 참조 프롬프트
- ${basePromptRel} (공통 베이스)
${domainPromptLine}
- ${knowledgeRel}/ 폴더의 모든 .md 파일을 시작 전 반드시 읽기
- CLAUDE.md의 모든 규칙을 따른다
- ⚠️ base-prompt 와 위 "🎯 검증 정확성 vs 속도 균형" 이 충돌하면 **위 블록이 우선**

## 결과 출력 형식
${resultDirAbsPath} 폴더 안에 다음 파일들을 생성해줘:
- summary.csv (UTF-8 BOM, 컬럼: No, Priority, Type, TC Title${platform === "app" ? ", Platform" : ""}, Test Step, Expected Result, Actual Result, Result, Notes, Screenshot)
- fail-detail.csv (UTF-8 BOM, FAIL 케이스만)
- TC-{No}/ 하위에 케이스별 스크린샷 (PASS 는 생략 가능, FAIL 은 필수)

## ✍️ Actual Result / Notes / Fail Reason 작성 규칙
- **읽는 사람이 QA / 기획자 / 비개발자** 라는 점을 의식하고 작성
- ❌ **금지** 영어 전문 용어: \`clamp\`, \`Severity Minor\`, \`Severity Major\`, \`N/A\`, \`fallback\`, \`edge case\`, \`null\`, \`undefined\`, \`debounce\`, \`throttle\`, \`gracefully\`, \`degrade\`, \`override\` 등
- ❌ 약어 / 기호 (vs / + / →) 의존한 단편적 메모 금지
- ✅ **완성된 한국어 문장**으로 "기획서가 무엇을 기대했고", "실제로 어떻게 동작했고", "왜 문제인지" 한 줄로 풀어쓰기
- 예시
  - 나쁜: \`기획서 기대=토스트 vs 실제=입력시점 자동 clamp. 기능상 cap 강제됨(Severity Minor).\`
  - 좋은: \`기획서에는 50% 초과 입력 시 에러 토스트가 떠야 한다고 했지만, 실제로는 50%로 자동 보정되며 토스트는 표시되지 않습니다. 사용자가 잘못된 입력을 했는지 알 수 없어 안내가 필요합니다.\`
- **꼭 필요한 영문 용어** (예: clamp) 는 한국어 풀이를 괄호로 같이 표시: \`자동 보정(clamp)\`
- 1~3문장 이내 권장 — 너무 길면 핵심이 흐려짐

## 🟢 진행률 보고 (필수 — 라이브 진행률 집계에 직결)
- **각 TC 판정을 끝낼 때마다 즉시, 독립된 한 줄로** 다음 형식 중 하나만 정확히 출력:
  - \`TC-{No}: PASS\`  /  \`TC-{No}: FAIL — 사유\`  /  \`TC-{No}: BLOCKED — 사유\`
  - 예: \`TC-28: PASS\` , \`TC-30: FAIL — 배송비 0원 미표시\`
- ⛔ 서술 문장("TC-28 결과 확인 완료", "확인됨" 등)으로 **대체 금지**. PASS/FAIL/BLOCKED 단어가 그 줄에 없으면 어드민 진행률이 **0으로 멈춰** 보인다.
- 판정 직후 **즉시 1줄** (요약을 마지막에 몰아 출력 X). 한 TC = 정확히 한 줄의 결과 마커.

## 주의
- 운영(production) 절대 접근 금지. STG 전용.
- NO BATCH PASS — 모든 TC 개별 실행, "위와 동일" 표현 금지.
`;
}

// ============== v1.3 애드혹 테스트 프롬프트 ==============
function buildAdhocMessage(input) {
  const { domain, platform, qaEnv, taskName, resultDirAbsPath, resolution, additionalInstructions, specUrl, specFilename, specText, adhocFocus } = input;
  const platformKor = platform === "app" ? "앱"
    : platform === "mweb" ? "모바일 웹"
    : "데스크톱 웹";
  const envKor = qaEnv === "stg" ? "기본 STG" : qaEnv.toUpperCase();
  const baseHost = qaEnv === "stg" ? "stg.kurly.com" : `${qaEnv}.stg.kurly.com`;

  // v1.7 mweb: Playwright iPhone 15 emulation 자동 적용 (어드민 --device 지정)
  const mwebBlock = platform === "mweb" ? `
## 📱 모바일 웹(Mweb) 애드혹 — Playwright iPhone 15 emulation 자동 적용됨

어드민이 Playwright MCP 를 \`--device "iPhone 15"\` 옵션으로 시작 — UA/viewport/DPR/touch 모두 모바일.
별도 resize 나 UA 설정 코드 **불필요**.

### 모바일 관점 시나리오 필수 포함
- 햄버거 메뉴 / 바텀 네비 / 1열 카드 / 모달 풀스크린 등 모바일 UX 검증
- 한 손 조작 / 가로↔세로 회전 / 제스처 (스와이프) 시나리오
- 데스크톱 그리드가 나오면 UA 인식 실패 — \`m-${qaEnv === "stg" ? "stg" : qaEnv + ".stg"}.kurly.com\` 같은 모바일 도메인으로 우회 시도

` : "";
  const basePromptRel = path.relative(QA_COWORK_HOME, resolution.basePromptPath);
  const knowledgeRel = path.relative(QA_COWORK_HOME, resolution.knowledgeFolderPath);

  let domainPromptLine;
  if (resolution.domainPromptPath) {
    const domainPromptRel = path.relative(QA_COWORK_HOME, resolution.domainPromptPath);
    domainPromptLine = `- ${domainPromptRel} (도메인 전용)`;
  } else {
    domainPromptLine = `- (도메인 전용 베이스 프롬프트 없음 — knowledge/${DOMAIN_KNOWLEDGE_MAP[domain] || domain}/ 의 모든 .md 파일을 참고)`;
  }

  // 기획 문서
  let specBlock = "";
  if ((specText && specText.trim()) || specUrl) {
    const parts = [];
    if (specUrl) parts.push(`원문 URL: ${specUrl}`);
    if (specFilename) parts.push(`첨부 파일: ${specFilename}`);
    const meta = parts.length ? parts.join(" / ") + "\n\n" : "";
    const body = specText && specText.trim() ? specText.trim() : "(본문 미추출 — 위 URL을 사람이 직접 참고)";
    specBlock = `\n## 📎 기획 문서 (애드혹 테스트의 기준)\n\n${meta}${body}\n`;
  }

  // 포커스 영역
  let focusBlock = "";
  if (adhocFocus && adhocFocus.trim()) {
    focusBlock = `\n## 🎯 포커스 영역 (요청자가 집중 검증을 원하는 부분)\n\n${adhocFocus.trim()}\n\n> 위 포커스 영역을 우선으로 시나리오를 만들고, 시간이 남으면 일반 탐색도 진행해.\n`;
  }

  let additionalBlock = "";
  if (additionalInstructions && additionalInstructions.trim()) {
    additionalBlock = `\n## 📝 추가 지시사항 (최우선 적용)\n\n${additionalInstructions.trim()}\n`;
  }

  return `${domain} 도메인 ${platformKor} (${envKor}) 환경에서 **애드혹 테스트**를 진행해줘.
${mwebBlock}${additionalBlock}${specBlock}${focusBlock}
## 🎯 애드혹 테스트란?

미리 정의된 TC 없이, 기획 문서와 본인의 QA 직관/경험을 활용해 **탐색적으로** 검증.

### 진행 방식
1. **시나리오 도출**: 기획서 + 도메인 knowledge 를 읽고, 검증할 만한 시나리오를 5~15개 자유롭게 도출.
   - 정상 케이스: 기획서대로 동작하는가
   - 엣지 케이스: 빈값 / 특수문자 / 경계값 / 동시성 / 네트워크 끊김
   - 부정 케이스: 권한 없는 사용자, 잘못된 입력
   - 회귀: 이 기능이 영향 주는 다른 영역
2. **순서대로 실행**: 시나리오마다 \`TC-N\` 번호 매기고, PASS/FAIL/BLOCKED 판정.
3. **버그/의문점 기록**: 발견한 버그는 재현 단계 + 스크린샷, 의문점은 별도 섹션.

### 출력 (반드시 두 파일 모두 생성)

**${resultDirAbsPath}/summary.csv** (UTF-8 BOM)
- 컬럼: No, Priority(추정), Type(정상/엣지/부정/회귀), TC Title, Test Step, Expected Result, Actual Result, Result, Notes, Screenshot
- 시나리오 1개당 1행

### ✍️ Actual Result / Notes 작성 규칙
- **읽는 사람이 QA / 기획자 / 비개발자** 라는 점 의식
- ❌ 금지 영어 전문 용어: \`clamp\`, \`Severity Minor/Major\`, \`N/A\`, \`fallback\`, \`edge case\`, \`null\`, \`debounce\`, \`gracefully\`, \`override\` 등
- ❌ \`vs\` / 기호 단편 메모 금지
- ✅ **완성된 한국어 문장**으로 "기획서 기대 → 실제 동작 → 왜 문제인지" 풀어쓰기
- 예시
  - 나쁜: \`기획서 기대=토스트 vs 실제=자동 clamp(Minor)\`
  - 좋은: \`50% 초과 입력 시 에러 토스트가 떠야 했지만, 실제로는 50%로 자동 보정되며 안내가 없습니다.\`
- 필요한 영문 용어는 한국어 풀이를 괄호로: \`자동 보정(clamp)\`

**${resultDirAbsPath}/report.md** (마크다운 리포트)
\`\`\`
## 요약
- 시나리오 N건, PASS X / FAIL Y / BLOCKED Z
- 발견된 주요 이슈 한 줄씩

## 발견된 버그
### [심각도] 제목
- 재현 단계
- 기대 동작 vs 실제 동작
- 스크린샷: TC-N/xxx.png

## 의문점 / 추가 검증 필요
- 기획서가 모호한 부분
- 추가 정보 필요한 부분

## 테스트 범위
- 다룬 시나리오 영역
- 다루지 못한 영역

## 추천 다음 액션
- 풀 TC 작성 필요 영역
- 회귀 추가 권고
\`\`\`

### 진행 상황 표준출력 (필수)
- 각 시나리오 판정 직후 **즉시, 독립된 한 줄로** \`TC-{N}: PASS\` / \`TC-{N}: FAIL — 사유\` / \`TC-{N}: BLOCKED — 사유\` 중 하나만 출력.
- ⛔ 서술("확인 완료" 등)로 대체 금지 — PASS/FAIL/BLOCKED 단어가 그 줄에 없으면 어드민 진행률이 0으로 멈춰 보인다.

---

## 환경 정보
- 환경: ${envKor} (${baseHost})
- 도메인: ${domain}
- 플랫폼: ${platformKor}
- 과제명: ${taskName || "(미지정)"}
- 결과 저장 위치: ${resultDirAbsPath}

## 참조 프롬프트
- ${basePromptRel} (공통 베이스)
${domainPromptLine}
- ${knowledgeRel}/ 폴더의 모든 .md 파일을 시작 전 반드시 읽기
- CLAUDE.md 의 모든 규칙을 따른다

## 주의
- 운영(production) 절대 접근 금지. STG 전용.
- 너무 많이 하지 말기 — 5~15 시나리오, 30분 이내 권장.
- FAIL 시 스크린샷 필수. PASS 는 생략 가능.
- 추론 PASS 금지 — 매 시나리오 실제 화면 확인.
`;
}

// ============== 작업 실행 ==============
function parseTcCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  // v0.4b 버그 수정: 따옴표 안의 줄바꿈 고려한 행 분리
  const lines = splitCsvLines(text);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",");
  return { headers, rows: lines.slice(1) };
}

// CSV 파서는 shared/csv-parser.js 로 통합 (위에서 require). 호출부 호환을 위한 별칭만 유지.
const splitCsvLines = sharedSplitCsvLines;
const parseSimpleCsvRow = sharedParseCsvRow;

async function runJob(job) {
  const log = (level, msg) => {
    addLog(job.id, level, msg);
    console.log(`[${job.id}] [${level}] ${msg}`);
  };

  let childProc = null;
  let cancelInterval = null;
  let cancelInProgress = false;

  // 강제 종료 함수 — 프로세스 그룹 통째로 죽이기 + 안전망
  const forceKill = () => {
    if (cancelInProgress) return;
    cancelInProgress = true;

    log("warn", "취소 요청 감지 — 자식 프로세스 종료 중");

    if (childProc && !childProc.killed && childProc.pid) {
      // v1.7 회귀 방지:
      //  (a) polling/grace timer 즉시 정리 — 캔슬 후 stdin 추가 푸시 방지
      //  (b) stdin.end() 먼저 — claude 가 stream-json input 모드에서 read 대기 중이라
      //      stdin 안 닫으면 SIGTERM 받고도 즉시 안 죽을 수 있음.
      try {
        if (typeof childProc.__cleanupV17 === "function") childProc.__cleanupV17();
      } catch (_) {}
      try {
        if (childProc.stdin && !childProc.stdin.destroyed) {
          childProc.stdin.end();
          log("info", "stdin 종료 (cancel 시 input loop 해제)");
        }
      } catch (_) {}

      // 1) 프로세스 그룹 통째로 SIGTERM (claude + 손자 프로세스까지)
      try {
        process.kill(-childProc.pid, "SIGTERM");
        log("info", `프로세스 그룹 ${childProc.pid} 에 SIGTERM 전송`);
      } catch (err) {
        // 그룹 kill 실패하면 단일 프로세스라도 죽이기
        try { childProc.kill("SIGTERM"); } catch (_) {}
      }

      // 2) 2초 후에도 살아있으면 SIGKILL (그룹 전체 + 후손 BFS)
      setTimeout(() => {
        if (childProc && !childProc.killed && childProc.pid) {
          // 후손 트리 BFS — Playwright MCP 가 spawn 한 Chromium (손자/증손자) 까지 다 잡음
          const killedCount = killDescendantsTree(childProc.pid);
          if (killedCount > 0) log("warn", `후손 프로세스 ${killedCount}개 SIGKILL (Chromium/MCP 포함)`);
          try {
            process.kill(-childProc.pid, "SIGKILL");
            log("warn", `SIGKILL 강제 종료 (그룹 ${childProc.pid})`);
          } catch (_) {
            try { childProc.kill("SIGKILL"); } catch (_) {}
          }
        }
      }, 2000);
    }

    // 3) 5초 안에 close 이벤트 안 오면:
    //    DB 강제 canceled + 좀비 트리 한 번 더 정리 + runReal promise 강제 해제
    //    (이 경로 없으면 runJob 의 finally 가 안 돌아서 running 플래그가 안 풀려 새 잡 클레임 불가)
    setTimeout(() => {
      const currentJob = db.prepare(`SELECT status FROM jobs WHERE id=?`).get(job.id);
      if (currentJob && currentJob.status === "running") {
        log("error", "종료 응답 없음 — DB 강제 canceled + 좀비 트리 정리");
        setStatus(job.id, "canceled", "강제 종료 (claude 응답 없음)");
      }
      // 좀비 트리 마지막 청소: 후손 BFS + 프로세스 그룹 + 본인
      if (childProc && childProc.pid) {
        // 1차: 후손 트리 BFS — Playwright MCP 가 spawn 한 Chromium (--isolated 모드는
        // /var/folders/.../mcp-chrome-XXX 같은 temp dir 사용해서 cwd 매칭 안 됨)
        // PID 트리 추적이 가장 확실.
        const killedCount = killDescendantsTree(childProc.pid);
        if (killedCount > 0) log("warn", `최종 청소: 후손 ${killedCount}개 SIGKILL (Chromium/MCP 포함)`);

        // 2차: 프로세스 그룹 + 본인
        try {
          require("node:child_process").execSync(
            `pkill -9 -P ${childProc.pid} 2>/dev/null; kill -9 -${childProc.pid} 2>/dev/null; kill -9 ${childProc.pid} 2>/dev/null`,
            { stdio: "ignore" }
          );
        } catch (_) {}

        // 3차 (백업): reparent 돼서 트리에서 빠진 chromium 보호. cwd 가 워커 작업 영역인 것만.
        try {
          const cwdPath = require("node:path").join(QA_COWORK_HOME);
          require("node:child_process").execSync(
            `pgrep -fl "playwright|chromium|Chromium" 2>/dev/null | grep -E "${cwdPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|kurly-qa" | awk '{print $1}' | xargs -r kill -9 2>/dev/null`,
            { stdio: "ignore" }
          );
        } catch (_) {}

        // runReal promise 풀어주기 → runJob 의 finally 실행되어 running=false
        if (typeof childProc.__forceResolve === "function") {
          log("warn", "claude close 이벤트 미발사 — runReal promise 강제 해제");
          childProc.__forceResolve();
        }
      }
    }, 5000);
  };

  // 캔슬 감지 인터벌
  cancelInterval = setInterval(() => {
    if (isCancelRequested(job.id) && !cancelInProgress) {
      forceKill();
      clearInterval(cancelInterval);
      cancelInterval = null;
    }
  }, CANCEL_CHECK_MS);

  try {
    const isAdhoc = job.job_type === "adhoc";
    let tcFiles = [];
    let total = 0;
    let filterDesc = null;
    let resultDir;

    if (isAdhoc) {
      log("info", `애드혹 작업 시작: ${job.domain}/${job.platform}/${job.qa_env} [mode=${job.mode}]`);
      const folder = job.task_name ? `adhoc_${job.task_name}` : `adhoc_${job.id}`;
      resultDir = job.mode === "real"
        ? path.join(QA_COWORK_HOME, "test-results", job.domain, folder)
        : path.join(RESULTS_DIR, job.id);
      fs.mkdirSync(resultDir, { recursive: true });
      updateJob(job.id, { result_dir: resultDir });
      log("info", `결과 디렉토리: ${resultDir} (시나리오 수는 AI 가 결정)`);
    } else {
      tcFiles = getJobTcFiles(job);
      const tcLabel = tcFiles.length === 1
        ? tcFiles[0].filename
        : `${tcFiles.length}개 파일 (${tcFiles.map((f) => f.filename).join(", ").slice(0, 120)})`;
      log("info", `작업 시작: ${tcLabel} (${job.domain}/${job.platform}/${job.qa_env}) [mode=${job.mode}]`);

      if (job.mode === "real" && job.task_name) {
        resultDir = path.join(QA_COWORK_HOME, "test-results", job.domain, job.task_name);
      } else if (job.mode === "real") {
        resultDir = path.join(QA_COWORK_HOME, "test-results", job.domain, job.id);
      } else {
        resultDir = path.join(RESULTS_DIR, job.id);
      }
      fs.mkdirSync(resultDir, { recursive: true });
      updateJob(job.id, { result_dir: resultDir });
      log("info", `결과 디렉토리: ${resultDir}`);

      // v1.2: 모든 파일의 행 수 합산
      let rowsTotal = 0;
      const perFileRowCounts = [];
      for (const f of tcFiles) {
        const { rows } = parseTcCsv(f.path);
        perFileRowCounts.push(rows.length);
        rowsTotal += rows.length;
      }
      if (rowsTotal === 0) throw new Error("TC CSV에 데이터 행이 없습니다");
      if (tcFiles.length > 1) {
        log("info", `파일별 행 수: ${tcFiles.map((f, i) => `${f.filename}=${perFileRowCounts[i]}`).join(", ")}`);
      }

      // 필터 적용
      const filter = job.tc_filter ? JSON.parse(job.tc_filter) : null;
      total = rowsTotal;
      if (filter) {
        const parts = [];
        if (filter.priority === "P1") parts.push("Priority=P1 만 실행");
        if (filter.priority === "P1+P2") parts.push("Priority=P1, P2 만 실행");
        if (filter.range) parts.push(`행 범위: ${filter.range[0]}번 ~ ${filter.range[1]}번`);
        filterDesc = parts.join(" / ");
        if (filter.priority === "P1" || filter.priority === "P1+P2") {
          try {
            const summary = job.analyzer_summary ? JSON.parse(job.analyzer_summary) : null;
            const pc = summary?.priorityCounts;
            if (pc) {
              if (filter.priority === "P1") total = pc.P1 || 0;
              else if (filter.priority === "P1+P2") total = (pc.P1 || 0) + (pc.P2 || 0);
            }
          } catch (_) {}
        }
        if (filter.range) total = Math.min(total, filter.range[1] - filter.range[0] + 1);
      }
      updateJob(job.id, { total });
      log("info", `총 ${total}개 케이스 ${filter ? "(필터 적용)" : "감지"}`);
    }

    if (isCancelRequested(job.id)) throw new Error("CANCELED");

    if (job.mode === "real") {
      childProc = await runReal(job, total, log, resultDir, filterDesc, tcFiles, isAdhoc, (p) => { childProc = p; });
    } else if (isAdhoc) {
      await runAdhocMock(job, log, resultDir);
    } else {
      await runMock(job, total, log, resultDir);
    }

    if (isCancelRequested(job.id)) {
      setStatus(job.id, "canceled", "사용자 중단");
      log("warn", "작업이 사용자에 의해 중단됨");
    } else {
      setStatus(job.id, "succeeded");
      log("info", "작업 완료");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "CANCELED" || isCancelRequested(job.id)) {
      setStatus(job.id, "canceled", "사용자 중단");
      log("warn", "작업이 사용자에 의해 중단됨");
    } else {
      log("error", `실패: ${msg}`);
      setStatus(job.id, "failed", msg);
    }
  } finally {
    if (cancelInterval) clearInterval(cancelInterval);
    processedTcResults.delete(job.id);
  }
}

// MOCK 모드
async function runMock(job, total, log, resultDir) {
  log("info", "[MOCK] 시뮬레이션 모드로 실행합니다");
  // v1.7: continue 잡인 경우 DB baseline 카운트를 받아 그 위에 누적, 미처리 케이스만 시뮬레이션
  const isContinue = job.retry_type === "continue";
  let passed = isContinue ? (job.passed || 0) : 0;
  let failed = isContinue ? (job.failed || 0) : 0;
  let blocked = isContinue ? (job.blocked || 0) : 0;
  const startIdx = isContinue ? (job.current_index || passed + failed + blocked) + 1 : 1;
  if (isContinue) {
    log("info", `[MOCK] 이어서 진행 — TC-${startIdx} 부터 ${total - startIdx + 1}건 시뮬레이션 (baseline: P${passed}/F${failed}/B${blocked})`);
  }
  const platformCol = job.platform === "app" ? ",Platform" : "";
  const summary = [`No,Priority,Type,TC Title${platformCol},Test Step,Expected Result,Actual Result,Result,Notes,Screenshot`];
  const failDetail = [`No,Priority,TC Title${platformCol},Expected Result,Actual Result,Fail Reason,Screenshot`];

  for (let i = startIdx; i <= total; i++) {
    if (isCancelRequested(job.id)) {
      log("warn", `${i - 1}개 완료 후 중단됨`);
      throw new Error("CANCELED");
    }
    await sleep(400 + Math.random() * 600);
    const r = Math.random();
    let result;
    if (r > 0.85) { failed++; result = "FAIL"; }
    else if (r > 0.82) { blocked++; result = "BLOCKED"; }
    else { passed++; result = "PASS"; }
    const platformVal = job.platform === "app" ? `,${i % 2 === 0 ? "iOS" : "Android"}` : "";
    summary.push(`${i},P${(i % 3) + 1},기능검증,케이스 ${i}${platformVal},Step ${i},예상 결과,${result === "PASS" ? "예상대로" : "불일치"},${result},,${result !== "BLOCKED" ? `TC-${i}/screenshot.png` : ""}`);
    if (result === "FAIL") {
      failDetail.push(`${i},P${(i % 3) + 1},케이스 ${i}${platformVal},예상,실제,사유: 시뮬레이션 실패,TC-${i}/fail.png`);
    }
    updateJob(job.id, { current_index: i, passed, failed, blocked });
    log(result === "PASS" ? "info" : result === "FAIL" ? "warn" : "info", `${i}/${total} ${result} - 케이스 ${i}`);
  }

  fs.writeFileSync(path.join(resultDir, "summary.csv"), "\uFEFF" + summary.join("\n"), "utf-8");
  fs.writeFileSync(path.join(resultDir, "fail-detail.csv"), "\uFEFF" + failDetail.join("\n"), "utf-8");
  log("info", `결과 파일 저장`);
}

// MOCK 애드혹/API 모드 — AI 안 부르고 시나리오 시뮬레이션 + report.md 생성
async function runAdhocMock(job, log, resultDir) {
  log("info", `[MOCK 애드혹] 시뮬레이션 모드 — 시나리오 6건 자동 생성`);
  const scenarios = 6;
  updateJob(job.id, { total: scenarios });
  const summary = ["No,Priority,Type,TC Title,Test Step,Expected Result,Actual Result,Result,Notes,Screenshot"];
  // v1.7: continue 잡인 경우 baseline 누적
  const isContinue = job.retry_type === "continue";
  let passed = isContinue ? (job.passed || 0) : 0;
  let failed = isContinue ? (job.failed || 0) : 0;
  let blocked = isContinue ? (job.blocked || 0) : 0;
  const startIdx = isContinue ? (job.current_index || passed + failed + blocked) + 1 : 1;
  if (isContinue) {
    log("info", `[MOCK 애드혹] 이어서 — TC-${startIdx} 부터 ${Math.max(0, scenarios - startIdx + 1)}건 (baseline: P${passed}/F${failed}/B${blocked})`);
  }
  const failed_items = [];
  for (let i = startIdx; i <= scenarios; i++) {
    if (isCancelRequested(job.id)) { log("warn", `${i - 1}건 완료 후 중단됨`); throw new Error("CANCELED"); }
    await sleep(500 + Math.random() * 700);
    const types = ["정상", "엣지", "부정", "회귀"];
    const t = types[(i - 1) % types.length];
    const r = Math.random();
    let result;
    if (r > 0.75) { failed++; result = "FAIL"; failed_items.push({ no: i, type: t }); }
    else if (r > 0.7) { blocked++; result = "BLOCKED"; }
    else { passed++; result = "PASS"; }
    summary.push(`${i},P${(i % 3) + 1},${t},애드혹 시나리오 ${i} (${t}),Step,Expected,${result === "PASS" ? "예상대로" : "불일치"},${result},,${result === "FAIL" ? `TC-${i}/fail.png` : ""}`);
    updateJob(job.id, { current_index: i, passed, failed, blocked });
    log(result === "FAIL" ? "warn" : "info", `TC-${i} ${result}: 애드혹 시나리오 ${i} (${t})`);
  }
  fs.writeFileSync(path.join(resultDir, "summary.csv"), "﻿" + summary.join("\n"), "utf-8");
  const failedSection = failed_items.length === 0
    ? "- (없음)"
    : failed_items.map((f) => `### [중간] 애드혹 시나리오 ${f.no} (${f.type}) 실패\n- 재현 단계: (시뮬)\n- 기대 vs 실제: (시뮬)\n- 스크린샷: TC-${f.no}/fail.png`).join("\n\n");
  const report = `# 애드혹 테스트 리포트 (mock)

## 요약
- 시나리오 ${scenarios}건 · PASS ${passed} / FAIL ${failed} / BLOCKED ${blocked}
- 도메인: ${job.domain} · 플랫폼: ${job.platform === "app" ? "앱" : "웹"} · 환경: ${job.qa_env}
${job.adhoc_focus ? `- 포커스: ${job.adhoc_focus.trim().slice(0, 200)}` : ""}

## 발견된 버그
${failedSection}

## 의문점 / 추가 검증 필요
- (mock — 실제 실행 시 AI가 채움)

## 테스트 범위
- 정상/엣지/부정/회귀 4가지 타입을 순환하며 총 ${scenarios}건 시뮬레이션
- 다루지 못한 영역: (mock)

## 추천 다음 액션
- (mock — 실제 실행 시 AI가 채움)
`;
  fs.writeFileSync(path.join(resultDir, "report.md"), report, "utf-8");
  log("info", "결과 파일 저장 (summary.csv, report.md)");
}

// REAL 모드
function runReal(job, total, log, resultDir, filterDesc, tcFiles, isAdhoc = false, onSpawn = null) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(QA_COWORK_HOME)) {
      return reject(new Error(`QA-Cowork 폴더 없음: ${QA_COWORK_HOME}`));
    }
    const resolution = resolvePrompts(job.domain, job.platform);
    if (!fs.existsSync(resolution.basePromptPath)) return reject(new Error(`베이스 프롬프트 없음: ${resolution.basePromptPath}`));
    if (resolution.domainPromptPath && !fs.existsSync(resolution.domainPromptPath)) {
      return reject(new Error(`도메인 프롬프트 경로가 잘못됨: ${resolution.domainPromptPath}`));
    }
    if (resolution.isFallback) {
      log("warn", `${job.domain}/${job.platform} — fallback 모드 (도메인 전용 프롬프트 없음, 공통 베이스 + knowledge/ 만 사용)`);
    }

    const taskName = job.task_name || job.id;
    const message = isAdhoc
      ? buildAdhocMessage({
          domain: job.domain,
          platform: job.platform,
          qaEnv: job.qa_env,
          taskName,
          resultDirAbsPath: resultDir,
          resolution,
          additionalInstructions: job.additional_instructions || null,
          specUrl: job.spec_url || null,
          specFilename: job.spec_filename || null,
          specText: job.spec_text || null,
          adhocFocus: job.adhoc_focus || null,
        })
      : buildClaudeMessage({
          domain: job.domain,
          platform: job.platform,
          qaEnv: job.qa_env,
          taskName,
          tcCsvAbsPath: job.tc_path,
          resultDirAbsPath: resultDir,
          resolution,
          filterDesc,
          additionalInstructions: job.additional_instructions || null,
          specUrl: job.spec_url || null,
          specFilename: job.spec_filename || null,
          specText: job.spec_text || null,
          jobId: job.id,
          tcFiles: tcFiles && tcFiles.length > 0 ? tcFiles : [{ path: job.tc_path, filename: job.tc_filename }],
        });
    updateJob(job.id, { generated_prompt: message });
    fs.writeFileSync(path.join(resultDir, "_admin_prompt.md"), message, "utf-8");
    log("info", `생성된 메시지를 _admin_prompt.md 에 저장 (${message.length} chars)`);

    // v1.7: platform 별 MCP 설정을 잡 result_dir 에 작성 (디버깅 위해 임시 폴더 X)
    const mcpConfig = buildMcpConfig(job.platform);
    const mcpConfigPath = path.join(resultDir, "_mcp.json");
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf-8");
    log("info", `MCP 설정 작성: platform=${job.platform} → ${Object.keys(mcpConfig.mcpServers).join(", ")}`);

    // v1.7: stream-json input 모드 + 잡별 mcp-config (platform 격리)
    // v1.7.5 잡별 모델 우선 — 폼에서 지정 안 했으면 워커 env default
    const effectiveModel = (job.claude_model && job.claude_model.trim()) || CLAUDE_MODEL;
    if (isCodexModel(effectiveModel)) {
      log("info", `Codex CLI 실행 (cwd=${QA_COWORK_HOME})`);
      log("info", `사용 모델: ${effectiveModel}${job.claude_model ? " (잡에서 지정)" : " (워커 default)"}`);
      runCodexExec(message, effectiveModel, QA_COWORK_HOME, 90 * 60 * 1000).then((r) => {
        if (r.output) {
          fs.writeFileSync(path.join(resultDir, "_codex_output.md"), r.output, "utf-8");
          updateCountsFromText(job, r.output);
          log("info", r.output.trim().slice(0, 1000));
        }
        finalizeFromResultDir(job, resultDir, log);
        if (r.ok || isCancelRequested(job.id)) resolve(null);
        else reject(new Error(r.failReason || "codex 실행 실패"));
      }).catch(reject);
      return;
    }

    log("info", `Claude Code 실행 (cwd=${QA_COWORK_HOME})`);
    log("info", `사용 모델: ${effectiveModel}${job.claude_model ? " (잡에서 지정)" : " (워커 default)"}`);
    const proc = spawn(
      CLAUDE_BIN,
      [
        "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--model", effectiveModel,
        "--mcp-config", mcpConfigPath,
        "--strict-mcp-config",  // 다른 mcp 설정 무시 — platform 격리 강제
      ],
      {
        cwd: QA_COWORK_HOME,
        env: { ...process.env },
        detached: true,
      }
    );

    // spawn 즉시 runJob 에 proc 핸들 전달. (이게 없으면 childProc 이 await 후에야 채워져서
    // 실행 중 forceKill 의 kill 명령·__forceResolve 가 전부 `if (childProc)` 가드에서 스킵됨 → cancel 무력화)
    if (typeof onSpawn === "function") { try { onSpawn(proc); } catch (_) {} }

    let resolved = false;
    const safeResolve = (v) => { if (!resolved) { resolved = true; resolve(v); } };
    const safeReject = (e) => { if (!resolved) { resolved = true; reject(e); } };
    proc.__forceResolve = () => safeResolve(proc);

    // stream-json input: 한 줄당 1개 user 메시지
    function writeUserMessage(text) {
      try {
        const payload = JSON.stringify({
          type: "user",
          message: { role: "user", content: text },
        }) + "\n";
        proc.stdin.write(payload);
      } catch (err) {
        log("warn", `stdin write 실패: ${err.message}`);
      }
    }

    // 첫 메시지(prompt) 전달, stdin 은 닫지 않음 — turn 사이 추가 user 메시지 받을 수 있도록
    writeUserMessage(message);

    // v1.7 끼어들기 polling — pending 메시지 있으면 stdin push
    const messagePoller = setInterval(() => {
      if (resolved) return;
      try {
        const next = takeNextPendingMessage(job.id);
        if (next) {
          log("info", `🗨️ 사용자 추가 명령: ${next.content.slice(0, 120)}${next.content.length > 120 ? "..." : ""}`);
          writeUserMessage(next.content);
        }
      } catch (err) {
        log("warn", `메시지 polling 실패: ${err.message}`);
      }
    }, 2000);

    // 자연 종료 시점 감지용 플래그 — result 메시지 받으면 1초 grace 후 stdin.end()
    let resultReceived = false;
    let finalizeTimer = null;
    const scheduleFinalize = () => {
      if (finalizeTimer) clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(() => {
        // grace 동안 새 pending 있으면 push 후 다시 대기
        try {
          const next = takeNextPendingMessage(job.id);
          if (next) {
            log("info", `🗨️ 종료 직전 추가 명령: ${next.content.slice(0, 120)}`);
            writeUserMessage(next.content);
            resultReceived = false;  // 다음 result 까지 다시 대기
            return;
          }
        } catch (_) {}
        log("info", "Claude 작업 완료 — stdin 종료");
        try { proc.stdin.end(); } catch (_) {}
      }, 3000);
    };
    proc.__onResult = () => {
      if (!resultReceived) {
        resultReceived = true;
        log("info", "Claude result 수신 — 3초 grace (추가 명령 가능)");
      }
      scheduleFinalize();
    };

    // v1.7: cancel 시 forceKill 에서 polling/timer 즉시 정리할 수 있도록 cleanup 노출
    proc.__cleanupV17 = () => {
      try { clearInterval(messagePoller); } catch (_) {}
      try { if (finalizeTimer) clearTimeout(finalizeTimer); } catch (_) {}
    };

    // 청크 경계의 멀티바이트(한글) 깨짐(U+FFFD) 방지 — StringDecoder 가 불완전 시퀀스를 버퍼링.
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    let stdoutBuffer = "";
    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        handleStreamLine(line, job, log, proc);
      }
    });
    proc.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) log("warn", `[stderr] ${text.slice(0, 500)}`);
    });
    proc.on("close", (code) => {
      clearInterval(messagePoller);
      if (finalizeTimer) clearTimeout(finalizeTimer);
      if (stdoutBuffer.trim()) {
        try { handleStreamLine(stdoutBuffer, job, log, proc); } catch (_) {}
      }
      finalizeFromResultDir(job, resultDir, log);
      if (isCancelRequested(job.id)) {
        log("warn", `claude 프로세스 종료 (code=${code}, 캔슬됨)`);
        safeResolve(proc);
      } else if (code === 0) {
        safeResolve(proc);
      } else {
        safeReject(new Error(`claude 프로세스가 코드 ${code}로 종료됨`));
      }
    });
    proc.on("error", (err) => {
      clearInterval(messagePoller);
      if (finalizeTimer) clearTimeout(finalizeTimer);
      safeReject(err);
    });

    // Promise resolve를 위해 즉시 외부에 proc 전달
    // (참고: runReal 호출자가 await로 받음)
  });
}

function handleStreamLine(line, job, log, proc) {
  let parsed;
  try { parsed = JSON.parse(line); }
  catch { log("info", line.slice(0, 300)); return; }

  if (parsed.type === "assistant" && parsed.message?.content) {
    for (const c of parsed.message.content) {
      if (c.type === "text" && c.text) {
        const txt = c.text.trim();
        if (txt) {
          log("info", txt.slice(0, 300));
          updateCountsFromText(job, txt);
        }
      } else if (c.type === "tool_use") {
        log("info", `🔧 도구 호출: ${c.name}`);
      }
    }
  } else if (parsed.type === "result") {
    if (parsed.subtype === "success") log("info", "✅ Claude turn 종료: success");
    else log("warn", `Claude turn 종료: ${parsed.subtype}`);
    // v1.7: turn 끝 → 끼어들기 grace 시작 (없으면 stdin.end → claude 자연 종료)
    if (proc && typeof proc.__onResult === "function") proc.__onResult();
  } else if (parsed.type === "system") {
    if (parsed.subtype === "init") log("info", `Claude 세션 시작 (model=${parsed.model || "?"})`);
  }
}

// 강한 매칭: TC 와 결과가 거의 붙어 있을 때 ("TC-72 PASS", "TC-32: PASS")
const TC_PATTERN_STRICT = /TC[-_\s]?(\d+)\s*[:\-]?\s*(PASS|FAIL|BLOCKED)\b/gi;
// 같은 (jobId, idx, result) 중복 카운트 방지
const processedTcResults = new Map(); // jobId -> Set<"idx:result">

function updateCountsFromText(job, text) {
  let processed = processedTcResults.get(job.id);
  if (!processed) { processed = new Set(); processedTcResults.set(job.id, processed); }

  const candidates = [];
  // 1) Strict — 가까운 페어링
  for (const m of text.matchAll(TC_PATTERN_STRICT)) {
    candidates.push({ idx: parseInt(m[1], 10), result: m[2].toUpperCase() });
  }
  // 2) 라인 단위 느슨 매칭 — "TC-N: <긴 설명> ... RESULT 처리" 같은 케이스 보강
  //    한 라인에 TC 번호가 1개만 있고 결과 단어가 1개 이상이면 페어링 (거짓 페어링 방지 위해 TC 1개 조건)
  for (const line of text.split(/[\r\n]+/)) {
    const tcs = [...line.matchAll(/\bTC[-_\s]?(\d+)\b/gi)];
    if (tcs.length !== 1) continue;
    const results = [...line.matchAll(/\b(PASS|FAIL|BLOCKED)\b/gi)];
    if (results.length === 0) continue;
    const idx = parseInt(tcs[0][1], 10);
    const words = results.map((r) => r[1].toUpperCase());
    // 같은 라인에 여러 결과 단어면 우선순위: BLOCKED > FAIL > PASS
    const result = words.includes("BLOCKED") ? "BLOCKED"
                 : words.includes("FAIL")    ? "FAIL"
                 : "PASS";
    candidates.push({ idx, result });
  }

  if (candidates.length === 0) return;

  const current = db.prepare(`SELECT passed, failed, blocked, current_index FROM jobs WHERE id=?`).get(job.id);
  const patch = { passed: current.passed, failed: current.failed, blocked: current.blocked };
  let maxIdx = current.current_index;
  let changed = false;
  for (const c of candidates) {
    const key = `${c.idx}:${c.result}`;
    if (processed.has(key)) continue;
    processed.add(key);
    if (c.result === "PASS") patch.passed++;
    else if (c.result === "FAIL") patch.failed++;
    else if (c.result === "BLOCKED") patch.blocked++;
    if (c.idx > maxIdx) maxIdx = c.idx;
    changed = true;
  }
  if (changed) {
    patch.current_index = maxIdx;
    updateJob(job.id, patch);
  }
}

function finalizeFromResultDir(job, resultDir, log) {
  const summaryPath = path.join(resultDir, "summary.csv");
  if (!fs.existsSync(summaryPath)) {
    log("warn", "summary.csv가 생성되지 않았습니다");
    return;
  }
  try {
    const text = fs.readFileSync(summaryPath, "utf-8").replace(/^\uFEFF/, "");
    // v0.4b 버그 수정: 따옴표 안의 줄바꿈 고려
    const lines = splitCsvLines(text);
    if (lines.length < 2) return;
    const header = lines[0].split(",");
    const resultIdx = header.findIndex((h) => h.trim().toLowerCase() === "result");
    if (resultIdx < 0) return;
    let passed = 0, failed = 0, blocked = 0;
    for (let i = 1; i < lines.length; i++) {
      // 단순 split(',') 대신 따옴표 처리하는 파서 사용
      const cells = parseSimpleCsvRow(lines[i]);
      const r = (cells[resultIdx] || "").trim().toUpperCase();
      if (r === "PASS") passed++;
      else if (r === "FAIL") failed++;
      else if (r === "BLOCKED") blocked++;
    }
    updateJob(job.id, { passed, failed, blocked, current_index: lines.length - 1 });
    log("info", `최종 집계: PASS=${passed} FAIL=${failed} BLOCKED=${blocked}`);
  } catch (err) {
    log("warn", `summary.csv 파싱 실패: ${err.message}`);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============== 메인 루프 ==============
console.log(`[worker] v0.3 시작`);
console.log(`[worker] DB: ${DB_PATH}`);
console.log(`[worker] Results (mock): ${RESULTS_DIR}`);
console.log(`[worker] QA-Cowork home: ${QA_COWORK_HOME} ${fs.existsSync(QA_COWORK_HOME) ? "✓" : "✗"}`);
console.log(`[worker] Claude bin: ${CLAUDE_BIN}`);
console.log(`[worker] Claude model: ${CLAUDE_MODEL} (CLAUDE_MODEL env 로 변경 가능)`);

// 워커 시작 시 좀비 Job 자동 정리
// (이전 워커 인스턴스가 비정상 종료되면서 'running' 상태로 박혀있는 Job 들)
const zombieJobs = db.prepare(`
  SELECT id, tc_filename FROM jobs WHERE status='running'
`).all();
if (zombieJobs.length > 0) {
  console.log(`[worker] ⚠️  ${zombieJobs.length}건의 좀비 Job 발견 — 자동 정리`);
  for (const z of zombieJobs) {
    console.log(`[worker]   - ${z.id} (${z.tc_filename}) → canceled`);
    db.prepare(`
      UPDATE jobs 
      SET status='canceled', error_message='워커 재시작 시 좀비 정리', 
          finished_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).run(z.id);
    db.prepare(`
      INSERT INTO job_logs (job_id, level, message) 
      VALUES (?, 'warn', '워커가 재시작되면서 이 Job 이 자동으로 취소되었습니다')
    `).run(z.id);
  }
}

// 주기적 헬스체크 — 캔슬 요청된 지 2분 지나도 안 끝난 Job 강제 정리
setInterval(() => {
  const stale = db.prepare(`
    SELECT id FROM jobs
    WHERE status='running'
      AND cancel_requested=1
      AND datetime(updated_at) < datetime('now', '-2 minutes')
  `).all();
  for (const s of stale) {
    console.log(`[worker] 헬스체크: ${s.id} 캔슬 후 2분 무응답 → 강제 canceled`);
    db.prepare(`
      UPDATE jobs 
      SET status='canceled', error_message='헬스체크: 취소 요청 후 응답 없음',
          finished_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).run(s.id);
  }
}, 60 * 1000); // 1분마다 체크

// v1.7 multi-concurrency: 한 워커가 동시 N잡 처리 (PoC 병렬 검증용)
// 기본 1 (직렬) — env 로 늘림. PC 사양 고려 (REAL 잡 1개당 Chrome + Playwright 추가 spawn → 보통 2~3 권장)
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.WORKER_MAX_CONCURRENT || "1", 10));
let activeJobs = 0;
const activeJobIds = new Set();
console.log(`[worker] 동시 처리 슬롯: ${MAX_CONCURRENT} (WORKER_MAX_CONCURRENT 로 조정)`);

function updateSelfSlotState() {
  // 내부 워커가 workers 테이블의 자기 row 에 active_jobs / max_concurrent 직접 갱신
  // version='builtin' 마커 — 빌트인 워커는 어드민 내장이라 '재설치 대상' 아님(업데이트 배너에서 제외).
  try {
    db.prepare(
      `UPDATE workers SET active_jobs=?, max_concurrent=?, version='builtin', last_heartbeat=datetime('now'),
         status=CASE WHEN ? > 0 THEN 'busy' ELSE 'online' END
       WHERE name=?`
    ).run(activeJobs, MAX_CONCURRENT, activeJobs, BUILTIN_WORKER_NAME);
  } catch (_) { /* workers row 없을 수도 — 무시 */ }
}

async function loop() {
  // idle 상태에도 heartbeat / max_concurrent 갱신 (어드민 UI 의 슬롯 표시 정확하게 유지)
  updateSelfSlotState();
  // 빈 슬롯 있을 때까지 즉시 추가 claim — runJob 은 fire-and-forget (await X)
  while (activeJobs < MAX_CONCURRENT) {
    const job = claimNextPending();
    if (!job) break;
    activeJobs++;
    activeJobIds.add(job.id);
    updateSelfSlotState();
    console.log(`[worker] ▶ claim ${job.id} (slot ${activeJobs}/${MAX_CONCURRENT})`);
    runJob(job)
      .catch((err) => console.error(`[worker] runJob ${job.id} 에러:`, err))
      .finally(() => {
        activeJobs--;
        activeJobIds.delete(job.id);
        updateSelfSlotState();
        console.log(`[worker] ◀ release ${job.id} (slot ${activeJobs}/${MAX_CONCURRENT})`);
      });
  }
}

setInterval(loop, POLL_MS);

// ============== TC 설계/작성 분배 처리 (워커 로컬 claude -p) ==============
// admin 이 tc_gen_jobs 에 pending 으로 쌓아둔 TC설계/작성 잡을 가져와 이 워커의 claude 로 실행.
// (테스트 수행과 동일하게 워커 분산 — 각 워커 claude 토큰. brain=admin(조립/CSV추출), 워커=실행기.)
const TC_GEN_TIMEOUT_MS = 10 * 60 * 1000;
// 하네스(오케스트레이터) 모드 — admin 이 __HARNESS__ 프롬프트로 보낸 잡은 워커 클론의 하네스를 claude -p 로 실행.
const KURLY_HARNESS_PATH = process.env.KURLY_HARNESS_PATH || "";
const TC_GEN_HARNESS_TIMEOUT_MS = Math.max(1, parseInt(process.env.WORKER_HARNESS_TIMEOUT_MIN || "75", 10)) * 60 * 1000;
// 한 머신 동시 하네스 잡 수 — 잡별 격리 cwd(_jobs/<id>)라 충돌 없음. 기본 1(자원 안전), 사무실 등은 .env.local 에서 상향.
const HARNESS_MAX_CONCURRENT = Math.max(1, parseInt(process.env.WORKER_HARNESS_CONCURRENT || "1", 10));
// TC설계/작성 동시 실행 수 — 설계/작성은 브라우저 없이 claude 분석만 해서 병렬이 가벼움(수행 MAX_CONCURRENT 와 별개). 기본 3.
const TCGEN_MAX_CONCURRENT = Math.max(1, parseInt(process.env.WORKER_TCGEN_CONCURRENT || "3", 10));
let tcGenActive = 0;

function isCodexModel(model) {
  return String(model || "").trim().toLowerCase().startsWith("codex");
}

function runCodexExec(prompt, model, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let proc;
    const args = [
      "exec",
      "-",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--color", "never",
    ];
    const m = String(model || "").trim();
    if (m && m !== "codex") args.push("--model", m.replace(/^codex:/, ""));
    try {
      proc = spawn(CODEX_BIN, args, { cwd, env: { ...process.env } });
    } catch (err) {
      resolve({ ok: false, output: "", failReason: `codex 실행 불가: ${err.message}` }); return;
    }
    let out = "", errBuf = "", done = false;
    const timer = setTimeout(() => { if (!done) { try { proc.kill("SIGKILL"); } catch {} } }, timeoutMs);
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => { out += c; });
    proc.stderr.on("data", (c) => { errBuf += c; });
    proc.stdin.on("error", (err) => { errBuf += `\nstdin ${err.code || "error"}: ${err.message}`; });
    try {
      proc.stdin.write(prompt, (err) => { if (err) errBuf += `\nstdin write: ${err.message}`; });
      proc.stdin.end();
    } catch (err) {
      errBuf += `\nstdin write: ${err.message}`;
    }
    proc.on("error", (err) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: false, output: out, failReason: `codex spawn 실패: ${err.message}` }); });
    proc.on("close", (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: code === 0, output: out, failReason: code === 0 ? undefined : `codex 종료 코드 ${code}${errBuf.trim() ? ` (${errBuf.trim().slice(0, 200)})` : ""}` }); });
  });
}

function runClaudeP(prompt, model, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(CLAUDE_BIN, ["-p", "--model", model, "--dangerously-skip-permissions", "--strict-mcp-config"], {
        cwd, env: { ...process.env },
      });
    } catch (err) {
      resolve({ ok: false, output: "", failReason: `claude 실행 불가: ${err.message}` }); return;
    }
    let out = "", errBuf = "", done = false;
    const timer = setTimeout(() => { if (!done) { try { proc.kill("SIGKILL"); } catch {} } }, timeoutMs);
    // setEncoding('utf8') → Node StringDecoder 가 청크 경계에서 잘린 멀티바이트(한글 등)를 버퍼링해 디코딩.
    // (없으면 chunk.toString() 이 청크마다 독립 디코딩해 경계의 한글이 U+FFFD(�)로 깨짐 — TC CSV 한글 깨짐 원인)
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => { out += c; });
    proc.stderr.on("data", (c) => { errBuf += c; });
    try { proc.stdin.write(prompt); proc.stdin.end(); } catch {}
    proc.on("error", (err) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: false, output: out, failReason: `claude spawn 실패: ${err.message}` }); });
    proc.on("close", (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: code === 0, output: out, failReason: code === 0 ? undefined : `claude 종료 코드 ${code}${errBuf.trim() ? ` (${errBuf.trim().slice(0, 200)})` : ""}` }); });
  });
}

// 비-하네스(레거시 단순 스킬) tc-gen — claude stdout 이 곧 CSV
function runTcGenClaude(prompt, model) {
  if (isCodexModel(model)) return runCodexExec(prompt, model, os.tmpdir(), TC_GEN_TIMEOUT_MS);
  return runClaudeP(prompt, model, os.tmpdir(), TC_GEN_TIMEOUT_MS);
}

const DATA_REQUEST_TIMEOUT_MS = Math.max(1, parseInt(process.env.WORKER_DATA_REQUEST_TIMEOUT_MIN || "15", 10)) * 60 * 1000;
const DATA_REQUEST_MAX_CONCURRENT = Math.max(1, parseInt(process.env.WORKER_DATA_REQUEST_CONCURRENT || "1", 10));
let dataRequestActive = 0;

function getDataAgentRolesForWorker(worker) {
  try {
    const mode = db.prepare(`SELECT mode FROM worker_agent_settings WHERE worker_name=? AND grp='data'`).get(worker)?.mode;
    if (mode !== "multi") return [];
    return db.prepare(`
      SELECT nickname, instruction
      FROM worker_agents
      WHERE worker_name=? AND grp='data'
      ORDER BY sort_order, id
    `).all(worker);
  } catch {
    return [];
  }
}

function formatDataAgentRolesBlock(agents) {
  if (!agents || agents.length === 0) return "";
  const defaults = [
    "요청 TC의 사전조건/기대결과를 분석해 필요한 데이터 종류와 상태를 확정한다.",
    "사용 가능한 테스트 데이터 페이지/API를 선택하고 최소 데이터만 생성 또는 준비한다.",
    "생성/준비된 데이터가 TC 사전조건을 만족하는지 검증하고 수행 에이전트에게 전달할 dataContext를 확정한다.",
  ];
  return `
## 테스트데이터 멀티 에이전트 역할 분담 (반드시 순서대로 수행)
이 요청은 테스트데이터 멀티 모드다. 아래 에이전트들이 하나의 요청을 순차 협업한다고 가정하고, 각 역할의 판단을 모두 반영한다.
${agents.map((a, i) => `- ${i + 1}. ${a.nickname}: ${(a.instruction || defaults[i] || defaults[defaults.length - 1]).trim()}`).join("\n")}

역할 수행 규칙:
- 첫 번째 에이전트는 필요한 데이터와 입력/제약을 분석한다.
- 두 번째 에이전트는 안전한 생성/조회/세팅 계획을 세우고 실제 준비를 담당한다.
- 세 번째 에이전트는 준비된 데이터가 TC 사전조건을 만족하는지 검증한다.
- 검증 에이전트가 확인하지 못한 데이터는 READY로 반환하지 않는다. 이 경우 BLOCKED 또는 FAILED로 반환한다.
- 최종 JSON의 agentFlow에는 각 에이전트가 한 일을 1문장씩 기록한다.
`;
}

function buildDataRequestWorkerPrompt(req, dataAgents = []) {
  return `너는 jjongqa V2의 테스트데이터 생성 담당 B 에이전트다.

중앙 큐에서 아래 요청 1건을 claim 했다. 이 요청만 처리하고 종료한다.

## 요청
- 요청 ID: ${req.id}
- 원 수행 잡: ${req.source_job_id || "(없음)"}
- 요청 수행 에이전트: ${req.source_agent || "(미상)"}
- 대상 TC: ${req.tc_ref || "(미상)"}
- 필요한 데이터: ${req.need}
- 필요한 이유: ${req.reason || "(미기재)"}
- 입력/제약: ${req.inputs || "{}"}
- 후보 도구: ${req.preferred_tool || "unknown"}

${formatDataAgentRolesBlock(dataAgents)}

## 처리 원칙
- STG/QA 테스트 데이터만 생성하거나 조회한다. 운영(production)은 절대 접근하지 않는다.
- 3P OpenAPI 콘솔은 무조건 제외한다. 3P 키워드는 상품등록/상품상세 테스트 데이터 맥락으로만 해석한다.
- 이미 쓸 수 있는 데이터가 있으면 새로 만들지 말고 재사용 가능한 dataContext로 정리한다.
- 새로 생성해야 하면 ${ADMIN_URL}/test-data 페이지 또는 ${ADMIN_URL}/api/test-data/* API 중 요청에 맞는 안전한 도구만 사용한다.
- 필수 입력값/권한/계정/토큰이 부족하면 임의 생성하지 말고 BLOCKED로 반환한다.
- 생성 또는 선택한 데이터가 TC 사전조건을 만족하는지 가능한 방식으로 검증한다.
- READY로 반환할 때 수행 에이전트가 바로 이어 쓸 수 있는 핵심 식별자와 값은 반드시 dataContext에 넣는다.
  예: memberNo/loginId/password, orderNo, coupon_publish_id/accessKey/couponCode, dealProductNo 등.
- notes에는 주의사항만 적고, 수행에 필요한 값은 notes에만 남기지 않는다.

## 출력
반드시 아래 JSON 하나만 출력한다. 설명 문장, 마크다운, 코드펜스 없이 JSON만 출력한다.
출력의 첫 글자는 반드시 { 이고, 마지막 글자는 반드시 } 이어야 한다. JSON 앞뒤에 문장을 쓰지 않는다.
아래 스키마 밖의 닫는 괄호나 추가 텍스트를 절대 붙이지 않는다.

{
  "status": "READY | BLOCKED | FAILED",
  "dataContext": {
    "key": "value"
  },
  "agentFlow": {
    "데이터": "필요 데이터 분석 결과",
    "셋업": "생성/조회/세팅 수행 결과",
    "검증": "사전조건 만족 여부 검증 결과"
  },
  "verification": "어떻게 검증했고 결과가 어땠는지",
  "notes": "수행 에이전트가 이어서 사용할 경로/주의점",
  "errorMessage": "BLOCKED 또는 FAILED일 때만 이유"
}
`;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function enrichDataContextFromText(dataContext, text) {
  const ctx = isPlainObject(dataContext) ? { ...dataContext } : {};
  const src = String(text || "");
  const patterns = [
    ["coupon_publish_id", /\bcoupon_publish_id\s*[:=]\s*([A-Za-z0-9_-]+)/i],
    ["couponPublishId", /\bcouponPublishId\s*[:=]\s*([A-Za-z0-9_-]+)/i],
    ["accessKey", /\baccessKey\s*[:=]\s*([A-Za-z0-9_-]+)/i],
    ["couponCode", /\bcouponCode\s*[:=]\s*([A-Za-z0-9_-]+)/i],
    ["memberNo", /\bmemberNo\s*[:=]\s*([A-Za-z0-9_-]+)/i],
    ["memberId", /\bmemberId\s*[:=]\s*([A-Za-z0-9_.@-]+)/i],
    ["loginId", /\bloginId\s*[:=]\s*([A-Za-z0-9_.@-]+)/i],
    ["password", /\bpassword\s*[:=]\s*([^\s,/]+)/i],
    ["orderNo", /\borderNo\s*[:=]\s*([A-Za-z0-9_-]+)/i],
    ["dealProductNo", /\bdealProductNo\s*[:=]\s*([A-Za-z0-9_-]+)/i],
  ];
  for (const [key, re] of patterns) {
    if (ctx[key] != null) continue;
    const m = src.match(re);
    if (m?.[1]) ctx[key] = m[1];
  }
  return ctx;
}

function extractFirstJsonObject(text) {
  const src = String(text || "");
  for (let start = src.indexOf("{"); start >= 0; start = src.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") { inString = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
        if (depth < 0) break;
      }
    }
  }
  return null;
}

function parseDataRequestOutput(output) {
  const text = String(output || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : text;
  const raw = extractFirstJsonObject(source);
  try {
    if (!raw) throw new Error("JSON 객체를 찾지 못했습니다");
    const parsed = JSON.parse(raw);
    const status = String(parsed.status || "").trim().toLowerCase();
    const agentFlow = parsed.agentFlow ?? parsed.roleReport ?? parsed.agentReport ?? null;
    const notes = [
      parsed.notes || "",
      agentFlow ? `agentFlow: ${JSON.stringify(agentFlow)}` : "",
    ].filter(Boolean).join("\n");
    const dataContext = enrichDataContextFromText(
      parsed.dataContext ?? parsed.resultContext ?? {},
      [parsed.notes, parsed.verification, output].filter(Boolean).join("\n")
    );
    return {
      status: status === "ready" ? "ready" : status === "blocked" ? "blocked" : "failed",
      dataContext,
      verification: parsed.verification || "",
      notes,
      errorMessage: parsed.errorMessage || "",
      rawOutput: output,
    };
  } catch (err) {
    return {
      status: "failed",
      dataContext: {},
      verification: "",
      notes: "",
      errorMessage: `데이터 에이전트 출력 JSON 파싱 실패: ${err.message}`,
      rawOutput: output,
    };
  }
}

async function reportDataRequestResult(id, result) {
  const res = await fetch(`${ADMIN_URL}/api/data-requests/${encodeURIComponent(id)}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
  if (!res.ok) throw new Error(`data request result report failed: ${res.status}`);
}

async function pollDataRequests() {
  if (dataRequestActive >= DATA_REQUEST_MAX_CONCURRENT) return;
  let req;
  try {
    const res = await fetch(`${ADMIN_URL}/api/data-requests/next?worker=${encodeURIComponent(BUILTIN_WORKER_NAME)}`);
    if (res.ok) req = (await res.json()).request;
  } catch {
    return;
  }
  if (!req) return;
  dataRequestActive++;
  console.log(`[worker] ▶ data request ${req.id} claim (${dataRequestActive}/${DATA_REQUEST_MAX_CONCURRENT})`);
  try {
    const dataAgents = getDataAgentRolesForWorker(BUILTIN_WORKER_NAME);
    if (dataAgents.length > 0) console.log(`[worker] data agents: ${dataAgents.map((a) => a.nickname).join(" → ")}`);
    const prompt = buildDataRequestWorkerPrompt(req, dataAgents);
    const r = await runClaudeP(prompt, CLAUDE_MODEL, QA_COWORK_HOME, DATA_REQUEST_TIMEOUT_MS);
    const parsed = r.ok
      ? parseDataRequestOutput(r.output)
      : { status: "failed", dataContext: {}, verification: "", notes: "", errorMessage: r.failReason || "데이터 에이전트 실행 실패", rawOutput: r.output };
    await reportDataRequestResult(req.id, parsed);
    console.log(`[worker] ✓ data request ${req.id} → ${parsed.status}`);
  } catch (err) {
    try {
      await reportDataRequestResult(req.id, {
        status: "failed",
        dataContext: {},
        verification: "",
        notes: "",
        errorMessage: err instanceof Error ? err.message : String(err),
        rawOutput: "",
      });
    } catch {}
    console.error(`[worker] data request ${req.id} 실패:`, err);
  } finally {
    dataRequestActive--;
    console.log(`[worker] ◀ data request ${req.id} release (${dataRequestActive}/${DATA_REQUEST_MAX_CONCURRENT})`);
  }
}

// ── 하네스 모드 ──
// admin 프롬프트 형식: 1행 "__HARNESS__ bu=<logistics|commerce> domain=<키워드>" + <<<SPEC\n...\nSPEC>>> 블록
function parseHarnessPrompt(prompt) {
  const firstLine = prompt.split("\n", 1)[0] || "";
  const bu = (firstLine.match(/bu=(\S+)/) || [])[1] || "logistics";
  const domain = ((firstLine.match(/domain=(.+?)(?:\s+\w+=|$)/) || [])[1] || "").trim();
  const m = prompt.match(/<<<SPEC\n([\s\S]*?)\nSPEC>>>/);
  return { bu: bu === "commerce" ? "commerce" : "logistics", domain, spec: m ? m[1] : "" };
}

function buildHarnessTrigger(bu, domain, specFile, wsName) {
  const teamPhrase = bu === "commerce" ? "커머스 TC 팀 실행" : "물류 TC 팀 실행";
  const skillPath = bu === "commerce"
    ? ".claude/skills/commerce-qa-orchestrator/SKILL.md"
    : ".claude/skills/logistics-qa-orchestrator/SKILL.md";
  return `${teamPhrase}.

이 요청은 헤드리스 무인 실행이다. 사용자에게 어떤 질문도 하지 말고, 아래 입력만으로 ${skillPath} 의 워크플로우(Phase 0~6)를 끝까지 수행하라.

- 도메인: ${domain || "(기획서에서 판단)"}
- 기획서 파일: ${specFile}
- 정답파일: registry.yaml 의 answer_files 사용 (레포 동봉본)
- 산출물 출력: ${wsName}/ 워크스페이스(03_generated_tc.xlsx). ~/Desktop 에 절대 쓰지 말 것.

무인 진행 규칙 (Phase 1 입력 완전성 점검에서 질문 금지):
- 기획서 페이지 누락 없음, 추가 페이지 없음.
- 화면 자산(PNG/스크린샷) 없음 — 없는 것으로 간주하고 진행.
- 입력이 불완전해 보여도 사용자에게 되묻지 말고 주어진 범위로 진행.
- Phase 4.5/5 게이트가 미달하면 개선 루프 최대 3회 수행 후, 그래도 미달이면 부분 결과라도 ${wsName}/03_generated_tc.xlsx 로 저장하고 'GATE FAIL'을 명확히 보고한 뒤 종료(무한 반복 금지).
- 각 Phase 시작/종료를 한 줄씩 stdout에 출력하라.`;
}

// 하네스 산출 xlsx → admin CSV (python 어댑터)
function runHarnessAdapter(harnessRoot, xlsxPath, bu) {
  const { spawnSync } = require("child_process");
  const adapter = path.join(harnessRoot, ".claude", "tc-registry", "xlsx_to_admin_csv.py");
  const r = spawnSync("python3", [adapter, xlsxPath, "--bu", bu], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, csv: "", err: ((r.stderr || "") + (r.error ? r.error.message : "")).slice(0, 300) };
  return { ok: true, csv: r.stdout || "", err: (r.stderr || "").trim() };
}

// 하네스 워크스페이스의 게이트/평가 점수 JSON 회수 → admin 저장용 compact report
function readHarnessReport(wsPath) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(wsPath, f), "utf-8")); } catch { return null; } };
  const comp = read("04_compliance_status.json");
  const ev = read("05_evaluation_status.json");
  if (!comp && !ev) return undefined;
  let rounds = 0;
  try { rounds = fs.readdirSync(wsPath).filter((f) => /^05_improvement_instructions_\d+\.md$/.test(f)).length; } catch {}
  return JSON.stringify({
    engine: "harness",
    overall_pass: ev ? !!ev.overall_pass : null,
    compliance: comp ? { score: comp.score ?? null, pass: !!comp.pass } : null,
    mode_a: ev && ev.mode_a ? { applicable: !!ev.mode_a.applicable, all_axes_pass: !!ev.mode_a.all_axes_pass, axis_scores: ev.mode_a.axis_scores || null } : null,
    mode_c: ev && ev.mode_c ? { weighted_avg: ev.mode_c.weighted_avg ?? null, pass: !!ev.mode_c.pass } : null,
    rounds,
  });
}

// 하네스 워크스페이스에서 현재 진행 단계 감지 (파일 존재 기반) — 다른 사람이 '멈춤?' 오인 안 하게 실시간 표시용
function detectHarnessPhase(wsPath) {
  const has = (f) => { try { return fs.existsSync(path.join(wsPath, f)); } catch { return false; } };
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(wsPath, f), "utf-8")); } catch { return null; } };
  let rounds = 0;
  try { rounds = fs.readdirSync(wsPath).filter((f) => /^05_improvement_instructions.*\.md$/.test(f)).length; } catch {}
  if (has("05_evaluation_status.json")) {
    const ev = readJson("05_evaluation_status.json");
    const mc = ev && ev.mode_c && typeof ev.mode_c.weighted_avg === "number" ? ` · 커버리지 ${Math.round(ev.mode_c.weighted_avg)}%` : "";
    if (rounds > 0 && !(ev && ev.overall_pass)) return `Phase 5: 품질 개선 루프 ${rounds}회차${mc}`;
    return `Phase 5: 품질 평가${mc}`;
  }
  if (has("04_compliance_status.json")) {
    const c = readJson("04_compliance_status.json");
    const sc = c && typeof c.score === "number" ? ` (${c.score}점)` : "";
    return `Phase 4.5: 형식 게이트${sc}`;
  }
  if (has("03_generated_tc.xlsx")) return "Phase 4: TC 생성";
  if (has("03_tc_skeleton.json")) return "Phase 3.5: 골격(skeleton) 생성";
  if (has("02_ref_parsing")) return "Phase 3: 정답파일 파싱";
  if (has("01_spec_analysis.md")) return "Phase 2: 기획·정답 분석";
  if (has("00_input.md")) return "Phase 1: 입력 준비";
  return "Phase 0: 시작";
}
async function reportHarnessProgress(jobId, phase) {
  try {
    await fetch(`${ADMIN_URL}/api/tc-gen/${jobId}/progress`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker: BUILTIN_WORKER_NAME, phase }),
    });
  } catch { /* 진행 보고 실패는 무시(본 실행엔 영향 없음) */ }
}

// 하네스 잡 실행: 잡별 격리 cwd(_jobs/<id>) → spec 파일화 → 트리거 → claude -p → 산출 xlsx → 어댑터 CSV.
// 격리: .claude/references/CLAUDE.md 는 마스터 클론 심링크(읽기전용 공유), _workspace/_inbox/.cache 는 잡별 실폴더 → 한 머신 N병렬 충돌 없음.
async function runHarness(job) {
  const harnessRoot = KURLY_HARNESS_PATH;
  if (!harnessRoot || !fs.existsSync(harnessRoot)) {
    return { ok: false, output: "", failReason: "KURLY_HARNESS_PATH 미설정/경로없음 — 하네스 모드 불가" };
  }
  const { bu, domain, spec } = parseHarnessPrompt(job.prompt);
  const wsName = bu === "commerce" ? "_workspace_commerce" : "_workspace_logistics";
  // 잡별 격리 작업폴더 — 공유 클론 자산은 심링크(읽기전용), 가변 산출물(_workspace/_inbox/.cache)만 잡별 실폴더
  const jobDir = path.join(harnessRoot, "_jobs", job.id);
  try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(path.join(jobDir, ".cache"), { recursive: true });   // 파싱 캐시(.cache/ref_schemas.json)도 잡별 격리
  for (const link of [".claude", "references", "CLAUDE.md"]) {
    const target = path.join(harnessRoot, link);
    if (fs.existsSync(target)) { try { fs.symlinkSync(target, path.join(jobDir, link)); } catch {} }
  }
  const wsPath = path.join(jobDir, wsName);
  const xlsxPath = path.join(wsPath, "03_generated_tc.xlsx");
  const inboxDir = path.join(jobDir, "_inbox");
  try { fs.mkdirSync(inboxDir, { recursive: true }); } catch {}
  const specFile = path.join(inboxDir, `${job.id}_spec.md`);
  fs.writeFileSync(specFile, (spec && spec.trim()) ? spec : "(기획서 본문 없음)", "utf-8");
  // 트리거 구성 + 실행 (+ 진행 단계 실시간 보고 — 잡별 워크스페이스 단계 감지해 변할 때만 admin 에 보고)
  const trigger = buildHarnessTrigger(bu, domain, specFile, wsName);
  let lastPhase = "";
  const progTimer = setInterval(() => {
    try { const p = detectHarnessPhase(wsPath); if (p && p !== lastPhase) { lastPhase = p; reportHarnessProgress(job.id, p); } } catch { /* ignore */ }
  }, 12000);
  let r;
  try { r = await runClaudeP(trigger, job.model, jobDir, TC_GEN_HARNESS_TIMEOUT_MS); }
  finally { clearInterval(progTimer); }
  try {
    // 산출 xlsx 회수 (게이트 미통과여도 부분 결과 회수)
    if (!fs.existsSync(xlsxPath)) {
      return { ok: false, output: r.output, failReason: r.failReason || "산출 xlsx 없음 (하네스 생성 실패)" };
    }
    const a = runHarnessAdapter(harnessRoot, xlsxPath, bu);
    if (!a.ok || !a.csv.trim()) {
      return { ok: false, output: r.output, failReason: `xlsx→CSV 변환 실패: ${a.err}` };
    }
    const report = readHarnessReport(wsPath);
    return { ok: true, output: a.csv, report };
  } finally {
    // 격리 폴더 정리 (CSV·리포트 회수 후) — 디스크 위생
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
  }
}

async function reportTcGen(jobId, ok, output, failReason, report) {
  try {
    await fetch(`${ADMIN_URL}/api/tc-gen/${jobId}/result`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker: BUILTIN_WORKER_NAME, ok, output, failReason, report }),
    });
  } catch (e) { console.error(`[worker] TC생성 결과 회신 실패 ${jobId}:`, e.message); }
}

let tcGenClaiming = false;  // claim 직렬화 (잡 타입을 claim 후에야 알 수 있으므로 동시 claim 방지)
let harnessActive = 0;      // 실행 중 하네스 잡 수 (잡별 격리 cwd → WORKER_HARNESS_CONCURRENT 까지 동시 가능)

async function pollTcGen() {
  if (tcGenClaiming) return;                            // claim 1건씩
  if (harnessActive >= HARNESS_MAX_CONCURRENT) return;  // 하네스 동시 한도(잡별 격리 cwd라 N 가능 — WORKER_HARNESS_CONCURRENT)
  if (tcGenActive >= TCGEN_MAX_CONCURRENT) return;      // 비-하네스 동시 한도
  tcGenClaiming = true;
  let job;
  try {
    const res = await fetch(`${ADMIN_URL}/api/tc-gen/next?worker=${encodeURIComponent(BUILTIN_WORKER_NAME)}`);
    if (res.ok) job = (await res.json()).job;
  } catch { /* 서버 미기동 등 — 조용히 스킵 */ }
  if (!job) { tcGenClaiming = false; return; }
  const isHarness = typeof job.prompt === "string" && job.prompt.startsWith("__HARNESS__");
  if (isHarness) harnessActive++; else tcGenActive++;
  tcGenClaiming = false;
  console.log(`[worker] ▶ TC생성 claim ${job.id} (${job.kind}${isHarness ? ", 하네스" : ""}) (수행 ${tcGenActive}/${TCGEN_MAX_CONCURRENT}, 하네스 ${harnessActive})`);
  try {
    const r = isHarness ? await runHarness(job) : await runTcGenClaude(job.prompt, job.model);
    await reportTcGen(job.id, r.ok, r.output, r.failReason, r.report);
    console.log(`[worker] ◀ TC생성 ${job.id} ${r.ok ? "완료" : "실패: " + r.failReason}`);
  } catch (err) {
    await reportTcGen(job.id, false, "", String((err && err.message) || err));
  } finally {
    if (isHarness) harnessActive--; else tcGenActive--;
  }
}

console.log(`[worker] TC설계/작성 동시 슬롯: ${TCGEN_MAX_CONCURRENT} (WORKER_TCGEN_CONCURRENT 로 조정)`);
console.log(`[worker] 하네스 모드: ${KURLY_HARNESS_PATH ? KURLY_HARNESS_PATH + ` (타임아웃 ${TC_GEN_HARNESS_TIMEOUT_MS / 60000}분, 동시 ${HARNESS_MAX_CONCURRENT})` : "비활성 (KURLY_HARNESS_PATH 미설정)"}`);
console.log(`[worker] 테스트데이터 큐 슬롯: ${DATA_REQUEST_MAX_CONCURRENT} (WORKER_DATA_REQUEST_CONCURRENT 로 조정)`);
setInterval(pollTcGen, POLL_MS);
setInterval(pollDataRequests, POLL_MS);

process.on("SIGINT", () => {
  console.log("\n[worker] 종료");
  db.close();
  process.exit(0);
});

} // end of else block (DISABLE_BUILTIN_WORKER 조건)
