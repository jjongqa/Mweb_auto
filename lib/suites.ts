// F7 회귀 스위트 — 잡 설정(파일 + 도메인/플랫폼/환경/모델/워커/필터)을 이름으로 저장 → "지금 실행".
// cron 자동화는 범위 밖 (단독 도구). 저장 + 수동 재실행만.

import { db } from "./db";
import { getJob, createJob, type TcFilter } from "./jobs";
import type { Job, Platform, RunMode } from "./db";

export interface Suite {
  id: number;
  name: string;
  domain: string;
  platform: Platform;
  qa_env: string;
  mode: RunMode;
  tc_paths: string;        // JSON array (절대경로)
  tc_filenames: string;    // JSON array (표시명)
  claude_model: string | null;
  worker_name: string | null;
  tc_filter: string | null;
  additional_instructions: string | null;
  note: string | null;
  created_at: string;
  last_run_at: string | null;
  run_count: number;
}

export function listSuites(): Suite[] {
  return db.prepare(`SELECT * FROM regression_suites ORDER BY last_run_at DESC NULLS LAST, id DESC`).all() as Suite[];
}

export function getSuite(id: number): Suite | null {
  return (db.prepare(`SELECT * FROM regression_suites WHERE id=?`).get(id) as Suite) ?? null;
}

// 기존 잡을 스위트로 저장 — 잡의 파일/설정을 그대로 복사
export function createSuiteFromJob(jobId: string, name: string, note?: string | null): Suite {
  const job = getJob(jobId);
  if (!job) throw new Error(`잡 없음: ${jobId}`);

  // 다중 TC 파일 우선, 없으면 단일
  let paths: string[] = [];
  let names: string[] = [];
  try { if (job.tc_paths) paths = JSON.parse(job.tc_paths); } catch { /* ignore */ }
  try { if (job.tc_filenames) names = JSON.parse(job.tc_filenames); } catch { /* ignore */ }
  if (paths.length === 0) paths = [job.tc_path];
  if (names.length === 0) names = [job.tc_filename];

  const res = db.prepare(`
    INSERT INTO regression_suites
      (name, domain, platform, qa_env, mode, tc_paths, tc_filenames, claude_model, worker_name, tc_filter, additional_instructions, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    job.domain,
    job.platform,
    job.qa_env,
    job.mode,
    JSON.stringify(paths),
    JSON.stringify(names),
    job.claude_model,
    job.worker_name,
    job.tc_filter,
    job.additional_instructions,
    note?.trim() || null
  );
  return getSuite(Number(res.lastInsertRowid))!;
}

export function deleteSuite(id: number): boolean {
  return db.prepare(`DELETE FROM regression_suites WHERE id=?`).run(id).changes > 0;
}

// 스위트를 새 잡으로 실행
export function runSuite(id: number, requestedBy?: string | null): Job {
  const suite = getSuite(id);
  if (!suite) throw new Error(`스위트 없음: ${id}`);

  let paths: string[] = [];
  let names: string[] = [];
  try { paths = JSON.parse(suite.tc_paths); } catch { /* ignore */ }
  try { names = JSON.parse(suite.tc_filenames); } catch { /* ignore */ }
  if (paths.length === 0) throw new Error("스위트에 TC 파일 경로가 없습니다");

  let tcFilter: TcFilter | null = null;
  try { if (suite.tc_filter) tcFilter = JSON.parse(suite.tc_filter); } catch { /* ignore */ }

  const job = createJob({
    domain: suite.domain,
    platform: suite.platform,
    qa_env: suite.qa_env,
    task_name: `[스위트] ${suite.name}`,
    epic_key: null,
    tc_filename: names[0] ?? paths[0],
    tc_path: paths[0],
    requested_by: requestedBy ?? null,
    mode: suite.mode,
    tc_filter: tcFilter,
    additional_instructions: suite.additional_instructions,
    worker_name: suite.worker_name,
    tc_paths: paths.length > 1 ? paths : null,
    tc_filenames: names.length > 1 ? names : null,
    claude_model: suite.claude_model,
  });

  db.prepare(`UPDATE regression_suites SET last_run_at=datetime('now'), run_count=run_count+1 WHERE id=?`).run(id);
  return job;
}
