/**
 * 구글드라이브 → 로컬 QA-Cowork 스킬/정책 동기화 (inbound, 중앙→로컬 미러).
 *
 * 정본 = Drive `00.프로덕트SQE` 하위 `[TC Skill] {Commerce|Logistics}_SQE` / `[마스터정책] {..}_SQE`.
 * 서비스계정 키(data/google-drive-key.json)로 인증 — 사용자 로그인/OAuth 아님(SSO 무관). 키는 git 미포함(data/).
 *
 * 매핑:
 *   [TC Skill] → tc-skills/ ,  [마스터정책] → policies/
 *   Commerce 도메인 → 기존 로컬 도메인그룹 폴더(회원멤버스/3P/상품/…) — tc-gen 바로 사용
 *   Logistics 도메인 → _logistics/<도메인> (Commerce와 이름 충돌 방지)
 *   "00. *표준안/공통*" → _공통
 *   파일: .md + .skill 다운로드, Google Docs(application/vnd.google-apps.*) 스킵
 *   변경분만(modifiedTime 비교), 덮어쓰기 전 _drive-backup 으로 백업, 로컬 전용 파일 삭제 안 함.
 *
 * 인증 흐름은 Node 내장(crypto JWT + fetch) — googleapis 의존성 없음.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { getQaCoworkHome } from "./prompt-manager";
import { getDomainById } from "./domains";

// 동기화 스코프 필터 — 커머스는 tcFolder 정확매칭, 물류는 키워드 포함매칭. 없으면 전체 동기화.
export interface SyncFilter { commerceTcFolder?: string; logisticsKeywords?: string[] }

const ROOT_FOLDER_ID = process.env.KURLY_DRIVE_FOLDER_ID || "163pOv6lyup-5iEwaYEBw5WXBAjSaa1HS";
// 표준TC사전(기능별) — 동기화 루트 밖 별도 폴더. /prompts 읽기전용 표시용(xlsx/yaml은 Drive 링크). env로 override/비활성("") 가능.
const STD_TC_FOLDER_ID = process.env.KURLY_STD_TC_FOLDER_ID ?? "1_cPhfdABBPW2ganfIihNEg-wQ-nxtZXd";
const KEY_PATH = process.env.KURLY_DRIVE_KEY || path.join(process.cwd(), "data", "google-drive-key.json");
const STATE_PATH = path.join(process.cwd(), "data", "drive-sync-state.json");
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export interface DriveSyncProgress { type: "phase" | "file"; ok: boolean; message: string; }
export interface DriveSyncResult {
  ok: boolean;
  synced: number;     // 새로 받거나 갱신된 파일
  skipped: number;    // 변경 없어 스킵
  ignored: number;    // gdoc 등 대상 아님
  pruned: number;     // 미러: Drive에 없어 백업으로 옮긴 옛/잔존 파일
  failed: number;
  files: { path: string; status: "synced" | "skipped" | "ignored" | "failed"; note?: string }[];
  error?: string;
  finishedAt: string;
}

interface SyncState { lastSyncAt: string | null; files: Record<string, { modifiedTime: string; localPath: string }>; }

const isFolder = (m: string) => m === "application/vnd.google-apps.folder";
// 사용 안 하는 폴더는 동기화 제외 — "(구) 미사용" 등
const EXCLUDE_FOLDER = /미사용|\(\s*구\s*\)|사용\s*안\s*함|deprecated|구버전|archive/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 구글 일시적 5xx/429/네트워크 오류 재시도(지수 백오프). 간헐 실패로 파일이 미러 정리되는 사고 방지.
async function driveFetch(url: string, init: RequestInit, tries = 4): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, init);
      if ((r.status >= 500 || r.status === 429) && i < tries - 1) { await sleep(600 * (i + 1)); continue; }
      return r;
    } catch (e) { last = e; await sleep(600 * (i + 1)); }
  }
  throw last instanceof Error ? last : new Error("Drive 요청 재시도 초과");
}

function loadState(): SyncState {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { lastSyncAt: null, files: {} }; }
}
function saveState(s: SyncState) {
  try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {}
}
export function getLastSync(): { lastSyncAt: string | null; fileCount: number } {
  const s = loadState();
  return { lastSyncAt: s.lastSyncAt, fileCount: Object.keys(s.files).length };
}

// 자동 동기화 쿨다운 — 하루 1회만 자동(잡 생성 시). 그 사이엔 로컬 사용. 수동 "지금 동기화"로 강제 가능.
const SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000;
let lastFullSyncMs = 0;                              // 수동 전체 동기화 시각 — 모든 스코프 fresh 처리
const lastDomainSyncMs: Record<string, number> = {}; // 도메인별 마지막 자동 동기화 시각
let lastFnSyncMs = 0;                                // 기능테스트 번들 마지막 동기화 시각
const hAgo = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
};

// 수동 전체 동기화 완료 표시 — 자동 쿨다운 리셋(24h) + 목록 캐시 무효화. /api/drive-sync 가 호출.
export function markFullSyncDone() { lastFullSyncMs = Date.now(); assetsCache = null; }

/**
 * 생성 직전 자동 동기화 — 그 도메인만, 하루 1회 쿨다운, 타임아웃+폴백(Drive 안 되면 로컬 그대로). 항상 resolve(생성 안 막음).
 * env KURLY_DRIVE_AUTOSYNC=0 으로 끌 수 있음.
 */
export async function autoSyncDomain(domainId: string, timeoutMs = 20000): Promise<{ ok: boolean; note: string }> {
  if (process.env.KURLY_DRIVE_AUTOSYNC === "0") return { ok: false, note: "자동동기화 off" };
  if (!fs.existsSync(KEY_PATH)) return { ok: false, note: "Drive 키 없음 — 로컬 사용" };
  const last = Math.max(lastFullSyncMs, lastDomainSyncMs[domainId] || 0);
  if (Date.now() - last < SYNC_COOLDOWN_MS) {
    return { ok: true, note: `오늘 이미 동기화함(${hAgo(last)}) — 로컬 사용. 강제하려면 프롬프트 페이지 "갱신"` };
  }
  const cfg = getDomainById(domainId);
  const filter: SyncFilter = cfg?.bu === "물류"
    ? { logisticsKeywords: [...(cfg.match ?? []), ...(cfg.policyFolders ?? [])] } // 스킬 번들 + 정책 폴더 둘 다 동기화
    : { commerceTcFolder: cfg?.tcFolder ?? domainId };
  try {
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${timeoutMs}ms 초과`)), timeoutMs));
    const r = (await Promise.race([syncDrive(undefined, filter), timeout])) as DriveSyncResult;
    if (r.ok) lastDomainSyncMs[domainId] = Date.now(); // 성공 시에만 쿨다운 시작(실패 시 다음 생성에 재시도)
    return { ok: r.ok, note: r.error ? `Drive 동기화 경고: ${r.error} — 로컬 사용` : `Drive 동기화: 갱신 ${r.synced}·정리 ${r.pruned}·변경없음 ${r.skipped}` };
  } catch (e) {
    return { ok: false, note: `Drive 동기화 스킵(${e instanceof Error ? e.message : String(e)}) — 로컬 사용` };
  }
}

// 기능테스트 자산 폴더명 (Drive 공유드라이브 루트 바로 아래).
const FUNCTIONAL_FOLDER_NAME = "[기능테스트 프롬프트]";

/**
 * 기능테스트 잡(/upload·/adhoc) 생성 직전 자동 동기화 — 프롬프트 번들 전체. 하루 1회 쿨다운, 타임아웃+폴백.
 * env KURLY_DRIVE_AUTOSYNC=0 으로 끌 수 있음.
 */
export async function autoSyncFunctional(timeoutMs = 20000): Promise<{ ok: boolean; note: string }> {
  if (process.env.KURLY_DRIVE_AUTOSYNC === "0") return { ok: false, note: "자동동기화 off" };
  if (!fs.existsSync(KEY_PATH)) return { ok: false, note: "Drive 키 없음 — 로컬 사용" };
  const last = Math.max(lastFullSyncMs, lastFnSyncMs);
  if (Date.now() - last < SYNC_COOLDOWN_MS) {
    return { ok: true, note: `오늘 이미 동기화함(${hAgo(last)}) — 로컬 사용. 강제하려면 프롬프트 페이지 "갱신"` };
  }
  try {
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${timeoutMs}ms 초과`)), timeoutMs));
    const r = (await Promise.race([syncFunctionalPrompts(undefined), timeout])) as DriveSyncResult;
    if (r.ok) lastFnSyncMs = Date.now(); // 성공 시에만 쿨다운 시작
    return { ok: r.ok, note: r.error ? `Drive 동기화 경고: ${r.error} — 로컬 사용` : `Drive 동기화(기능테스트 프롬프트): 갱신 ${r.synced}·정리 ${r.pruned}·변경없음 ${r.skipped}` };
  } catch (e) {
    return { ok: false, note: `Drive 동기화 스킵(${e instanceof Error ? e.message : String(e)}) — 로컬 사용` };
  }
}

// ===== 인증: 서비스계정 JWT → access_token =====
async function getAccessToken(): Promise<string> {
  if (!fs.existsSync(KEY_PATH)) throw new Error(`서비스계정 키 없음: ${KEY_PATH}`);
  const key = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  if (!key.client_email || !key.private_key) throw new Error("키 형식 오류 (client_email/private_key 없음)");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claim = b64({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, exp: now + 3600, iat: now });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${signer.sign(key.private_key).toString("base64url")}`;
  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j: any = await res.json();
  if (!j.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; }

// ===== Drive 트리 읽기(뷰 전용) — /prompts 페이지가 Drive 중앙 목록을 그대로 표시 =====
export interface DriveTreeEntry { name: string; rel: string; isDir: boolean; size: number; modifiedTime?: string; webViewLink?: string; }
// 페이지에 표시할 Drive 자산 그룹 (기능테스트 프롬프트 / TC 스킬·커머스·물류 / 마스터정책·커머스·물류)
export interface DriveGroup { key: string; label: string; icon: string; folderUrl: string; fileCount: number; entries: DriveTreeEntry[]; }
export interface DriveAssets { ok: boolean; groups: DriveGroup[]; claudeMd: DriveTreeEntry | null; error?: string; }

interface DriveFileFull extends DriveFile { size?: string; webViewLink?: string; }
async function listChildrenFull(token: string, folderId: string): Promise<DriveFileFull[]> {
  const out: DriveFileFull[] = [];
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink)&orderBy=folder,name&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r: any = await (await driveFetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (r.error) throw new Error(`목록 조회 실패: ${r.error.message}`);
    out.push(...(r.files || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

// 폴더 하위를 재귀적으로 평면 목록(폴더먼저, 리스팅 순서 보존)으로. 하위 폴더 listing 은 배치 병렬(폴더 수가 많음).
const TREE_FOLDER_BATCH = 6;
async function walkTree(token: string, folderId: string, relBase: string, extRe: RegExp = /\.(md|txt|skill)$/i, depth = 0, maxDepth = Infinity): Promise<DriveTreeEntry[]> {
  const children = await listChildrenFull(token, folderId);
  // 각 항목을 슬롯에 담아 순서 보존 — 폴더는 placeholder 후 하위를 비동기로 채움.
  const slots: DriveTreeEntry[][] = [];
  const folderTasks: { slot: number; id: string; rel: string }[] = [];
  for (const f of children) {
    if (EXCLUDE_FOLDER.test(f.name)) { slots.push([]); continue; }
    const rel = relBase ? `${relBase}/${f.name}` : f.name;
    if (isFolder(f.mimeType)) {
      if (depth + 1 < maxDepth) folderTasks.push({ slot: slots.length, id: f.id, rel });  // maxDepth 초과면 폴더명만 표시(하위 미전개 — 상세는 Drive 링크)
      slots.push([{ name: f.name, rel, isDir: true, size: 0 }]);
    } else if (extRe.test(f.name)) {
      slots.push([{ name: f.name, rel, isDir: false, size: Number(f.size || 0), modifiedTime: f.modifiedTime, webViewLink: f.webViewLink }]);
    } else {
      slots.push([]);
    }
  }
  for (let i = 0; i < folderTasks.length; i += TREE_FOLDER_BATCH) {
    await Promise.all(folderTasks.slice(i, i + TREE_FOLDER_BATCH).map(async (t) => {
      const sub = await walkTree(token, t.id, t.rel, extRe, depth + 1, maxDepth);
      slots[t.slot].push(...sub);
    }));
  }
  return slots.flat();
}

/** Drive 자산 트리(읽기 전용) — 기능테스트 프롬프트 + TC 스킬(커머스/물류) + 마스터정책(커머스/물류). /prompts 표시용. */
// /prompts 표시용 Drive 목록 캐시 — 매 페이지 진입마다 Drive 안 치도록. force=true 또는 수동 동기화 시 갱신.
let assetsCache: { at: number; data: DriveAssets } | null = null;

export async function listDriveAssets(force = false): Promise<DriveAssets> {
  if (!force && assetsCache && Date.now() - assetsCache.at < SYNC_COOLDOWN_MS) return assetsCache.data;
  try {
    if (!fs.existsSync(KEY_PATH)) return { ok: false, groups: [], claudeMd: null, error: "Drive 키 없음" };
    const token = await getAccessToken();
    const top = await listChildren(token, ROOT_FOLDER_ID);
    const wanted = top.filter((f) => isFolder(f.mimeType) && (f.name.trim() === FUNCTIONAL_FOLDER_NAME || /^\[(TC Skill|마스터정책)\]/.test(f.name)));
    if (wanted.length === 0) return { ok: false, groups: [], claudeMd: null, error: "대상 폴더 없음 — 공유/폴더ID 확인" };

    // 그룹별 트리를 병렬로 — walkTree 내부도 배치 병렬이라 전체 wall-clock 단축.
    const built = await Promise.all(wanted.map(async (f) => ({ f, entries: await walkTree(token, f.id, "") })));

    let claudeMd: DriveTreeEntry | null = null;
    const groups: DriveGroup[] = [];
    for (const b of built) {
      const name = b.f.name.trim();
      let entries = b.entries;
      let key: string, label: string, icon: string;
      if (name === FUNCTIONAL_FOLDER_NAME) {
        claudeMd = entries.find((e) => !e.isDir && e.rel === "CLAUDE.md") ?? null;
        entries = entries.filter((e) => e.rel !== "CLAUDE.md");
        key = "functional"; label = "기능테스트 프롬프트"; icon = "🧪";
      } else if (/^\[TC Skill\]/.test(name)) {
        const region = /Logistics/i.test(name) ? "물류" : "커머스";
        key = `tcskill-${region}`; label = `TC 스킬 · ${region}`; icon = "🧬";
      } else {
        const region = /Logistics/i.test(name) ? "물류" : "커머스";
        key = `policy-${region}`; label = `마스터정책 · ${region}`; icon = "📋";
      }
      groups.push({ key, label, icon, folderUrl: `https://drive.google.com/drive/folders/${b.f.id}`, fileCount: entries.filter((e) => !e.isDir).length, entries });
    }
    // 표준TC사전(기능별) — 별도 루트 폴더라 추가로 walk(읽기전용 링크). xlsx/yaml 포함. 접근 실패해도 전체는 진행.
    if (STD_TC_FOLDER_ID) {
      try {
        const stdEntries = await walkTree(token, STD_TC_FOLDER_ID, "", /\.(xlsx|xlsm|csv|ya?ml|md|txt)$/i, 0, 2);  // 깊은 아카이브(수백건) 방지 — 기능폴더 2단계까지, 상세는 Drive 링크
        if (stdEntries.some((e) => !e.isDir)) {
          groups.push({ key: "stdtc", label: "표준TC사전 (기능별)", icon: "📚", folderUrl: `https://drive.google.com/drive/folders/${STD_TC_FOLDER_ID}`, fileCount: stdEntries.filter((e) => !e.isDir).length, entries: stdEntries });
        }
      } catch { /* 표준TC사전 접근 불가 — 그룹 생략(나머지 정상 표시) */ }
    }
    const order: Record<string, number> = { functional: 0, "tcskill-커머스": 1, "tcskill-물류": 2, stdtc: 2.5, "policy-커머스": 3, "policy-물류": 4 };
    groups.sort((a, b) => (order[a.key] ?? 9) - (order[b.key] ?? 9));
    const result: DriveAssets = { ok: true, groups, claudeMd };
    assetsCache = { at: Date.now(), data: result };
    return result;
  } catch (e) {
    return { ok: false, groups: [], claudeMd: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===== 표준TC사전 Master(Drive) → 하네스 클론 동기화 (freshness, 다운그레이드 가드) =====
// Drive '[AX]표준TC사전_기능별'의 Master xlsx → 하네스 references/master/TC-Registry_Master.xlsx.
// 가드: Drive Master 에 '시나리오 패턴' 시트(Phase 3.5 핵심)가 있고 + Drive 가 더 최신일 때만 교체(백업 후).
//       구버전/시트누락이면 skip(로컬 유지) → 자동 다운그레이드 방지.
export async function syncStdTcMaster(emit?: (e: DriveSyncProgress) => void): Promise<{ ok: boolean; status: "synced" | "skipped" | "failed"; note: string }> {
  const log = (ok: boolean, message: string) => emit?.({ type: "file", ok, message });
  if (!fs.existsSync(KEY_PATH)) return { ok: false, status: "failed", note: "Drive 키 없음" };
  const harnessRoot = process.env.KURLY_HARNESS_PATH;
  if (!harnessRoot || !fs.existsSync(harnessRoot)) return { ok: false, status: "skipped", note: "KURLY_HARNESS_PATH 미설정/없음 — 하네스 클론 보유 머신(사무실 허브)에서만 동작" };
  if (!STD_TC_FOLDER_ID) return { ok: false, status: "skipped", note: "표준TC사전 폴더 미설정(KURLY_STD_TC_FOLDER_ID)" };
  const localMaster = path.join(harnessRoot, "references", "master", "TC-Registry_Master.xlsx");
  try {
    const token = await getAccessToken();
    const children = await listChildrenFull(token, STD_TC_FOLDER_ID);
    const GSHEET = "application/vnd.google-apps.spreadsheet";
    // Drive에 Master가 여러 개(사본 등)일 수 있음 → 이름에 master/registry 우선, 그중 modifiedTime 최신을 선택(비결정성 제거).
    const xlsxCands = children.filter((f) => !isFolder(f.mimeType) && (/\.xlsx$/i.test(f.name) || f.mimeType === GSHEET));
    const masters = xlsxCands.filter((f) => /master|registry/i.test(f.name));
    const dm = (masters.length ? masters : xlsxCands).sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())[0];
    if (!dm) return { ok: false, status: "failed", note: "Drive 표준TC사전 폴더에 Master xlsx 없음" };
    const driveMs = new Date(dm.modifiedTime).getTime();
    const localMs = fs.existsSync(localMaster) ? fs.statSync(localMaster).mtimeMs : 0;
    if (localMs >= driveMs) { log(true, "로컬 Master 최신/동일 — 동기화 불필요"); return { ok: true, status: "skipped", note: `최신 — 변경 없음 (Drive ${dm.modifiedTime})` }; }
    const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const buf = dm.mimeType === GSHEET ? await exportGdoc(token, dm.id, XLSX) : await downloadFile(token, dm.id);
    const tmp = path.join(os.tmpdir(), `stdtc-master-${Date.now()}.xlsx`);
    fs.writeFileSync(tmp, buf);
    try {
      // 다운그레이드/구조파손 가드 — '시나리오 패턴' 시트가 (1)존재 (2)헤더 1행=패턴 ID (3)PTN 패턴 ≥50개 여야 통과.
      //   Numbers/Sheets 왕복으로 헤더가 밀리거나(표1 캡션 행) 시트 누락된 구버전이면 하네스 Phase 3.5가 깨지므로 pull 거부(로컬 유지).
      //   python(openpyxl) 구조검증, 없으면 unzip 존재검사로 폴백.
      let gReason = "";
      try {
        const py = `import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], data_only=True)
if '시나리오 패턴' not in wb.sheetnames:
    print('FAIL|시나리오 패턴 시트 없음'); sys.exit()
ws = wb['시나리오 패턴']
a1 = None; ptn = 0
for i, row in enumerate(ws.iter_rows(values_only=True)):
    if i == 0: a1 = row[0]
    elif row and row[0] and str(row[0]).strip().startswith('PTN'): ptn += 1
ok = str(a1).strip() == '패턴 ID' and ptn >= 50
print(('OK|' if ok else 'FAIL|') + f'A1={a1},PTN={ptn}')`;
        const out = String(execFileSync("python3", ["-c", py, tmp], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).trim();
        if (!out.startsWith("OK|")) gReason = out.replace(/^FAIL\|/, "");
      } catch {
        // python/openpyxl 미사용 → 최소 존재검사(unzip)로 폴백
        let wbXml = "";
        try { wbXml = String(execFileSync("unzip", ["-p", tmp, "xl/workbook.xml"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })); } catch { /* ignore */ }
        if (!wbXml.includes("시나리오 패턴")) gReason = "시나리오 패턴 시트 없음(python 미사용 폴백)";
      }
      if (gReason) {
        log(false, `⚠️ 구조 가드 실패 — ${gReason} — 다운그레이드 방지로 중단(로컬 유지)`);
        return { ok: false, status: "skipped", note: `⚠️ Drive Master 구조 이상(${gReason}) — 동기화 안 함, 로컬 유지. (시나리오 패턴 헤더 1행 + PTN 패턴 50개 이상 필요)` };
      }
      fs.mkdirSync(path.dirname(localMaster), { recursive: true });
      if (fs.existsSync(localMaster)) {                       // 교체 전 백업
        const bdir = path.join(harnessRoot, "references", "master", "_backup");
        fs.mkdirSync(bdir, { recursive: true });
        fs.copyFileSync(localMaster, path.join(bdir, `TC-Registry_Master.bak.${Date.now()}.xlsx`));
      }
      fs.copyFileSync(tmp, localMaster);
      log(true, "Drive Master → 하네스 동기화 완료");
      return { ok: true, status: "synced", note: `동기화 완료 (Drive ${dm.modifiedTime} → 하네스 클론, 백업 보관)` };
    } finally { try { fs.unlinkSync(tmp); } catch {} }
  } catch (e) {
    return { ok: false, status: "failed", note: `오류: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ===== 표준TC사전 정답파일 freshness (최소버전 — 파일명 매칭) =====
// 하네스 보유 정답파일(references/{logistics,commerce}/**/*.xlsx) 각각에 대해, Drive 기능별 '정답파일/' 폴더의
// 같은 파일명을 찾아 Drive가 더 최신이면 교체(백업). 신규 파일(하네스에 없는 것)은 추가 안 함 — 구조/registry 무변경.
async function collectStdTcAnswerFiles(token: string, folderId: string, underJeongdap = false): Promise<{ name: string; id: string; modifiedTime: string }[]> {
  const out: { name: string; id: string; modifiedTime: string }[] = [];
  const children = await listChildrenFull(token, folderId);
  const subs: { id: string; under: boolean }[] = [];
  for (const f of children) {
    if (isFolder(f.mimeType)) subs.push({ id: f.id, under: underJeongdap || /정답파일/.test(f.name) });
    else if (underJeongdap && /\.xlsx$/i.test(f.name)) out.push({ name: f.name, id: f.id, modifiedTime: f.modifiedTime });
  }
  for (let i = 0; i < subs.length; i += 6) {
    const b = await Promise.all(subs.slice(i, i + 6).map((t) => collectStdTcAnswerFiles(token, t.id, t.under)));
    for (const x of b) out.push(...x);
  }
  return out;
}

function listLocalAnswerFiles(harnessRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "_backup") walk(p); }
      else if (/\.xlsx$/i.test(e.name)) out.push(p);
    }
  };
  for (const r of ["logistics", "commerce"]) walk(path.join(harnessRoot, "references", r));
  return out;
}

export async function syncStdTcAnswerFiles(emit?: (e: DriveSyncProgress) => void): Promise<{ ok: boolean; synced: number; skipped: number; noTwin: number; failed: number; note: string }> {
  const log = (ok: boolean, message: string) => emit?.({ type: "file", ok, message });
  const res = { ok: true, synced: 0, skipped: 0, noTwin: 0, failed: 0, note: "" };
  if (!fs.existsSync(KEY_PATH)) { res.ok = false; res.note = "Drive 키 없음"; return res; }
  const harnessRoot = process.env.KURLY_HARNESS_PATH;
  if (!harnessRoot || !fs.existsSync(harnessRoot)) { res.ok = false; res.note = "KURLY_HARNESS_PATH 미설정 — 사무실 허브 전용"; return res; }
  if (!STD_TC_FOLDER_ID) { res.ok = false; res.note = "표준TC사전 폴더 미설정"; return res; }
  try {
    const token = await getAccessToken();
    const drive = await collectStdTcAnswerFiles(token, STD_TC_FOLDER_ID);
    const byName = new Map<string, { id: string; mt: number }>();
    for (const f of drive) {
      const mt = new Date(f.modifiedTime).getTime();
      const prev = byName.get(f.name);
      if (!prev || mt > prev.mt) byName.set(f.name, { id: f.id, mt });   // 동명이면 최신본
    }
    for (const lp of listLocalAnswerFiles(harnessRoot)) {
      const base = path.basename(lp);
      const twin = byName.get(base);
      if (!twin) { res.noTwin++; continue; }
      if (twin.mt <= fs.statSync(lp).mtimeMs) { res.skipped++; continue; }
      try {
        const buf = await downloadFile(token, twin.id);
        const bdir = path.join(path.dirname(lp), "_backup");
        fs.mkdirSync(bdir, { recursive: true });
        fs.copyFileSync(lp, path.join(bdir, `${base}.bak.${Date.now()}`));
        fs.writeFileSync(lp, buf);
        res.synced++; log(true, `정답파일 갱신: ${base}`);
      } catch (e) { res.failed++; log(false, `정답파일 실패 ${base}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    res.ok = res.failed === 0;
    res.note = `정답파일 — 갱신 ${res.synced} · 최신 ${res.skipped} · Drive무 ${res.noTwin} · 실패 ${res.failed}`;
    return res;
  } catch (e) {
    res.ok = false; res.note = `오류: ${e instanceof Error ? e.message : String(e)}`; return res;
  }
}

// 하네스 잡 생성 직전 자동 호출 — 하루 1회 쿨다운 + 타임아웃. Master + 정답파일 둘 다. 수동 강제는 ↻ 갱신.
let lastStdTcSyncMs = 0;
export async function autoSyncStdTcMaster(timeoutMs = 30000): Promise<{ ok: boolean; note: string }> {
  if (process.env.KURLY_DRIVE_AUTOSYNC === "0") return { ok: false, note: "자동동기화 off" };
  if (!fs.existsSync(KEY_PATH) || !process.env.KURLY_HARNESS_PATH) return { ok: false, note: "조건 미충족(키/하네스경로)" };
  if (Date.now() - lastStdTcSyncMs < SYNC_COOLDOWN_MS) return { ok: true, note: "오늘 이미 체크함 — 로컬 사용" };
  lastStdTcSyncMs = Date.now();   // 시도 시점 쿨다운 — 느린 정답파일 다운로드로 타임아웃 나도 재시도 루프 방지(강제는 수동 ↻)
  try {
    const work = (async () => {
      const m = await syncStdTcMaster();
      const a = await syncStdTcAnswerFiles();
      return { ok: m.status !== "failed" && a.ok, note: `Master ${m.note} | ${a.note}` };
    })();
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${timeoutMs}ms 초과`)), timeoutMs));
    return await (Promise.race([work, timeout]) as Promise<{ ok: boolean; note: string }>);
  } catch (e) {
    return { ok: false, note: `스킵(${e instanceof Error ? e.message : String(e)})` };
  }
}

async function listChildren(token: string, folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&orderBy=folder,name&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r: any = await (await driveFetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (r.error) throw new Error(`목록 조회 실패: ${r.error.message}`);
    out.push(...(r.files || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const r = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`다운로드 실패 HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Google Docs류 → 텍스트로 export 변환 (문서→md, 시트→csv, 슬라이드→txt). 그 외 gdoc(폼/도면 등)은 변환 불가 → 무시.
const GDOC_EXPORT: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "text/markdown", ext: ".md" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: ".csv" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: ".txt" },
};
async function exportGdoc(token: string, fileId: string, mime: string): Promise<Buffer> {
  const r = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(mime)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`export 실패 HTTP ${r.status}${r.status === 403 ? " (10MB 초과 등)" : ""}`);
  return Buffer.from(await r.arrayBuffer());
}
// 파일명에 경로 구분자(/, \) 있으면 폴더로 새지 않게 치환
const safeName = (n: string) => n.replace(/[\/\\]/g, "_");

// 구글드라이브 "사본" 접미 제거 → 확장자가 뒤로 밀린 파일(.md의 사본/.skill의 사본) 정상 인식 + 원본과 dedupe.
//   "X.md의 사본" → "X.md",  "Copy of X" → "X",  "X (1)" → "X"
function stripCopySuffix(n: string): string {
  let s = n.replace(/^Copy of\s+/i, "");
  s = s.replace(/(\s*의\s*사본)+\s*$/u, "");   // "의 사본" (반복 포함) 끝 제거
  s = s.replace(/\s*\(\d+\)\s*$/u, "");        // " (1)" 끝 제거
  return s.trim();
}

// .skill = Claude Code 스킬 ZIP 번들(PK). tc-gen 은 스킬을 "텍스트로 주입"하므로
// 번들을 풀어 안의 SKILL.md 를 추출해 .md 로 저장해야 함(raw zip 주입 시 깨짐). 시스템 unzip 사용(mac/linux).
function extractSkillMd(zip: Buffer): Buffer {
  const tmp = path.join(os.tmpdir(), `drive-skill-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(tmp, zip);
  try {
    const out = execFileSync("unzip", ["-p", tmp, "*SKILL.md"], { maxBuffer: 32 * 1024 * 1024 });
    if (!out || out.length === 0) throw new Error("번들에 SKILL.md 없음");
    return out;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// 도메인 폴더명 정규화: "01. [AI] 회원(멤버스)_skill" → "회원멤버스"
export function normalizeDomain(name: string): string {
  let s = name.replace(/^\s*\d+\.?\s*/, "");        // 앞 "01. " / "05 "
  s = s.replace(/\[AI\]\s*/g, "");                   // "[AI] "
  s = s.replace(/_(skill|마스터|sqe)\s*$/i, "");     // 끝 접미사(_skill/_마스터/_SQE). 한글은 \b 안 먹어 $ 앵커 사용
  if (/표준안|공통/.test(s)) return "_공통";
  return s.replace(/[\/()[\]]/g, "").replace(/\s+/g, "").trim() || "_기타";
}

/** 파일 1건 동기화: 처리 방식 판별(다운로드/export/skill) → 변경분만 받기 + 덮어쓰기 전 백업. */
async function syncOneFile(
  token: string, f: DriveFile, localDir: string, relForLog: string,
  state: SyncState, res: DriveSyncResult, backupRoot: string, kept: Set<string>,
  emit: (e: DriveSyncProgress) => void,
) {
  // 처리 방식 결정 (네트워크 전): mimeType + 이름("사본" 접미 제거)로 판별.
  //   gdoc 문서/시트/슬라이드 → export 변환 / zip(.skill) → unzip해 SKILL.md / 텍스트(.md·.txt) → 다운로드 / 그 외 → 무시
  let plan: { mode: "download" | "export" | "skill"; mime?: string; localName: string } | null = null;
  const gdoc = GDOC_EXPORT[f.mimeType];
  const isGapp = f.mimeType.startsWith("application/vnd.google-apps.");
  const clean = safeName(stripCopySuffix(f.name));
  if (gdoc) {
    plan = { mode: "export", mime: gdoc.mime, localName: clean.toLowerCase().endsWith(gdoc.ext) ? clean : clean + gdoc.ext };
  } else if (!isGapp && (/\.skill$/i.test(clean) || /zip/i.test(f.mimeType))) {
    plan = { mode: "skill", localName: clean.replace(/\.(skill|zip)$/i, "") + ".md" };
  } else if (!isGapp && (/\.(md|txt)$/i.test(clean) || /^text\//i.test(f.mimeType))) {
    plan = { mode: "download", localName: /\.(md|txt)$/i.test(clean) ? clean : clean + ".md" };
  }
  const rel = relForLog ? `${relForLog}/${plan ? plan.localName : f.name}` : (plan ? plan.localName : f.name);
  if (!plan) {
    res.ignored++; res.files.push({ path: rel, status: "ignored", note: "변환 불가/비대상" });
    return;
  }
  const prev = state.files[f.id];
  if (prev && prev.modifiedTime === f.modifiedTime && fs.existsSync(prev.localPath)) {
    kept.add(prev.localPath);
    res.skipped++; res.files.push({ path: rel, status: "skipped" });
    return;
  }
  try {
    let buf: Buffer;
    if (plan.mode === "export") buf = await exportGdoc(token, f.id, plan.mime!);
    else if (plan.mode === "skill") buf = extractSkillMd(await downloadFile(token, f.id));
    else buf = await downloadFile(token, f.id);
    fs.mkdirSync(localDir, { recursive: true });
    const target = path.join(localDir, plan.localName);
    if (fs.existsSync(target)) {                       // 덮어쓰기 전 백업
      const bdir = path.join(backupRoot, relForLog);
      fs.mkdirSync(bdir, { recursive: true });
      fs.copyFileSync(target, path.join(bdir, plan.localName));
    }
    fs.writeFileSync(target, buf);
    kept.add(target);
    state.files[f.id] = { modifiedTime: f.modifiedTime, localPath: target };
    const note = plan.mode === "export" ? "gdoc 변환" : plan.mode === "skill" ? "skill 추출" : undefined;
    res.synced++; res.files.push({ path: rel, status: "synced", note });
    emit({ type: "file", ok: true, message: `↓ ${rel}${note ? ` (${note})` : ""}` });
  } catch (e) {
    res.failed++; res.files.push({ path: rel, status: "failed", note: e instanceof Error ? e.message : String(e) });
    emit({ type: "file", ok: false, message: `✗ ${rel}: ${e instanceof Error ? e.message : String(e)}` });
  }
}

const DOWNLOAD_CONCURRENCY = 8; // 파일 다운로드 동시 실행 수 (첫 전체 동기화 속도 ↑)

/** 한 폴더(또는 그 하위)를 재귀적으로 로컬 localDir 아래로 동기화. 파일은 동시 다운로드. */
async function syncFolder(
  token: string, folderId: string, localDir: string, relForLog: string,
  state: SyncState, res: DriveSyncResult, backupRoot: string, kept: Set<string>,
  emit: (e: DriveSyncProgress) => void,
) {
  const children = await listChildren(token, folderId);
  // 하위 폴더 먼저 재귀(순차 — 폴더 수는 적음), 파일은 모아서 동시 다운로드.
  const files: DriveFile[] = [];
  for (const f of children) {
    if (isFolder(f.mimeType)) {
      if (EXCLUDE_FOLDER.test(f.name)) { emit({ type: "file", ok: true, message: `⊘ 제외(미사용): ${relForLog}/${f.name}` }); continue; }
      await syncFolder(token, f.id, path.join(localDir, f.name), `${relForLog}/${f.name}`, state, res, backupRoot, kept, emit);
    } else {
      files.push(f);
    }
  }
  // res/state/kept 변형은 await 사이가 아니라 다운로드 완료 직후 동기적으로 일어나 단일스레드에서 안전.
  for (let i = 0; i < files.length; i += DOWNLOAD_CONCURRENCY) {
    await Promise.all(
      files.slice(i, i + DOWNLOAD_CONCURRENCY).map((f) =>
        syncOneFile(token, f, localDir, relForLog, state, res, backupRoot, kept, emit)
      )
    );
  }
}

/** 미러 정리: 관리 폴더(managedDirs)에서 이번에 받지 않은 파일(Drive에 없는 옛/잔존)을 백업으로 이동(하드삭제 X). */
function pruneManaged(
  home: string, managedDirs: Set<string>, finishedAt: string,
  kept: Set<string>, state: SyncState, res: DriveSyncResult,
  emit: (e: DriveSyncProgress) => void,
) {
  const mirrorBackup = path.join(home, "_drive-backup", finishedAt.replace(/[:.]/g, "-") + "-mirror");
  const prune = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { prune(full); continue; }
      if (kept.has(full)) continue;
      const rel = path.relative(home, full);
      const dest = path.join(mirrorBackup, rel);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(full, dest);
        res.pruned++;
        emit({ type: "file", ok: true, message: `⇠ 백업으로 정리(미러): ${rel}` });
        for (const [id, v] of Object.entries(state.files)) if (v.localPath === full) delete state.files[id];
      } catch { /* skip */ }
    }
  };
  for (const d of managedDirs) prune(d);
}

// filter 지정 시 해당 도메인 폴더만 동기화(커머스=tcFolder 정확, 물류=키워드 포함) — "생성 직전 자동 동기화"용. 미러 정리도 그 폴더로만 스코프.
export async function syncDrive(onProgress?: (e: DriveSyncProgress) => void, filter?: SyncFilter): Promise<DriveSyncResult> {
  const emit = (e: DriveSyncProgress) => onProgress?.(e);
  const finishedAt = new Date().toISOString();
  const res: DriveSyncResult = { ok: false, synced: 0, skipped: 0, ignored: 0, pruned: 0, failed: 0, files: [], finishedAt };
  const kept = new Set<string>();          // 이번 동기화로 받았거나(synced) 이미 최신(skipped)인 로컬 파일 — 미러 정리에서 보존
  const managedDirs = new Set<string>();   // 동기화가 쓴 도메인 폴더 — 미러 정리 대상 범위
  try {
    emit({ type: "phase", ok: true, message: "인증 + 폴더 조회…" });
    const token = await getAccessToken();
    const home = getQaCoworkHome();
    const backupRoot = path.join(home, "_drive-backup", finishedAt.replace(/[:.]/g, "-"));
    const state = loadState();

    const top = await listChildren(token, ROOT_FOLDER_ID);
    const targets = top.filter((f) => isFolder(f.mimeType) && /^\[(TC Skill|마스터정책)\]/.test(f.name));
    if (targets.length === 0) throw new Error("대상 폴더([TC Skill]/[마스터정책]) 없음 — 공유/폴더ID 확인");

    for (const tf of targets) {
      const kind = tf.name.startsWith("[TC Skill]") ? "tc-skills" : "policies";
      const isLogistics = /Logistics/i.test(tf.name);
      emit({ type: "phase", ok: true, message: `▼ ${tf.name} → ${kind}${isLogistics ? "/_logistics" : ""}` });
      // 각 도메인 폴더
      const domains = await listChildren(token, tf.id);
      for (const dom of domains) {
        if (!isFolder(dom.mimeType)) continue;
        if (EXCLUDE_FOLDER.test(dom.name)) { emit({ type: "file", ok: true, message: `⊘ 제외(미사용): ${tf.name}/${dom.name}` }); continue; }
        const norm = normalizeDomain(dom.name);
        if (filter) {   // 도메인 스코프
          if (isLogistics) {
            if (!filter.logisticsKeywords?.some((k) => norm.includes(k))) continue;
          } else if (norm !== filter.commerceTcFolder) continue;
        }
        const localDir = isLogistics
          ? path.join(home, kind, "_logistics", norm)
          : path.join(home, kind, norm);
        managedDirs.add(localDir);
        await syncFolder(token, dom.id, localDir, `${kind}${isLogistics ? "/_logistics" : ""}/${norm}`, state, res, backupRoot, kept, emit);
      }
    }

    // 미러 정리(관리 폴더 범위) — Drive에 없는 옛/잔존 파일을 백업으로 이동.
    // 안전장치: 실패가 1건이라도 있으면 kept 집합이 불완전 → prune 금지(멀쩡한 로컬 파일을 백업으로 옮기는 사고 방지).
    if (res.failed === 0) pruneManaged(home, managedDirs, finishedAt, kept, state, res, emit);
    else emit({ type: "phase", ok: false, message: `⚠ 실패 ${res.failed}건 — 미러 정리 건너뜀(불완전 동기화, 로컬 파일 보존)` });

    state.lastSyncAt = finishedAt;
    saveState(state);
    res.ok = res.failed === 0;
    emit({ type: "phase", ok: res.ok, message: `완료 — 갱신 ${res.synced} · 변경없음 ${res.skipped} · 정리 ${res.pruned} · 스킵 ${res.ignored} · 실패 ${res.failed}` });
    return res;
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e);
    emit({ type: "phase", ok: false, message: `실패: ${res.error}` });
    return res;
  }
}

/**
 * 기능테스트 프롬프트 번들 동기화: Drive `[기능테스트 프롬프트]/prompts`→로컬 `prompts/`,
 * `/knowledge`→`knowledge/`, 최상위 파일(CLAUDE.md 등)→home 루트.
 * TC생성 동기화(syncDrive)와 달리 도메인 정규화 없이 폴더 트리를 그대로 미러.
 * 미러 정리는 prompts/·knowledge/ 만(home 루트는 다른 파일이 많아 prune 안 함).
 */
export async function syncFunctionalPrompts(onProgress?: (e: DriveSyncProgress) => void): Promise<DriveSyncResult> {
  const emit = (e: DriveSyncProgress) => onProgress?.(e);
  const finishedAt = new Date().toISOString();
  const res: DriveSyncResult = { ok: false, synced: 0, skipped: 0, ignored: 0, pruned: 0, failed: 0, files: [], finishedAt };
  const kept = new Set<string>();
  const managedDirs = new Set<string>();
  try {
    emit({ type: "phase", ok: true, message: "인증 + 폴더 조회…" });
    const token = await getAccessToken();
    const home = getQaCoworkHome();
    const backupRoot = path.join(home, "_drive-backup", finishedAt.replace(/[:.]/g, "-"));
    const state = loadState();

    const top = await listChildren(token, ROOT_FOLDER_ID);
    const fn = top.find((f) => isFolder(f.mimeType) && f.name.trim() === FUNCTIONAL_FOLDER_NAME);
    if (!fn) throw new Error(`대상 폴더(${FUNCTIONAL_FOLDER_NAME}) 없음 — 업로드/공유/폴더ID 확인`);

    const sub = await listChildren(token, fn.id);
    for (const s of sub) {
      if (isFolder(s.mimeType)) {
        if (EXCLUDE_FOLDER.test(s.name)) { emit({ type: "file", ok: true, message: `⊘ 제외(미사용): ${s.name}` }); continue; }
        // prompts/ , knowledge/ → 로컬 동명 폴더로 그대로 미러
        const localDir = path.join(home, s.name);
        managedDirs.add(localDir);
        emit({ type: "phase", ok: true, message: `▼ ${FUNCTIONAL_FOLDER_NAME}/${s.name} → ${s.name}/` });
        await syncFolder(token, s.id, localDir, s.name, state, res, backupRoot, kept, emit);
      } else {
        // 최상위 파일(CLAUDE.md 등) → home 루트. home 은 prune 대상 아님(잡다한 파일 많음).
        await syncOneFile(token, s, home, "", state, res, backupRoot, kept, emit);
      }
    }

    // 미러 정리 — prompts/·knowledge/ 만 (home 루트는 절대 prune 안 함)
    // 안전장치: 실패가 1건이라도 있으면 kept 집합이 불완전 → prune 금지(멀쩡한 로컬 파일을 백업으로 옮기는 사고 방지).
    if (res.failed === 0) pruneManaged(home, managedDirs, finishedAt, kept, state, res, emit);
    else emit({ type: "phase", ok: false, message: `⚠ 실패 ${res.failed}건 — 미러 정리 건너뜀(불완전 동기화, 로컬 파일 보존)` });

    state.lastSyncAt = finishedAt;
    saveState(state);
    res.ok = res.failed === 0;
    emit({ type: "phase", ok: res.ok, message: `완료 — 갱신 ${res.synced} · 변경없음 ${res.skipped} · 정리 ${res.pruned} · 스킵 ${res.ignored} · 실패 ${res.failed}` });
    return res;
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e);
    emit({ type: "phase", ok: false, message: `실패: ${res.error}` });
    return res;
  }
}
