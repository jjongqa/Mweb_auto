import { db, type Job, type JobLog, type JobStatus, type Domain, type Platform, type RunMode } from "./db";
import { randomUUID } from "node:crypto";

export interface TcFilter {
  priority?: "P1" | "P1+P2" | "all";
  range?: [number, number]; // 1-based inclusive
}

export function createJob(input: {
  domain: Domain;
  platform: Platform;
  qa_env: string;
  task_name: string | null;
  epic_key: string | null;
  tc_filename: string;
  tc_path: string;
  requested_by: string | null;
  mode: RunMode;
  tc_filter?: TcFilter | null;
  analyzer_summary?: string | null;
  additional_instructions?: string | null;
  parent_job_id?: string | null;
  retry_type?: "FAIL" | "BLOCKED" | "continue" | "extend" | null;
  worker_name?: string | null;
  spec_url?: string | null;
  spec_filename?: string | null;
  spec_text?: string | null;
  // v1.2 다중 TC 파일 (옵션). 지정되면 tc_path/tc_filename은 첫 항목으로 자동 채워짐
  tc_paths?: string[] | null;
  tc_filenames?: string[] | null;
  // v1.3 애드혹 테스트
  job_type?: "full" | "adhoc";
  adhoc_focus?: string | null;
  // v1.7.5 잡별 모델 — null/undefined 면 워커 default
  claude_model?: string | null;
  // 기능테스트 inline 컨텍스트(admin이 Drive 동기화 기반 조립) — 워커가 로컬 파일 대신 사용
  inlined_context?: string | null;
  // Phase 2 멀티 분할 수행 — 청크 잡 식별
  chunk_group_id?: string | null;
  chunk_index?: number | null;
  chunk_total?: number | null;
}): Job {
  const id = `job_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  // worker_name 이 있으면 assigned_at 도 같이 기록
  const assignedAt = input.worker_name ? new Date().toISOString().replace("T", " ").slice(0, 19) : null;
  db.prepare(
    `INSERT INTO jobs (id, status, domain, platform, qa_env, task_name, env, epic_key, tc_filename, tc_path, requested_by, mode, tc_filter, analyzer_summary, additional_instructions, parent_job_id, retry_type, worker_name, assigned_at, spec_url, spec_filename, spec_text, tc_paths, tc_filenames, job_type, adhoc_focus, claude_model, inlined_context, chunk_group_id, chunk_index, chunk_total)
     VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.domain,
    input.platform,
    input.qa_env,
    input.task_name,
    input.qa_env,
    input.epic_key,
    input.tc_filename,
    input.tc_path,
    input.requested_by,
    input.mode,
    input.tc_filter ? JSON.stringify(input.tc_filter) : null,
    input.analyzer_summary,
    input.additional_instructions || null,
    input.parent_job_id || null,
    input.retry_type || null,
    input.worker_name || null,
    assignedAt,
    input.spec_url || null,
    input.spec_filename || null,
    input.spec_text || null,
    input.tc_paths && input.tc_paths.length > 1 ? JSON.stringify(input.tc_paths) : null,
    input.tc_filenames && input.tc_filenames.length > 1 ? JSON.stringify(input.tc_filenames) : null,
    input.job_type || "full",
    input.adhoc_focus || null,
    input.claude_model || null,
    input.inlined_context || null,
    input.chunk_group_id || null,
    input.chunk_index ?? null,
    input.chunk_total ?? null
  );
  return getJob(id)!;
}

export function getJob(id: string): Job | null {
  return (db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as Job) ?? null;
}

// history/dashboard 에서 호출. spec_text/generated_prompt/postman_*_json 같은
// 큰 컬럼은 일람용 행에 필요 없어서 NULL 로 마스킹. 200 rows × 1MB 응답 방지.
export function listJobs(limit = 50): Job[] {
  return db
    .prepare(`
      SELECT id, created_at, updated_at, started_at, finished_at, status,
             domain, platform, qa_env, task_name, env, epic_key, tc_filename,
             tc_path, result_dir, total, passed, failed, blocked, current_index,
             error_message, requested_by, mode, cancel_requested, tc_filter,
             analyzer_summary, additional_instructions,
             parent_job_id, retry_type, worker_name, assigned_at,
             spec_url, spec_filename, NULL AS spec_text,
             tc_paths, tc_filenames, job_type, adhoc_focus, claude_model,
             duration_sec, chunk_group_id, chunk_index, chunk_total,
             NULL AS generated_prompt
      FROM jobs ORDER BY created_at DESC LIMIT ?
    `)
    .all(limit) as Job[];
}

// v0.4b: 특정 Job 의 모든 재실행 자식 (계층적 — 자식의 자식까지)
export function getRetryDescendants(parentJobId: string): Job[] {
  const all: Job[] = [];
  const queue = [parentJobId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const children = db
      .prepare(`SELECT * FROM jobs WHERE parent_job_id = ? ORDER BY created_at ASC`)
      .all(pid) as Job[];
    for (const c of children) {
      all.push(c);
      queue.push(c.id);
    }
  }
  return all;
}

// Phase 2: 같은 chunk_group_id 의 모든 청크 잡 (chunk_index 순). 단일 수행이면 빈 배열.
export function getChunkSiblings(groupId: string): Job[] {
  if (!groupId) return [];
  return db
    .prepare(`SELECT * FROM jobs WHERE chunk_group_id = ? ORDER BY chunk_index ASC, created_at ASC`)
    .all(groupId) as Job[];
}

// v0.4b: 원본 Job 의 최상위 부모를 찾음 (체인의 루트)
export function getRootJob(jobId: string): Job | null {
  let current = getJob(jobId);
  while (current && current.parent_job_id) {
    const parent = getJob(current.parent_job_id);
    if (!parent) break;
    current = parent;
  }
  return current;
}

// v0.4b: 누적 결과 계산 (원본 + 모든 재실행의 결과를 합쳐서)
// 재실행은 *부분 집합* 을 다시 돌린 거니까 단순 더하기가 아님.
// 정책: 재실행 결과로 *덮어쓰기* 되는 케이스만 갱신. No 기준.
// 단순화: 원본 결과에서 시작 → 재실행 자식들의 결과를 *대체*
//   - 자식이 PASS 한 No 는 원본의 FAIL/BLOCKED 에서 빼고 PASS 로
//   - 자식이 여전히 FAIL/BLOCKED 면 그대로
//
// 구현 단순화: summary.csv 를 모두 파싱해야 정확. 지금은 카운트 기반 근사 추정.
export function computeCumulativeResult(rootJob: Job): {
  passed: number;
  failed: number;
  blocked: number;
  total: number;
  retryCount: number;
} {
  const descendants = getRetryDescendants(rootJob.id);
  // 시작점: 원본 결과
  let passed = rootJob.passed;
  let failed = rootJob.failed;
  let blocked = rootJob.blocked;

  // 각 재실행 자식의 결과를 누적
  // 재실행 자식의 total = 원본에서 빼온 케이스 수 (FAIL/BLOCKED)
  for (const child of descendants) {
    if (child.status !== "succeeded" && child.status !== "failed") continue;
    if (child.retry_type === "FAIL") {
      // 원본에서 FAIL 처리됐던 케이스들을 다시 돌린 결과
      // child.total 만큼이 원본 FAIL 에서 *빠지고*, 그 자리에 child.passed/failed/blocked 가 들어감
      failed -= child.total;
      passed += child.passed;
      failed += child.failed;
      blocked += child.blocked;
    } else if (child.retry_type === "BLOCKED") {
      blocked -= child.total;
      passed += child.passed;
      failed += child.failed;
      blocked += child.blocked;
    }
  }

  // 음수 방어 (재실행 후 카운트가 어긋날 가능성)
  passed = Math.max(0, passed);
  failed = Math.max(0, failed);
  blocked = Math.max(0, blocked);

  return {
    passed,
    failed,
    blocked,
    total: rootJob.total,
    retryCount: descendants.length,
  };
}

// ============== F5 Flaky TC 탐지 ==============
// 한 재실행 체인(root + 모든 후손) 안에서 같은 tc_no 가 PASS 와 (FAIL|BLOCKED) 를
// 모두 가지면 flaky 로 판정. tc_execution_runs 적재가 전제.
export interface FlakyTc {
  tc_no: string;
  runs: { job_id: string; result: string }[];
}
export function findFlakyTcs(rootJobId: string): FlakyTc[] {
  const ids = [rootJobId, ...getRetryDescendants(rootJobId).map((d) => d.id)];
  if (ids.length < 2) return []; // 재실행 없으면 한 TC 가 한 번만 → flip 불가
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT job_id, tc_no, result FROM tc_execution_runs WHERE job_id IN (${placeholders}) ORDER BY id ASC`)
    .all(...ids) as { job_id: string; tc_no: string; result: string }[];
  const byTc = new Map<string, { job_id: string; result: string }[]>();
  for (const r of rows) {
    const arr = byTc.get(r.tc_no) ?? [];
    arr.push({ job_id: r.job_id, result: r.result });
    byTc.set(r.tc_no, arr);
  }
  const flaky: FlakyTc[] = [];
  for (const [tc_no, runs] of byTc) {
    const hasPass = runs.some((r) => r.result === "PASS");
    const hasFail = runs.some((r) => r.result === "FAIL" || r.result === "BLOCKED");
    if (hasPass && hasFail) flaky.push({ tc_no, runs });
  }
  return flaky.sort((a, b) => a.tc_no.localeCompare(b.tc_no, undefined, { numeric: true }));
}

// 도메인별 TC 1건당 평균 실행시간(초) — REAL 완료 잡의 실측(duration_sec/total) 평균.
// 업로드 폼의 예상 시간 추정에 사용. 이력 없으면 빈 객체 → 폼이 기본값(45s) fallback.
export function avgSecPerTcByDomain(): Record<string, number> {
  const rows = db
    .prepare(`
      SELECT domain, AVG(CAST(duration_sec AS REAL) / total) AS avg_per_tc
      FROM jobs
      WHERE mode='real' AND status IN ('succeeded','failed')
        AND duration_sec IS NOT NULL AND duration_sec > 0 AND total > 0
      GROUP BY domain
    `)
    .all() as { domain: string; avg_per_tc: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) if (r.avg_per_tc > 0) out[r.domain] = Math.round(r.avg_per_tc);
  return out;
}

export function countByStatus(): Record<JobStatus, number> {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`)
    .all() as { status: JobStatus; n: number }[];
  const out: Record<string, number> = { pending: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out as Record<JobStatus, number>;
}

export function claimNextPending(): Job | null {
  const tx = db.transaction(() => {
    const job = db
      .prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`)
      .get() as Job | undefined;
    if (!job) return null;
    db.prepare(
      `UPDATE jobs SET status='running', started_at=datetime('now'), updated_at=datetime('now') WHERE id = ? AND status='pending'`
    ).run(job.id);
    return getJob(job.id);
  });
  return tx();
}

export function updateJob(
  id: string,
  patch: Partial<
    Pick<
      Job,
      | "status"
      | "result_dir"
      | "total"
      | "passed"
      | "failed"
      | "blocked"
      | "current_index"
      | "error_message"
      | "generated_prompt"
      | "cancel_requested"
    >
  >
) {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const set = fields.map((k) => `${k} = ?`).join(", ");
  const values = fields.map((k) => (patch as Record<string, unknown>)[k]);
  db.prepare(`UPDATE jobs SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(
    ...values,
    id
  );
}

export function addLog(jobId: string, level: string, message: string) {
  db.prepare(`INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)`).run(
    jobId,
    level,
    message
  );
}

export function getLogs(jobId: string, sinceId = 0, limit = 500): JobLog[] {
  return db
    .prepare(
      `SELECT * FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id ASC LIMIT ?`
    )
    .all(jobId, sinceId, limit) as JobLog[];
}

export function setStatus(id: string, status: JobStatus, errorMessage?: string) {
  const finished = ["succeeded", "failed", "canceled"].includes(status);
  if (finished) {
    db.prepare(
      `UPDATE jobs SET status=?, error_message=?, finished_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    ).run(status, errorMessage ?? null, id);
  } else {
    db.prepare(
      `UPDATE jobs SET status=?, error_message=?, updated_at=datetime('now') WHERE id=?`
    ).run(status, errorMessage ?? null, id);
  }
}

export function requestCancel(id: string) {
  db.prepare(`UPDATE jobs SET cancel_requested=1, updated_at=datetime('now') WHERE id=?`).run(id);
}

// 잡 삭제 — 본인 + 모든 재실행 후손(parent_job_id 체인) cascade.
// job_logs 는 FK ON DELETE CASCADE 로 자동 정리됨.
export function deleteJob(id: string): { deletedIds: string[] } {
  const descendants = getRetryDescendants(id);
  const all = [id, ...descendants.map((d) => d.id)];
  const tx = db.transaction(() => {
    const stmt = db.prepare(`DELETE FROM jobs WHERE id = ?`);
    for (const jid of all) stmt.run(jid);
  });
  tx();
  return { deletedIds: all };
}

// 모든 잡 삭제 (실행 중/대기 중 제외 옵션). job_logs 는 cascade 로 함께 삭제.
export function deleteAllJobs(opts?: { includeActive?: boolean }): { deletedCount: number } {
  const includeActive = !!opts?.includeActive;
  const where = includeActive ? "" : "WHERE status NOT IN ('running','pending')";
  const res = db.prepare(`DELETE FROM jobs ${where}`).run();
  return { deletedCount: res.changes };
}
