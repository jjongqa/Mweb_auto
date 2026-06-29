// 기능테스트 프롬프트(prompts/ + knowledge/ + CLAUDE.md)를 팀 공유 드라이브에 업로드.
// 멱등: 폴더/파일이 있으면 재사용·내용 갱신, 없으면 생성 → 재실행해도 중복 안 생김.
// 앱 상시 키는 readonly 유지. 이 스크립트만 쓰기 스코프를 그때만 요청한다.
//
//   node scripts/upload-prompts-to-drive.mjs
//
// env: KURLY_DRIVE_KEY, KURLY_DRIVE_FOLDER_ID(공유드라이브 루트), KURLY_QA_HOME

import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const KEY_PATH = process.env.KURLY_DRIVE_KEY || path.join(process.cwd(), "data", "google-drive-key.json");
const ROOT = process.env.KURLY_DRIVE_FOLDER_ID || "163pOv6lyup-5iEwaYEBw5WXBAjSaa1HS"; // 00. 프로덕트SQE
const HOME = process.env.KURLY_QA_HOME || path.join(os.homedir(), "Documents", "QA-Cowork", "AI_Test");
const TOP_NAME = "[기능테스트 프롬프트]";
const SCOPE = "https://www.googleapis.com/auth/drive"; // 쓰기 — 이 스크립트 전용
const FOLDER_MIME = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3";
const UP = "https://www.googleapis.com/upload/drive/v3";
const COMMON = "supportsAllDrives=true&includeItemsFromAllDrives=true";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 구글 일시적 5xx/네트워크 오류 재시도(지수 백오프).
async function fetchRetry(url, opts, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.status >= 500 && i < tries - 1) { await sleep(800 * (i + 1)); continue; }
      return r;
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr || new Error("재시도 초과");
}

async function getToken() {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const h = b64u({ alg: "RS256", typ: "JWT" });
  const c = b64u({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, exp: now + 3600, iat: now });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(h + "." + c), key.private_key).toString("base64url");
  const r = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("토큰 실패: " + JSON.stringify(j));
  return j.access_token;
}

async function findChild(token, parent, name, isFolder) {
  const safe = name.replace(/'/g, "\\'");
  let q = `'${parent}' in parents and name = '${safe}' and trashed = false`;
  if (isFolder) q += ` and mimeType = '${FOLDER_MIME}'`;
  const url = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&${COMMON}`;
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json();
  if (j.error) throw new Error("검색 실패 " + name + ": " + JSON.stringify(j.error));
  return j.files?.[0] || null;
}

async function ensureFolder(token, parent, name) {
  const ex = await findChild(token, parent, name, true);
  if (ex) return { id: ex.id, created: false };
  const r = await fetchRetry(`${API}/files?${COMMON}&fields=id`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  });
  const j = await r.json();
  if (!j.id) throw new Error("폴더 생성 실패 " + name + ": " + JSON.stringify(j));
  return { id: j.id, created: true };
}

async function uploadFile(token, parent, filePath) {
  const name = path.basename(filePath);
  const content = fs.readFileSync(filePath);
  const ex = await findChild(token, parent, name, false);
  if (ex) {
    const r = await fetchRetry(`${UP}/files/${ex.id}?uploadType=media&${COMMON}&fields=id`, {
      method: "PATCH",
      headers: { Authorization: "Bearer " + token, "Content-Type": "text/markdown; charset=UTF-8" },
      body: content,
    });
    const j = await r.json();
    if (!j.id) throw new Error("갱신 실패 " + name + ": " + JSON.stringify(j));
    return "갱신";
  }
  const boundary = "kqab" + Math.random().toString(16).slice(2);
  const meta = JSON.stringify({ name, parents: [parent] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n`, "utf8"),
    content,
    Buffer.from(`\r\n--${boundary}--`, "utf8"),
  ]);
  const r = await fetchRetry(`${UP}/files?uploadType=multipart&${COMMON}&fields=id`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const j = await r.json();
  if (!j.id) throw new Error("업로드 실패 " + name + ": " + JSON.stringify(j));
  return "생성";
}

const stats = { folders: 0, created: 0, updated: 0 };

async function uploadDir(token, parent, localDir, indent = "  ") {
  for (const e of fs.readdirSync(localDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue; // .DS_Store 등 제외
    const full = path.join(localDir, e.name);
    if (e.isDirectory()) {
      const f = await ensureFolder(token, parent, e.name);
      stats.folders++;
      console.log(`${indent}📁 ${e.name}/ ${f.created ? "(생성)" : "(기존)"}`);
      await uploadDir(token, f.id, full, indent + "  ");
    } else if (e.name.endsWith(".md")) {
      const res = await uploadFile(token, parent, full);
      if (res === "생성") stats.created++; else stats.updated++;
      console.log(`${indent}📄 ${e.name} → ${res}`);
    }
  }
}

(async () => {
  const token = await getToken();
  const cap = await (await fetch(`${API}/files/${ROOT}?${COMMON}&fields=name,capabilities(canAddChildren)`, { headers: { Authorization: "Bearer " + token } })).json();
  if (!cap.capabilities?.canAddChildren) throw new Error("쓰기 권한 없음 — 공유드라이브 멤버 권한(참여자 이상) 확인 필요");
  console.log(`대상 공유 드라이브: ${cap.name} (${ROOT})\n`);

  const top = await ensureFolder(token, ROOT, TOP_NAME);
  console.log(`📂 ${TOP_NAME}/ ${top.created ? "(생성)" : "(기존)"}  id=${top.id}`);

  const promptsF = await ensureFolder(token, top.id, "prompts");
  console.log(`  📁 prompts/ ${promptsF.created ? "(생성)" : "(기존)"}`);
  await uploadDir(token, promptsF.id, path.join(HOME, "prompts"), "    ");

  const knowledgeF = await ensureFolder(token, top.id, "knowledge");
  console.log(`  📁 knowledge/ ${knowledgeF.created ? "(생성)" : "(기존)"}`);
  await uploadDir(token, knowledgeF.id, path.join(HOME, "knowledge"), "    ");

  // CLAUDE.md (전역 규칙) — 최상위에
  const claudePath = path.join(HOME, "CLAUDE.md");
  if (fs.existsSync(claudePath)) {
    const res = await uploadFile(token, top.id, claudePath);
    if (res === "생성") stats.created++; else stats.updated++;
    console.log(`  📄 CLAUDE.md → ${res}`);
  }

  console.log(`\n✅ 완료 — 폴더 ${stats.folders}개 · 파일 생성 ${stats.created} · 갱신 ${stats.updated}`);
  console.log(`🔗 https://drive.google.com/drive/folders/${top.id}`);
})().catch((e) => { console.error("❌ " + e.message); process.exit(1); });
