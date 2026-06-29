#!/usr/bin/env node
// Kurly QA Worker 자동 셋업
// Usage:
//   npm run setup           # 인터랙티브
//   npm run setup -- -y     # 모든 기본값 자동 수락 (.env 보존)

const { spawnSync } = require("node:child_process");
const { existsSync, writeFileSync, copyFileSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");

const ROOT = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const NON_INTERACTIVE = args.has("--yes") || args.has("-y");
const TOTAL_STEPS = 7;

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", magenta: "\x1b[35m",
};
const log = {
  step: (n, total, msg) => console.log(`\n${C.bold}${C.cyan}[${n}/${total}]${C.reset} ${msg}`),
  ok: (msg) => console.log(`${C.green}✓${C.reset} ${msg}`),
  warn: (msg) => console.log(`${C.yellow}⚠${C.reset} ${msg}`),
  err: (msg) => console.log(`${C.red}✗${C.reset} ${msg}`),
  info: (msg) => console.log(`${C.dim}  ${msg}${C.reset}`),
};

const results = [];
const recordOk = (name) => results.push({ name, status: "ok" });
const recordWarn = (name, hint) => results.push({ name, status: "warn", hint });
const recordErr = (name, hint) => results.push({ name, status: "err", hint });

function runCmd(cmd, cmdArgs, opts = {}) {
  log.info(`$ ${cmd} ${cmdArgs.join(" ")}`);
  // Windows 호환: npm/npx 는 .cmd 확장자 자동 처리 위해 shell:true
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", cwd: ROOT, shell: process.platform === "win32", ...opts });
  return res.status === 0;
}

function prompt(question, defaultVal) {
  if (NON_INTERACTIVE) return Promise.resolve(defaultVal);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = defaultVal !== undefined && defaultVal !== ""
    ? `${question} ${C.dim}[${defaultVal}]${C.reset} `
    : `${question} `;
  return new Promise((resolve) => {
    rl.question(q, (ans) => { rl.close(); resolve(ans.trim() || defaultVal || ""); });
  });
}

async function main() {
  console.log(`${C.bold}${C.magenta}Kurly QA Worker — 자동 셋업${C.reset}`);
  console.log(`${C.dim}작업 디렉토리: ${ROOT}${C.reset}`);
  if (NON_INTERACTIVE) log.info("(-y 모드: 모든 prompt 기본값 자동 수락)");

  // ===== 1. Node 버전 =====
  log.step(1, TOTAL_STEPS, "Node.js 버전 확인");
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor < 18) {
    log.err(`Node.js ${process.version} 감지 — Node 18+ 필요`);
    log.info("https://nodejs.org/ 에서 LTS 설치 후 다시 시도");
    recordErr("Node.js 18+", "https://nodejs.org/");
    summarize(); process.exit(1);
  }
  log.ok(`Node.js ${process.version}`);
  recordOk("Node.js");

  // ===== 2. npm install =====
  log.step(2, TOTAL_STEPS, "워커 의존성 설치 (npm install)");
  if (runCmd("npm", ["install", "--no-audit", "--no-fund"])) {
    log.ok("의존성 설치 완료");
    recordOk("npm install");
  } else {
    log.warn("의존성 설치 실패 — 수동으로 npm install 시도하세요");
    recordErr("npm install", "수동 실행 필요");
  }

  // ===== 3. Playwright Chromium =====
  log.step(3, TOTAL_STEPS, "Playwright Chromium 브라우저 다운로드 (~200MB, 첫 1회만)");
  if (runCmd("npx", ["-y", "playwright@latest", "install", "chromium"])) {
    log.ok("Chromium 다운로드 완료");
    recordOk("Playwright Chromium");
  } else {
    log.warn("Chromium 다운로드 실패 — 첫 잡 실행 시 자동 재시도되지만 느림");
    recordWarn("Playwright Chromium", "첫 실행 시 자동 설치");
  }

  // ===== 4. Playwright MCP 캐시 워밍 =====
  log.step(4, TOTAL_STEPS, "Playwright MCP 패키지 캐시 워밍");
  if (runCmd("npx", ["-y", "@playwright/mcp@latest", "--version"], { stdio: "ignore" })) {
    log.ok("Playwright MCP 캐싱 완료");
    recordOk("Playwright MCP");
  } else {
    log.warn("Playwright MCP 캐시 워밍 실패 — claude 첫 실행 시 자동 다운로드");
    recordWarn("Playwright MCP", "첫 실행 시 자동 다운로드");
  }

  // ===== 5. Mobile MCP 캐시 워밍 =====
  log.step(5, TOTAL_STEPS, "Mobile MCP 패키지 캐시 워밍 (@mobilenext/mobile-mcp)");
  if (runCmd("npx", ["-y", "@mobilenext/mobile-mcp@latest", "--version"], { stdio: "ignore" })) {
    log.ok("Mobile MCP 캐싱 완료");
    log.info("App 자동화 사용 시 iOS=Xcode / Android=Android Studio 별도 설치 필요");
    recordOk("Mobile MCP");
  } else {
    log.warn("Mobile MCP 캐시 워밍 실패 — App 자동화 시 첫 실행에서 자동 다운로드");
    recordWarn("Mobile MCP", "App 자동화 시 첫 실행에서 자동 다운로드");
  }

  // ===== 6. Claude CLI =====
  log.step(6, TOTAL_STEPS, "Claude Code CLI 확인");
  const claudeCheck = spawnSync("claude", ["--version"], { stdio: "pipe", shell: process.platform === "win32" });
  if (claudeCheck.status === 0) {
    const ver = (claudeCheck.stdout?.toString() || "").trim();
    log.ok(`Claude CLI 발견: ${ver}`);
    log.info("로그인 상태 점검: claude (한 번 실행해 로그인 안 되어 있으면 OAuth 진행)");
    recordOk("Claude CLI");
  } else {
    log.warn("Claude CLI 미설치 또는 PATH 에 없음");
    log.info("설치 명령: npm i -g @anthropic-ai/claude-code");
    log.info("설치 후 한 번 'claude' 실행해서 Claude Max 계정으로 로그인 (브라우저 OAuth)");
    recordWarn("Claude CLI", "npm i -g @anthropic-ai/claude-code");
  }

  // ===== 7. .env 생성 =====
  log.step(7, TOTAL_STEPS, ".env 설정");
  const envPath = path.join(ROOT, ".env");
  const examplePath = path.join(ROOT, ".env.example");
  let writeEnv = true;
  if (existsSync(envPath)) {
    if (NON_INTERACTIVE) {
      log.info(".env 기존 파일 유지 (덮어쓰려면 -y 빼고 다시 실행)");
      writeEnv = false;
    } else {
      const ans = await prompt(".env 가 이미 있습니다. 덮어쓸까요? (y/N)", "n");
      writeEnv = String(ans).toLowerCase().startsWith("y");
    }
  }

  if (writeEnv) {
    const defaultName = os.hostname().replace(/\.local$/, "");
    const workerName = await prompt("워커 이름 (어드민 드롭다운 표시명):", defaultName);
    const centralUrl = await prompt("중앙 어드민 URL:", "http://localhost:3000");
    const canWebRaw = await prompt("Web 자동화 가능? (y/n):", "y");
    const canAppRaw = await prompt("App 자동화 가능? (y/n):", "n");
    const qaCowork = await prompt("QA-Cowork 경로:", path.join(os.homedir(), "Documents", "QA-Cowork", "AI_Test"));

    const canWeb = String(canWebRaw).toLowerCase().startsWith("y");
    const canApp = String(canAppRaw).toLowerCase().startsWith("y");
    const stamp = new Date().toISOString().slice(0, 10);

    const env = `# Kurly QA Worker .env (auto-generated ${stamp})
WORKER_NAME=${workerName}
CENTRAL_URL=${centralUrl}
WORKER_CAN_WEB=${canWeb}
WORKER_CAN_APP=${canApp}
HEARTBEAT_INTERVAL_MS=30000
QA_COWORK_HOME=${qaCowork}
`;
    writeFileSync(envPath, env, "utf-8");
    log.ok(`.env 생성: ${envPath}`);
    recordOk(".env");
  } else if (existsSync(envPath)) {
    log.ok(".env 기존 파일 사용");
    recordOk(".env (기존)");
  } else if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    log.warn(".env.example → .env 복사. 직접 편집 필요.");
    recordWarn(".env", "수동 편집 필요");
  }

  summarize();
}

function summarize() {
  console.log(`\n${C.bold}===== 셋업 결과 =====${C.reset}`);
  for (const r of results) {
    const icon = r.status === "ok"   ? `${C.green}✓${C.reset}`
              : r.status === "warn" ? `${C.yellow}⚠${C.reset}`
              :                       `${C.red}✗${C.reset}`;
    console.log(`${icon} ${r.name}${r.hint ? `  ${C.dim}— ${r.hint}${C.reset}` : ""}`);
  }
  const errors = results.filter((r) => r.status === "err").length;
  const warns = results.filter((r) => r.status === "warn").length;
  if (errors === 0 && warns === 0) {
    console.log(`\n${C.green}${C.bold}✓ 모든 셋업 완료!${C.reset} ${C.bold}npm start${C.reset} 로 워커를 시작하세요.\n`);
  } else {
    console.log(`\n완료 (오류 ${errors}, 경고 ${warns}). 위 항목 점검 후 ${C.cyan}npm start${C.reset} 실행하세요.`);
  }
  console.log(`${C.dim}참고: Mobile MCP 사용 시 환경별 패키지 수동 설치 필요 (자동화 미지원).${C.reset}\n`);
}

main().catch((err) => {
  log.err(`셋업 중 오류: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
