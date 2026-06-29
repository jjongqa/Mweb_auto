import { db, type JiraSettings, type JiraIssueRecord } from "./db";
import { encrypt, decrypt, isEncrypted } from "./secret-store";

export function maskToken(value: string | null | undefined): string {
  if (!value) return "(없음)";
  const v = value.trim();
  if (v.length <= 12) return "••••••" + v.slice(-3);
  return v.slice(0, 6) + "••••" + v.slice(-4);
}

// 평문으로 저장된 토큰을 발견 시 즉시 암호문으로 교체 (lazy 마이그레이션).
// 호출은 read 경로에서 한 번 → DB 갱신은 다음 read 부터 enc:v1 prefix.
function decryptAndMaybeMigrate(row: JiraSettings | null): JiraSettings | null {
  if (!row) return null;
  if (!row.api_token) return row;
  if (isEncrypted(row.api_token)) {
    return { ...row, api_token: decrypt(row.api_token) };
  }
  // legacy 평문 — 그대로 반환하면서 DB 만 갱신
  try {
    const enc = encrypt(row.api_token);
    db.prepare(`UPDATE jira_settings SET api_token=? WHERE id=?`).run(enc, row.id);
  } catch (err) {
    console.warn(`[jira] 토큰 자동 암호화 실패 id=${row.id}:`, (err as Error).message);
  }
  return row;
}

// ============== Settings ==============

/** default fallback — 가장 최근 last_used → 그 다음 id desc. 매칭 실패 시 사용. */
export function getSettings(): JiraSettings | null {
  const row = (db.prepare(`SELECT * FROM jira_settings ORDER BY last_used_at DESC NULLS LAST, id DESC LIMIT 1`).get() as JiraSettings) ?? null;
  return decryptAndMaybeMigrate(row);
}

export function getSettingsById(id: number): JiraSettings | null {
  const row = (db.prepare(`SELECT * FROM jira_settings WHERE id = ?`).get(id) as JiraSettings) ?? null;
  return decryptAndMaybeMigrate(row);
}

export function getAllSettings(): JiraSettings[] {
  const rows = (db.prepare(`SELECT * FROM jira_settings ORDER BY id ASC`).all() as JiraSettings[]) ?? [];
  return rows.map((r) => decryptAndMaybeMigrate(r)!).filter(Boolean);
}

/**
 * requested_by (잡 만든 사람 이름) 으로 토큰 행 찾기.
 *  1. name 정확 일치 (대소문자 무시, 공백 제거)
 *  2. name 부분 일치 (request_by 안에 name 포함 or 그 반대)
 *  3. 못 찾으면 null → 호출자가 getSettings() 로 fallback
 */
export function getSettingsByName(requestedBy: string | null | undefined): JiraSettings | null {
  if (!requestedBy) return null;
  const needle = requestedBy.trim().toLowerCase();
  if (!needle) return null;
  const rows = getAllSettings();
  // 정확 일치 우선
  const exact = rows.find((r) => r.name.trim().toLowerCase() === needle);
  if (exact) return exact;
  // 부분 일치
  const partial = rows.find((r) => {
    const n = r.name.trim().toLowerCase();
    return n.length > 0 && (needle.includes(n) || n.includes(needle));
  });
  return partial ?? null;
}

export interface SaveSettingsInput {
  name: string;
  host: string;
  email: string;
  api_token: string;
  default_project_key: string;
  default_issue_type?: string;
  labels?: string | null;
  note?: string | null;
}

/**
 * upsert.
 *  - id 있으면 update
 *  - id 없으면 새 행 insert (1행 제약 해제 — 워커별 분기처리)
 */
export function upsertSettings(input: SaveSettingsInput, id?: number): JiraSettings {
  // 저장 시점에 암호화 — 호출부는 평문 그대로 전달
  const encryptedToken = encrypt(input.api_token.trim());
  if (id != null) {
    db.prepare(
      `UPDATE jira_settings SET name=?, host=?, email=?, api_token=?, default_project_key=?, default_issue_type=?, labels=?, note=?, updated_at=datetime('now') WHERE id=?`
    ).run(
      input.name.trim(),
      input.host.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""),
      input.email.trim(),
      encryptedToken,
      input.default_project_key.trim().toUpperCase(),
      (input.default_issue_type || "Bug").trim(),
      input.labels || null,
      input.note || null,
      id
    );
    return getSettingsById(id)!;
  }
  const res = db.prepare(
    `INSERT INTO jira_settings (name, host, email, api_token, default_project_key, default_issue_type, labels, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.name.trim(),
    input.host.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""),
    input.email.trim(),
    encryptedToken,
    input.default_project_key.trim().toUpperCase(),
    (input.default_issue_type || "Bug").trim(),
    input.labels || null,
    input.note || null
  );
  return getSettingsById(Number(res.lastInsertRowid))!;
}

export function touchSettingsLastUsed(id: number) {
  db.prepare(`UPDATE jira_settings SET last_used_at=datetime('now') WHERE id=?`).run(id);
}

export function deleteSettings(id: number): boolean {
  return db.prepare(`DELETE FROM jira_settings WHERE id=?`).run(id).changes > 0;
}

export function publicSettings(s: JiraSettings) {
  return {
    id: s.id,
    name: s.name,
    host: s.host,
    email: s.email,
    api_token_masked: maskToken(s.api_token),
    default_project_key: s.default_project_key,
    default_issue_type: s.default_issue_type,
    labels: s.labels,
    note: s.note,
    created_at: s.created_at,
    updated_at: s.updated_at,
    last_used_at: s.last_used_at,
    claimed_at: s.claimed_at,
  };
}

/** 글로벌 claim — 누군가 이 행을 "내 토큰"으로 잡음. 다른 워커 화면에서 [내 토큰] 버튼 숨김. */
export function claimSettings(id: number): boolean {
  return db.prepare(`UPDATE jira_settings SET claimed_at=datetime('now') WHERE id=?`).run(id).changes > 0;
}

export function unclaimSettings(id: number): boolean {
  return db.prepare(`UPDATE jira_settings SET claimed_at=NULL WHERE id=?`).run(id).changes > 0;
}

// ============== Issue records ==============

export function recordIssue(input: {
  job_id: string;
  tc_no: string | null;
  issue_key: string;
  issue_url: string;
  summary: string | null;
  created_by?: string | null;
}): JiraIssueRecord {
  const res = db.prepare(
    `INSERT INTO jira_issues (job_id, tc_no, issue_key, issue_url, summary, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.job_id,
    input.tc_no,
    input.issue_key,
    input.issue_url,
    input.summary,
    input.created_by || null
  );
  return db.prepare(`SELECT * FROM jira_issues WHERE id = ?`).get(Number(res.lastInsertRowid)) as JiraIssueRecord;
}

export function listIssuesForJob(jobId: string): JiraIssueRecord[] {
  return db.prepare(`SELECT * FROM jira_issues WHERE job_id = ? ORDER BY id ASC`).all(jobId) as JiraIssueRecord[];
}

// ============== Atlassian REST API v3 ==============

export interface CreateIssueInput {
  settings: JiraSettings;
  projectKey?: string;
  issueType?: string;
  summary: string;
  description: string;  // plain markdown — ADF 로 변환
  epicKey?: string | null;
  labels?: string[];
  priority?: string;  // "Highest" / "High" / "Medium" / "Low" / "Lowest"
}

// markdown 본문을 단순 ADF (Atlassian Document Format) 로 변환
// 줄별로 paragraph 또는 heading. 풍부한 ADF 는 외부 변환기 권장.
function toAdf(markdown: string) {
  const lines = markdown.split("\n");
  const content: any[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let h: number | null = null;
    if (line.startsWith("### ")) h = 3;
    else if (line.startsWith("## ")) h = 2;
    else if (line.startsWith("# ")) h = 1;
    if (h) {
      content.push({
        type: "heading",
        attrs: { level: h },
        content: [{ type: "text", text: line.slice(h + 1) }],
      });
    } else if (/^[-*] /.test(line)) {
      content.push({
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: line.slice(2) }] }],
        }],
      });
    } else {
      content.push({ type: "paragraph", content: [{ type: "text", text: line }] });
    }
  }
  return { type: "doc", version: 1, content };
}

export async function createJiraIssue(input: CreateIssueInput): Promise<{ key: string; url: string }> {
  const { settings, summary, description, epicKey, labels, priority } = input;
  const projectKey = (input.projectKey || settings.default_project_key).toUpperCase();
  const issueType = input.issueType || settings.default_issue_type || "Bug";
  const url = `https://${settings.host}/rest/api/3/issue`;
  const auth = Buffer.from(`${settings.email}:${settings.api_token}`).toString("base64");

  const fields: any = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    summary,
    description: toAdf(description),
  };
  if (labels && labels.length > 0) fields.labels = labels;
  if (priority) fields.priority = { name: priority };
  // Epic Link: Cloud 에서는 보통 parent 로 연결 (next-gen). 만약 안 되면 customfield 필요.
  if (epicKey) {
    fields.parent = { key: epicKey.toUpperCase() };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jira API ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text);
  return {
    key: json.key,
    url: `https://${settings.host}/browse/${json.key}`,
  };
}

// 연결 테스트 (myself 엔드포인트)
export async function testJiraConnection(settings: { host: string; email: string; api_token: string }): Promise<{ ok: true; account: string } | { ok: false; error: string }> {
  const host = settings.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const auth = Buffer.from(`${settings.email}:${settings.api_token}`).toString("base64");
  try {
    const res = await fetch(`https://${host}/rest/api/3/myself`, {
      headers: { "Authorization": `Basic ${auth}`, "Accept": "application/json" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    return { ok: true, account: json.displayName || json.emailAddress };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
