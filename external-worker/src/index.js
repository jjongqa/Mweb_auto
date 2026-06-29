#!/usr/bin/env node
// Kurly QA Worker v1.0 Phase 3a
// 기능: 등록 + heartbeat + Job 폴링 + 클레임 + MOCK 처리 + 결과 업로드
// 다음 Phase: REAL 모드 (claude CLI), 스크린샷 처리

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execSync } = require("node:child_process");
const { resolvePrompts, buildClaudeMessage, buildAdhocMessage } = require("./prompts");

// 자기 버전 — admin 이 구버전 워커에 업데이트 배너 띄우는 데 사용(heartbeat 로 보고).
let PKG_VERSION = "";
try { PKG_VERSION = require("../package.json").version || ""; } catch (_) {}

/**
 * v1.7.6: 후손 프로세스 트리를 BFS 로 수집해서 전부 SIGKILL.
 * Playwright MCP 가 --isolated 모드로 spawn 하는 Chromium 처럼
 * PID 매칭으로 못 잡히는 손자/증손자까지 ps -ax -o pid,ppid 로 추적.
 */
function killDescendantsTree(rootPid) {
  if (!rootPid || typeof rootPid !== "number") return 0;
  try {
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
    for (let i = descendants.length - 1; i >= 0; i--) {
      try { process.kill(descendants[i], "SIGKILL"); } catch (_) {}
    }
    return descendants.length;
  } catch (_) {
    return 0;
  }
}

// v1.7.7: 좀비 cleanup — 진행 중 claude proc 추적용 모듈 레지스트리.
// 크래시/SIGINT 시 자손 트리(특히 detached Chromium) 까지 한꺼번에 정리.
const activeProcs = new Map(); // jobId -> proc

const WORKER_NAME = (process.env.WORKER_NAME || "").trim();
const CENTRAL_URL = (process.env.CENTRAL_URL || "http://localhost:3000").replace(/\/$/, "");
const HEARTBEAT_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || "30000", 10);
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const QA_COWORK_HOME = process.env.QA_COWORK_HOME || path.join(os.homedir(), "Documents", "QA-Cowork", "AI_Test");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CODEX_BIN = process.env.CODEX_BIN || "codex";
// v1.7.3 모델 통일 — 속도/비용 균형. env 로 override 가능.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
// 워커 PC 의 결과 임시 저장 위치 (업로드 후 정리)
const LOCAL_RESULTS_ROOT = process.env.LOCAL_RESULTS_ROOT || path.join(os.homedir(), ".kurly-qa-worker", "results");

const capabilities = {
  web: process.env.WORKER_CAN_WEB !== "false",
  app: process.env.WORKER_CAN_APP === "true",
};

// v1.7 platform 별 MCP 서버 설정 — claude CLI 의 --mcp-config 로 잡마다 격리
//  - web:  desktop chromium playwright
//  - mweb: playwright + --device "iPhone 15" (UA/viewport/DPR/touch 모바일)
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

// v1.7 끼어들기 메시지 1건을 어드민에서 가져옴 — HTTP polling
// v1.7.2 정확한 CSV 파싱 — quoted field 안의 콤마/줄바꿈 안전 처리 (RFC 4180)
function splitCsvLines(text) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '""'; i++; continue; }
      inQ = !inQ;
      cur += c;
    } else if ((c === "\n" || c === "\r") && !inQ) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (cur.length > 0) out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}
function parseSimpleCsvRow(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function takeNextMessageFromAdmin(jobId) {
  try {
    const res = await fetch(`${CENTRAL_URL}/api/jobs/${jobId}/messages/next`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json.ok && json.message) return json.message;
    return null;
  } catch {
    return null;
  }
}

if (!WORKER_NAME) {
  console.error("❌ WORKER_NAME 환경변수가 비어있습니다. .env 파일 확인.");
  process.exit(1);
}

// v1.7 multi-concurrency: 한 워커가 동시 N잡 처리.
// v1.7.6: default 1 → 3. PC 사양 안 좋으면 env 로 1~2 로 줄이기 (WORKER_MAX_CONCURRENT=2).
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.WORKER_MAX_CONCURRENT || "3", 10));
let activeJobs = 0;
const activeJobIds = new Set();

function log(level, msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============== API 호출 헬퍼 ==============

async function registerWithCentral() {
  log("info", `중앙 등록 시도: ${CENTRAL_URL} (워커명: ${WORKER_NAME})`);
  try {
    const res = await fetch(`${CENTRAL_URL}/api/workers/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: WORKER_NAME, capabilities }),
    });
    const json = await res.json();
    if (!res.ok) {
      log("error", `등록 실패 (${res.status}): ${json.error || JSON.stringify(json)}`);
      return false;
    }
    log("info", `✓ 등록 성공: ${json.message || "OK"}`);
    return true;
  } catch (err) {
    log("error", `중앙 서버 연결 실패: ${err.message}`);
    return false;
  }
}

async function sendHeartbeat(status = "online") {
  try {
    const res = await fetch(`${CENTRAL_URL}/api/workers/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: WORKER_NAME,
        status,
        active_jobs: activeJobs,
        max_concurrent: MAX_CONCURRENT,
        version: PKG_VERSION,
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      if (json.needsReregister) {
        log("warn", "재등록 필요");
        await registerWithCentral();
      }
    }
  } catch (err) {
    log("warn", `heartbeat 실패: ${err.message}`);
  }
}

async function fetchNextJob() {
  try {
    const res = await fetch(`${CENTRAL_URL}/api/jobs/next?worker=${encodeURIComponent(WORKER_NAME)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.job || null;
  } catch (err) {
    return null;
  }
}

async function claimJob(jobId) {
  try {
    const res = await fetch(`${CENTRAL_URL}/api/jobs/${jobId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker: WORKER_NAME }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      log("warn", `클레임 실패 (${res.status}): ${json.error || ""}`);
      return false;
    }
    return true;
  } catch (err) {
    log("error", `클레임 호출 실패: ${err.message}`);
    return false;
  }
}

async function reportProgress(jobId, data) {
  try {
    const res = await fetch(`${CENTRAL_URL}/api/jobs/${jobId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker: WORKER_NAME, ...data }),
    });
    if (!res.ok) return { cancel_requested: false };
    const json = await res.json();
    return { cancel_requested: !!json.cancel_requested };
  } catch (err) {
    return { cancel_requested: false };
  }
}

async function uploadComplete(jobId, status, stats, errorMessage, files) {
  try {
    const fd = new FormData();
    fd.append("worker", WORKER_NAME);
    fd.append("status", status);
    if (errorMessage) fd.append("error_message", errorMessage);
    fd.append("passed", String(stats.passed || 0));
    fd.append("failed", String(stats.failed || 0));
    fd.append("blocked", String(stats.blocked || 0));
    fd.append("total", String(stats.total || 0));

    const filePaths = [];
    for (const f of files) {
      const blob = new Blob([f.content]);
      fd.append("files", blob, path.basename(f.relPath));
      filePaths.push(f.relPath);
    }
    fd.append("file_paths", JSON.stringify(filePaths));

    const res = await fetch(`${CENTRAL_URL}/api/jobs/${jobId}/complete`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      log("error", `완료 보고 실패 (${res.status}): ${json.error || ""}`);
      return false;
    }
    log("info", `✓ 완료 보고 + 파일 ${files.length}개 업로드`);
    return true;
  } catch (err) {
    log("error", `완료 보고 실패: ${err.message}`);
    return false;
  }
}

// ============== Job 처리 ==============

// splitCsvLines 는 위(line 103, parseSimpleCsvRow 와 한 쌍)에 정의됨. 중복 정의 제거 (v1.7.7).

function countTcRows(csvText) {
  return Math.max(0, splitCsvLines(csvText).length - 1);
}

// CSV 파일 읽기: 로컬에 있으면 그대로, 아니면 중앙에서 다운로드
async function readTcCsv(job) {
  // 1차: 로컬에 같은 경로 있는지 (같은 PC 에서 워커 띄운 경우)
  if (job.tc_path && fs.existsSync(job.tc_path)) {
    log("info", `TC 파일 로컬 사용: ${job.tc_path}`);
    return fs.readFileSync(job.tc_path, "utf-8");
  }

  // 2차: 중앙 API 통해 다운로드 (다른 PC 워커)
  log("info", `로컬에 TC 파일 없음, 중앙 API 로 다운로드 시도`);
  try {
    const url = `${CENTRAL_URL}/api/jobs/${job.id}/tc?worker=${encodeURIComponent(WORKER_NAME)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      log("error", `중앙 CSV 다운로드 실패 (${res.status}): ${json.error || ""}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString("utf-8");
    log("info", `중앙에서 CSV 다운로드 완료 (${buf.byteLength} bytes)`);
    return text;
  } catch (err) {
    log("error", `중앙 CSV 다운로드 오류: ${err.message}`);
    return null;
  }
}

async function runMockJob(job) {
  const csvText = await readTcCsv(job);
  if (!csvText) {
    // CSV 못 받았으면 fallback 시뮬레이션 X. Job 실패 처리.
    log("error", "TC CSV 를 가져올 수 없어 작업을 진행할 수 없음");
    return {
      status: "failed",
      stats: { passed: 0, failed: 0, blocked: 0, total: 0 },
      files: [],
      errorMessage: "TC CSV 다운로드 실패 (로컬에 없고 중앙 다운로드도 실패)",
    };
  }
  const total = countTcRows(csvText);
  if (total === 0) {
    log("error", "TC CSV 가 비어있음 (헤더만 있거나 빈 파일)");
    await reportProgress(job.id, {
      logs: [{ level: "error", message: "TC CSV 가 비어있음 — 잡 종료" }],
    });
    return {
      status: "failed",
      stats: { passed: 0, failed: 0, blocked: 0, total: 0 },
      files: [],
      errorMessage: "TC CSV 가 비어있음 (헤더만 있거나 빈 파일)",
    };
  }

  log("info", `[MOCK] 총 ${total} 케이스 시뮬레이션 시작`);
  await reportProgress(job.id, {
    total,
    logs: [{ level: "info", message: `[MOCK] 시뮬레이션 모드로 실행 (${total}건)` }],
  });

  let passed = 0, failed = 0, blocked = 0;
  const platformCol = job.platform === "app" ? ",Platform" : "";
  const summary = [`No,Priority,Type,TC Title${platformCol},Test Step,Expected Result,Actual Result,Result,Notes,Screenshot`];
  const failDetail = [`No,Priority,TC Title${platformCol},Expected Result,Actual Result,Fail Reason,Screenshot`];

  for (let i = 1; i <= total; i++) {
    await sleep(400 + Math.random() * 600);

    const r = Math.random();
    let result;
    if (r > 0.85) { failed++; result = "FAIL"; }
    else if (r > 0.82) { blocked++; result = "BLOCKED"; }
    else { passed++; result = "PASS"; }

    const platformVal = job.platform === "app" ? `,${i % 2 === 0 ? "iOS" : "Android"}` : "";
    summary.push(`${i},P${(i % 3) + 1},기능검증,케이스 ${i}${platformVal},Step ${i},예상,${result === "PASS" ? "예상대로" : "불일치"},${result},,${result !== "BLOCKED" ? `TC-${i}/screenshot.png` : ""}`);
    if (result === "FAIL") {
      failDetail.push(`${i},P${(i % 3) + 1},케이스 ${i}${platformVal},예상,실제,사유: 시뮬레이션 실패,TC-${i}/fail.png`);
    }

    const progressResult = await reportProgress(job.id, {
      passed, failed, blocked,
      logs: [{
        level: result === "PASS" ? "info" : result === "FAIL" ? "warn" : "info",
        message: `${i}/${total} ${result} - 케이스 ${i}`,
      }],
    });

    if (progressResult.cancel_requested) {
      log("warn", `${i}/${total} 진행 중 캔슬 요청, 중단`);
      return {
        status: "canceled",
        stats: { passed, failed, blocked, total },
        files: [{ relPath: "summary.csv", content: "\uFEFF" + summary.join("\n") }],
        errorMessage: "사용자 요청으로 중단됨",
      };
    }
  }

  return {
    status: "succeeded",
    stats: { passed, failed, blocked, total },
    files: [
      { relPath: "summary.csv", content: "\uFEFF" + summary.join("\n") },
      { relPath: "fail-detail.csv", content: "\uFEFF" + failDetail.join("\n") },
    ],
    errorMessage: null,
  };
}

// ============== REAL 모드 ==============
// 결과 디렉토리 재귀 스캔 → uploadComplete 가 받을 수 있는 { relPath, content } 배열
function collectResultFiles(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  const walk = (dir, baseRel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "_admin_prompt.md") continue;
      const full = path.join(dir, entry.name);
      const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else out.push({ relPath: rel, content: fs.readFileSync(full) });
    }
  };
  walk(rootDir, "");
  return out;
}

// stream-json 한 줄 처리
const TC_PATTERN = /TC[-_\s]?(\d+)\s*[:\-]?\s*(PASS|FAIL|BLOCKED)\b/gi;
function parseStreamLine(line, state) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { return null; }
  const events = [];
  if (parsed.type === "assistant" && parsed.message?.content) {
    for (const c of parsed.message.content) {
      if (c.type === "text" && c.text) {
        const txt = c.text.trim();
        if (txt) {
          events.push({ level: "info", message: txt.slice(0, 300) });
          // TC 카운트 추출 (strict + 라인 단위 매칭 + dedup)
          const cands = [];
          for (const m of txt.matchAll(TC_PATTERN)) {
            cands.push({ idx: parseInt(m[1], 10), result: m[2].toUpperCase() });
          }
          for (const ln of txt.split(/[\r\n]+/)) {
            const tcs = [...ln.matchAll(/\bTC[-_\s]?(\d+)\b/gi)];
            if (tcs.length !== 1) continue;
            const results = [...ln.matchAll(/\b(PASS|FAIL|BLOCKED)\b/gi)];
            if (results.length === 0) continue;
            const words = results.map((r) => r[1].toUpperCase());
            const result = words.includes("BLOCKED") ? "BLOCKED" : words.includes("FAIL") ? "FAIL" : "PASS";
            cands.push({ idx: parseInt(tcs[0][1], 10), result });
          }
          for (const c of cands) {
            const key = `${c.idx}:${c.result}`;
            if (state.processed.has(key)) continue;
            state.processed.add(key);
            if (c.result === "PASS") state.passed++;
            else if (c.result === "FAIL") state.failed++;
            else state.blocked++;
            if (c.idx > state.current_index) state.current_index = c.idx;
          }
        }
      } else if (c.type === "tool_use") {
        events.push({ level: "info", message: `🔧 도구 호출: ${c.name}` });
      }
    }
  } else if (parsed.type === "result") {
    events.push({
      level: parsed.subtype === "success" ? "info" : "warn",
      message: `Claude 종료: ${parsed.subtype}`,
    });
  } else if (parsed.type === "system" && parsed.subtype === "init") {
    events.push({ level: "info", message: `Claude 세션 시작 (model=${parsed.model || "?"})` });
  }
  return events;
}

function updateCountsFromPlainText(state, text) {
  const cands = [];
  for (const m of String(text || "").matchAll(TC_PATTERN)) {
    cands.push({ idx: parseInt(m[1], 10), result: m[2].toUpperCase() });
  }
  for (const ln of String(text || "").split(/[\r\n]+/)) {
    const tcs = [...ln.matchAll(/\bTC[-_\s]?(\d+)\b/gi)];
    if (tcs.length !== 1) continue;
    const results = [...ln.matchAll(/\b(PASS|FAIL|BLOCKED)\b/gi)];
    if (results.length === 0) continue;
    const words = results.map((r) => r[1].toUpperCase());
    const result = words.includes("BLOCKED") ? "BLOCKED" : words.includes("FAIL") ? "FAIL" : "PASS";
    cands.push({ idx: parseInt(tcs[0][1], 10), result });
  }
  for (const c of cands) {
    const key = `${c.idx}:${c.result}`;
    if (state.processed.has(key)) continue;
    state.processed.add(key);
    if (c.result === "PASS") state.passed++;
    else if (c.result === "FAIL") state.failed++;
    else state.blocked++;
    if (c.idx > state.current_index) state.current_index = c.idx;
  }
}

async function runRealJob(job) {
  // v1.9: admin 이 프롬프트/knowledge 내용을 inline 해 보냈으면 로컬 파일 불필요(외부/신규 워커도 Drive 최신본).
  const hasInlined = !!(job.inlined_context && String(job.inlined_context).trim());
  if (!fs.existsSync(QA_COWORK_HOME)) {
    if (hasInlined) {
      try { fs.mkdirSync(QA_COWORK_HOME, { recursive: true }); } catch (_) {}  // cwd 용 빈 폴더 보장
    } else {
      return { status: "failed", stats: { passed: 0, failed: 0, blocked: 0, total: 0 }, files: [], errorMessage: `QA-Cowork 폴더 없음: ${QA_COWORK_HOME}` };
    }
  }
  const isAdhoc = job.job_type === "adhoc";
  log("info", `[REAL${isAdhoc ? " ADHOC" : ""}] cwd=${QA_COWORK_HOME}${hasInlined ? " · inline 컨텍스트 사용(Drive 최신본)" : " · 로컬 프롬프트"}`);

  // 결과 디렉토리 — 워커 PC 로컬 (업로드 후 정리)
  const resultDir = path.join(LOCAL_RESULTS_ROOT, job.id);
  fs.mkdirSync(resultDir, { recursive: true });

  const resolution = resolvePrompts(QA_COWORK_HOME, job.domain, job.platform);
  if (!hasInlined && !fs.existsSync(resolution.basePromptPath)) {
    return { status: "failed", stats: { passed: 0, failed: 0, blocked: 0, total: 0 }, files: [], errorMessage: `베이스 프롬프트 없음: ${resolution.basePromptPath}` };
  }

  // TC 파일 다운로드 (애드혹 아닐 때만)
  let tcLocalPath = null;
  let tcFilesArr = [];
  if (!isAdhoc) {
    const csvText = await readTcCsv(job);
    if (!csvText) {
      return { status: "failed", stats: { passed: 0, failed: 0, blocked: 0, total: 0 }, files: [], errorMessage: "TC CSV 다운로드 실패" };
    }
    tcLocalPath = path.join(resultDir, `_tc_${job.tc_filename || "input.csv"}`);
    fs.writeFileSync(tcLocalPath, csvText, "utf-8");
    tcFilesArr = [{ path: tcLocalPath, filename: job.tc_filename || "input.csv" }];
  }

  const message = isAdhoc
    ? buildAdhocMessage(QA_COWORK_HOME, {
        domain: job.domain, platform: job.platform, qaEnv: job.qa_env,
        taskName: job.task_name || job.id, resultDirAbsPath: resultDir, resolution,
        additionalInstructions: job.additional_instructions, specUrl: job.spec_url,
        specFilename: job.spec_filename, specText: job.spec_text, adhocFocus: job.adhoc_focus,
        inlinedContext: job.inlined_context,
      })
    : buildClaudeMessage(QA_COWORK_HOME, {
        domain: job.domain, platform: job.platform, qaEnv: job.qa_env,
        taskName: job.task_name || job.id, tcFiles: tcFilesArr, resultDirAbsPath: resultDir,
        resolution, filterDesc: null,
        additionalInstructions: job.additional_instructions, specUrl: job.spec_url,
        specFilename: job.spec_filename, specText: job.spec_text,
        inlinedContext: job.inlined_context,
        adminUrl: CENTRAL_URL,
        jobId: job.id,
      });

  fs.writeFileSync(path.join(resultDir, "_admin_prompt.md"), message, "utf-8");
  log("info", `생성된 메시지: ${message.length} chars`);

  // v1.7: platform 별 MCP 설정을 잡 result_dir 에 작성 (디버깅용)
  const mcpConfigPath = path.join(resultDir, "_mcp.json");
  fs.writeFileSync(mcpConfigPath, JSON.stringify(buildMcpConfig(job.platform), null, 2), "utf-8");
  log("info", `MCP 설정 작성: platform=${job.platform}`);

  return new Promise((resolve) => {
    // v1.7: stream-json input 모드 + 잡별 mcp-config (platform 격리)
    // v1.7.5 잡별 모델 우선
    const effectiveModel = (job.claude_model && job.claude_model.trim()) || CLAUDE_MODEL;
    if (isCodexModel(effectiveModel)) {
      log("info", `Codex CLI 실행 (cwd=${QA_COWORK_HOME})`);
      log("info", `사용 모델: ${effectiveModel}${job.claude_model ? " (잡에서 지정)" : " (워커 default)"}`);
      const state = { passed: 0, failed: 0, blocked: 0, current_index: 0, processed: new Set() };
      runCodexExec(message, effectiveModel, QA_COWORK_HOME, 90 * 60 * 1000).then(async (r) => {
        if (r.output) {
          fs.writeFileSync(path.join(resultDir, "_codex_output.md"), r.output, "utf-8");
          updateCountsFromPlainText(state, r.output);
          await reportProgress(job.id, {
            passed: state.passed,
            failed: state.failed,
            blocked: state.blocked,
            logs: [{ level: r.ok ? "info" : "warn", message: r.output.trim().slice(0, 1000) }],
          });
        }
        const files = collectResultFiles(resultDir);
        const total = state.passed + state.failed + state.blocked;
        resolve({
          status: r.ok ? "succeeded" : "failed",
          stats: { passed: state.passed, failed: state.failed, blocked: state.blocked, total },
          files,
          errorMessage: r.ok ? null : r.failReason || "codex 실행 실패",
          resultDirLocal: resultDir,
        });
      }).catch((err) => {
        resolve({
          status: "failed",
          stats: { passed: 0, failed: 0, blocked: 0, total: 0 },
          files: collectResultFiles(resultDir),
          errorMessage: err.message,
          resultDirLocal: resultDir,
        });
      });
      return;
    }
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
        "--strict-mcp-config",
      ],
      { cwd: QA_COWORK_HOME, env: { ...process.env }, detached: true }
    );
    activeProcs.set(job.id, proc);

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
    writeUserMessage(message);  // 첫 prompt, stdin 은 안 닫음

    const state = { passed: 0, failed: 0, blocked: 0, current_index: 0, processed: new Set() };
    let stdoutBuf = "";
    let canceled = false;

    // v1.7 끼어들기 polling — 어드민에서 pending 메시지 가져와 stdin push
    const messagePoller = setInterval(async () => {
      if (canceled) return;
      const next = await takeNextMessageFromAdmin(job.id);
      if (next) {
        log("info", `🗨️ 사용자 추가 명령: ${next.content.slice(0, 120)}${next.content.length > 120 ? "..." : ""}`);
        writeUserMessage(next.content);
      }
    }, 2000);

    // 자연 종료: result 받으면 3초 grace, 그 사이 새 pending 있으면 push, 없으면 stdin.end()
    let resultReceived = false;
    let finalizeTimer = null;
    const scheduleFinalize = () => {
      if (finalizeTimer) clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(async () => {
        const next = await takeNextMessageFromAdmin(job.id);
        if (next) {
          log("info", `🗨️ 종료 직전 추가 명령: ${next.content.slice(0, 120)}`);
          writeUserMessage(next.content);
          resultReceived = false;
          return;
        }
        log("info", "Claude 작업 완료 — stdin 종료");
        try { proc.stdin.end(); } catch {}
      }, 3000);
    };

    const cleanupV17 = () => {
      try { clearInterval(messagePoller); } catch {}
      try { if (finalizeTimer) clearTimeout(finalizeTimer); } catch {}
    };

    // 캔슬 폴링 (어드민 progress endpoint)
    const cancelTimer = setInterval(async () => {
      const r = await reportProgress(job.id, {
        passed: state.passed, failed: state.failed, blocked: state.blocked,
      });
      if (r.cancel_requested && !canceled) {
        canceled = true;
        log("warn", "캔슬 요청 감지 — claude 종료");
        // v1.7 회귀 방지: stream-json input 은 stdin 열려있어서 SIGTERM 만으론 즉시 안 죽음.
        // → polling/timer 정리 + stdin.end() 먼저, 그 다음 SIGTERM.
        cleanupV17();
        try {
          if (proc.stdin && !proc.stdin.destroyed) {
            proc.stdin.end();
            log("info", "stdin 종료 (cancel 시 input loop 해제)");
          }
        } catch {}
        try { process.kill(-proc.pid, "SIGTERM"); } catch {}
        setTimeout(() => {
          // v1.7.6: 후손 트리 BFS — Playwright MCP 가 spawn 한 Chromium (--isolated temp dir) 까지 다 잡음
          const killedCount = killDescendantsTree(proc.pid);
          if (killedCount > 0) log("warn", `후손 프로세스 ${killedCount}개 SIGKILL (Chromium/MCP 포함)`);
          try { process.kill(-proc.pid, "SIGKILL"); } catch {}
        }, 2000);
      }
    }, 3000);

    // 청크 경계 멀티바이트(한글) 깨짐(U+FFFD) 방지 — StringDecoder 가 불완전 시퀀스 버퍼링.
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", async (chunk) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() || "";
      for (const ln of lines) {
        if (!ln.trim()) continue;
        // v1.7: result 메시지 감지 → 자연 종료 grace 시작
        try {
          const parsed = JSON.parse(ln);
          if (parsed.type === "result") {
            if (!resultReceived) {
              resultReceived = true;
              log("info", "Claude result 수신 — 3초 grace (추가 명령 가능)");
            }
            scheduleFinalize();
          }
        } catch {}
        const events = parseStreamLine(ln, state);
        if (events && events.length > 0) {
          await reportProgress(job.id, {
            passed: state.passed, failed: state.failed, blocked: state.blocked,
            logs: events,
          });
        }
      }
    });
    proc.stderr.on("data", (chunk) => {
      const txt = chunk.toString().trim();
      if (txt) log("warn", `[stderr] ${txt.slice(0, 300)}`);
    });
    proc.on("close", (code) => {
      clearInterval(cancelTimer);
      cleanupV17();
      activeProcs.delete(job.id);
      // 정상 종료여도 detached Chromium(Playwright MCP --isolated)이 남아있을 수 있어 한 번 더 정리
      try { process.kill(-proc.pid, "SIGKILL"); } catch {}
      const stragglers = killDescendantsTree(proc.pid);
      if (stragglers > 0) log("warn", `종료 후 남은 자손 프로세스 ${stragglers}개 SIGKILL`);
      const files = collectResultFiles(resultDir);
      // v1.7.2 정확한 CSV 파싱 — quoted field 안의 콤마 안전 처리
      try {
        const sumF = files.find((f) => f.relPath === "summary.csv");
        if (sumF) {
          const text = sumF.content.toString("utf-8").replace(/^﻿/, "").replace(/^﻿/, "");
          const lines = splitCsvLines(text);
          if (lines.length >= 2) {
            const header = lines[0].split(",");
            const ri = header.findIndex((h) => h.trim().toLowerCase() === "result");
            if (ri >= 0) {
              let p = 0, f = 0, b = 0;
              for (let i = 1; i < lines.length; i++) {
                const cells = parseSimpleCsvRow(lines[i]);
                const r = (cells[ri] || "").trim().toUpperCase();
                if (r === "PASS") p++;
                else if (r === "FAIL") f++;
                else if (r === "BLOCKED") b++;
              }
              state.passed = p; state.failed = f; state.blocked = b;
              log("info", `최종 집계 (CSV 재파싱): PASS=${p} FAIL=${f} BLOCKED=${b}`);
            }
          }
        }
      } catch (e) {
        log("warn", `summary.csv 파싱 실패: ${e.message}`);
      }
      const total = state.passed + state.failed + state.blocked;
      const status = canceled ? "canceled" : code === 0 ? "succeeded" : "failed";
      const errorMessage = canceled ? "사용자 요청으로 중단됨" : code !== 0 ? `claude 종료 코드 ${code}` : null;
      log("info", `claude 종료 code=${code}, ${status} — 결과 파일 ${files.length}개 수집`);
      resolve({
        status,
        stats: { passed: state.passed, failed: state.failed, blocked: state.blocked, total },
        files,
        errorMessage,
        resultDirLocal: resultDir,
      });
    });
    proc.on("error", (err) => {
      clearInterval(cancelTimer);
      cleanupV17();
      activeProcs.delete(job.id);
      // spawn 실패 후에도 일부 자손이 생겨있을 가능성 — 정리 시도
      try { killDescendantsTree(proc.pid); } catch {}
      resolve({
        status: "failed",
        stats: { passed: 0, failed: 0, blocked: 0, total: 0 },
        files: [],
        errorMessage: `claude spawn 실패: ${err.message}`,
      });
    });
  });
}

async function processJob(job) {
  activeJobs++;
  activeJobIds.add(job.id);
  console.log(`[worker] ▶ claim ${job.id} (slot ${activeJobs}/${MAX_CONCURRENT})`);
  try {
    log("info", `=== Job 처리 시작: ${job.id} (mode=${job.mode}, type=${job.job_type || "full"}) ===`);
    log("info", `  도메인=${job.domain}, 플랫폼=${job.platform}, 환경=${job.qa_env}`);
    log("info", `  파일=${job.tc_filename}`);

    const claimed = await claimJob(job.id);
    if (!claimed) { log("warn", `클레임 실패, 건너뜀.`); return; }
    await sendHeartbeat("busy");

    let result;
    if (job.mode === "real") {
      result = await runRealJob(job);
    } else {
      // mock — 애드혹도 일단 mockJob 흐름 재사용 (간단화)
      result = await runMockJob(job);
    }

    await uploadComplete(job.id, result.status, result.stats, result.errorMessage, result.files);
    log("info", `=== Job 완료: ${job.id} (${result.status}) — 결과 ${result.files.length}개 업로드 ===`);

    // 로컬 결과 폴더 정리 (업로드 성공했으면)
    if (result.resultDirLocal) {
      try { fs.rmSync(result.resultDirLocal, { recursive: true, force: true }); } catch {}
    }
  } catch (err) {
    log("error", `Job 처리 중 오류: ${err.message}`);
    try {
      await uploadComplete(job.id, "failed", { passed: 0, failed: 0, blocked: 0, total: 0 }, err.message, []);
    } catch {}
  } finally {
    activeJobs--;
    activeJobIds.delete(job.id);
    console.log(`[worker] ◀ release ${job.id} (slot ${activeJobs}/${MAX_CONCURRENT})`);
    await sendHeartbeat(activeJobs > 0 ? "busy" : "online");
  }
}

// ============== 메인 ==============

async function pollLoop() {
  // 빈 슬롯 만큼 즉시 추가 claim — fire-and-forget (await X)
  while (activeJobs < MAX_CONCURRENT) {
    const job = await fetchNextJob();
    if (!job) break;
    processJob(job).catch((err) => log("error", `processJob ${job.id} 에러: ${err.message}`));
  }
}

async function main() {
  log("info", "======================================");
  log("info", "Kurly QA Worker v1.0 (Phase 3c — REAL + Adhoc)");
  log("info", `워커 이름: ${WORKER_NAME}`);
  log("info", `중앙 서버: ${CENTRAL_URL}`);
  log("info", `QA-Cowork: ${QA_COWORK_HOME} ${fs.existsSync(QA_COWORK_HOME) ? "✓" : "✗ (REAL 모드 실행 불가)"}`);
  log("info", `Claude bin: ${CLAUDE_BIN}`);
  log("info", `Claude model: ${CLAUDE_MODEL} (CLAUDE_MODEL env 로 변경 가능)`);
  log("info", `Capabilities: ${JSON.stringify(capabilities)}`);
  log("info", `폴링 간격: ${POLL_MS}ms`);
  log("info", "======================================");

  let registered = false;
  while (!registered) {
    registered = await registerWithCentral();
    if (!registered) {
      log("warn", "5초 후 재시도...");
      await sleep(5000);
    }
  }

  log("info", `동시 처리 슬롯: ${MAX_CONCURRENT} (WORKER_MAX_CONCURRENT 로 조정)`);
  log("info", `테스트데이터 큐 슬롯: ${DATA_REQUEST_MAX_CONCURRENT} (WORKER_DATA_REQUEST_CONCURRENT 로 조정)`);
  setInterval(() => sendHeartbeat(activeJobs > 0 ? "busy" : "online"), HEARTBEAT_MS);
  setInterval(pollLoop, POLL_MS);
  setInterval(pollTcGen, POLL_MS);  // TC 설계/작성 분배 처리
  setInterval(pollDataRequests, POLL_MS);

  log("info", "워커 동작 중. Ctrl+C 로 종료.");
  log("info", "Phase 3c: MOCK + REAL + 애드혹 + TC설계/작성 모두 지원.");
}

// ============== TC 설계/작성 분배 처리 (워커 로컬 claude -p) ==============
// admin 의 pending TC설계/작성 잡을 가져와 이 워커의 claude 로 실행 → raw 출력 회신.
// (테스트 수행과 동일하게 워커 분산 — 각 워커 claude 토큰. brain=admin(조립/CSV추출), 워커=실행기.)
const TC_GEN_TIMEOUT_MS = 10 * 60 * 1000;
// TC설계/작성 동시 실행 수 — 브라우저 없이 claude 분석만 해서 병렬이 가벼움(수행과 별개). 기본 3.
const TCGEN_MAX_CONCURRENT = Math.max(1, parseInt(process.env.WORKER_TCGEN_CONCURRENT || "3", 10));
let tcGenActive = 0;

// 하네스(오케스트레이터) 모드 — admin 이 __HARNESS__ 프롬프트로 보낸 잡은 워커 클론의 하네스를 claude -p 로 실행.
const KURLY_HARNESS_PATH = process.env.KURLY_HARNESS_PATH || "";
const TC_GEN_HARNESS_TIMEOUT_MS = Math.max(1, parseInt(process.env.WORKER_HARNESS_TIMEOUT_MIN || "75", 10)) * 60 * 1000;
// 한 머신 동시 하네스 잡 수 — 잡별 격리 cwd(_jobs/<id>)라 충돌 없음. 기본 1(자원 안전), 사무실 등은 .env 에서 상향.
const HARNESS_MAX_CONCURRENT = Math.max(1, parseInt(process.env.WORKER_HARNESS_CONCURRENT || "1", 10));

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

// 범용 claude -p 실행 (cwd/타임아웃 지정)
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
    // setEncoding('utf8') → 청크 경계에서 잘린 멀티바이트(한글)를 StringDecoder 가 버퍼링. (없으면 U+FFFD(�) 깨짐)
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

async function getDataAgentRolesForWorker() {
  try {
    const res = await fetch(`${CENTRAL_URL}/api/agents?worker=${encodeURIComponent(WORKER_NAME)}`);
    if (!res.ok) return [];
    const state = await res.json();
    if (state?.modes?.data !== "multi") return [];
    return (state.agents || [])
      .filter((a) => a.grp === "data")
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0))
      .map((a) => ({ nickname: a.nickname, instruction: a.instruction || "" }));
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
- 새로 생성해야 하면 ${CENTRAL_URL}/test-data 페이지 또는 ${CENTRAL_URL}/api/test-data/* API 중 요청에 맞는 안전한 도구만 사용한다.
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
  const res = await fetch(`${CENTRAL_URL}/api/data-requests/${encodeURIComponent(id)}/result`, {
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
    const res = await fetch(`${CENTRAL_URL}/api/data-requests/next?worker=${encodeURIComponent(WORKER_NAME)}`);
    if (res.ok) req = (await res.json()).request;
  } catch {
    return;
  }
  if (!req) return;
  dataRequestActive++;
  log("info", `▶ data request ${req.id} claim (${dataRequestActive}/${DATA_REQUEST_MAX_CONCURRENT})`);
  try {
    const dataAgents = await getDataAgentRolesForWorker();
    if (dataAgents.length > 0) log("info", `data agents: ${dataAgents.map((a) => a.nickname).join(" → ")}`);
    const r = await runClaudeP(buildDataRequestWorkerPrompt(req, dataAgents), CLAUDE_MODEL, QA_COWORK_HOME, DATA_REQUEST_TIMEOUT_MS);
    const parsed = r.ok
      ? parseDataRequestOutput(r.output)
      : { status: "failed", dataContext: {}, verification: "", notes: "", errorMessage: r.failReason || "데이터 에이전트 실행 실패", rawOutput: r.output };
    await reportDataRequestResult(req.id, parsed);
    log("info", `✓ data request ${req.id} → ${parsed.status}`);
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
    log("error", `data request ${req.id} 실패: ${err.message}`);
  } finally {
    dataRequestActive--;
    log("info", `◀ data request ${req.id} release (${dataRequestActive}/${DATA_REQUEST_MAX_CONCURRENT})`);
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
  const { spawnSync } = require("node:child_process");
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

// 하네스 워크스페이스에서 현재 진행 단계 감지 (파일 존재 기반) — '멈춤?' 오인 방지용 실시간 표시
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
    await fetch(`${CENTRAL_URL}/api/tc-gen/${jobId}/progress`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker: WORKER_NAME, phase }),
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

let tcGenClaiming = false;  // claim 직렬화 (잡 타입을 claim 후에야 알 수 있음)
let harnessActive = 0;      // 실행 중 하네스 잡 수 (잡별 격리 cwd → WORKER_HARNESS_CONCURRENT 까지 동시 가능)

async function pollTcGen() {
  if (tcGenClaiming) return;                            // claim 1건씩
  if (harnessActive >= HARNESS_MAX_CONCURRENT) return;  // 하네스 동시 한도(잡별 격리 cwd라 N 가능 — WORKER_HARNESS_CONCURRENT)
  if (tcGenActive >= TCGEN_MAX_CONCURRENT) return;      // 비-하네스 동시 한도
  tcGenClaiming = true;
  let job;
  try {
    const res = await fetch(`${CENTRAL_URL}/api/tc-gen/next?worker=${encodeURIComponent(WORKER_NAME)}`);
    if (res.ok) job = (await res.json()).job;
  } catch { /* 서버 미기동 등 — 조용히 스킵 */ }
  if (!job) { tcGenClaiming = false; return; }
  const isHarness = typeof job.prompt === "string" && job.prompt.startsWith("__HARNESS__");
  if (isHarness) harnessActive++; else tcGenActive++;
  tcGenClaiming = false;
  log("info", `▶ TC생성 claim ${job.id} (${job.kind}${isHarness ? ", 하네스" : ""}) (수행 ${tcGenActive}/${TCGEN_MAX_CONCURRENT}, 하네스 ${harnessActive})`);
  try {
    const r = isHarness ? await runHarness(job) : await runTcGenClaude(job.prompt, job.model);
    await fetch(`${CENTRAL_URL}/api/tc-gen/${job.id}/result`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker: WORKER_NAME, ok: r.ok, output: r.output, failReason: r.failReason, report: r.report }),
    }).catch(() => {});
    log("info", `◀ TC생성 ${job.id} ${r.ok ? "완료" : "실패: " + r.failReason}`);
  } catch (err) {
    await fetch(`${CENTRAL_URL}/api/tc-gen/${job.id}/result`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worker: WORKER_NAME, ok: false, output: "", failReason: String((err && err.message) || err) }),
    }).catch(() => {});
  } finally {
    if (isHarness) harnessActive--; else tcGenActive--;
  }
}

console.log(`[worker] 하네스 모드: ${KURLY_HARNESS_PATH ? KURLY_HARNESS_PATH + ` (타임아웃 ${TC_GEN_HARNESS_TIMEOUT_MS / 60000}분, 동시 ${HARNESS_MAX_CONCURRENT})` : "비활성 (KURLY_HARNESS_PATH 미설정)"}`);

// 진행 중 claude proc + 자손 트리를 한 번에 cleanup. SIGINT/SIGTERM/uncaughtException 공용.
function cleanupActiveProcs(reason) {
  if (activeProcs.size === 0) return 0;
  log("warn", `${reason} — 진행 중 ${activeProcs.size}개 잡 정리 중`);
  let killedTotal = 0;
  for (const [jobId, proc] of activeProcs) {
    try { process.kill(-proc.pid, "SIGTERM"); } catch {}
    try {
      const n = killDescendantsTree(proc.pid);
      killedTotal += n;
    } catch {}
    log("warn", `  ${jobId}: SIGTERM + 자손 정리`);
  }
  return killedTotal;
}

process.on("SIGINT", () => {
  log("info", "SIGINT 수신");
  cleanupActiveProcs("SIGINT");
  setTimeout(() => process.exit(0), 1000);
});

process.on("SIGTERM", () => {
  log("info", "SIGTERM 수신");
  cleanupActiveProcs("SIGTERM");
  setTimeout(() => process.exit(0), 1000);
});

process.on("uncaughtException", (err) => {
  log("error", `uncaughtException: ${err.message}`);
  cleanupActiveProcs("uncaughtException");
  setTimeout(() => process.exit(1), 500);
});

main().catch((err) => {
  log("error", `치명적 오류: ${err.message}`);
  process.exit(1);
});
