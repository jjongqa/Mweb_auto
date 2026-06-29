import { randomUUID } from "node:crypto";
import { db } from "./db";

export type DataRequestStatus = "pending" | "running" | "ready" | "blocked" | "failed";
const FINISHED_JOB_STATUSES = ["succeeded", "failed", "canceled"] as const;

export interface DataRequest {
  id: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  status: DataRequestStatus;
  source_job_id: string | null;
  source_agent: string | null;
  tc_ref: string | null;
  need: string;
  reason: string | null;
  inputs: string | null;
  preferred_tool: string | null;
  claimed_by: string | null;
  result_context: string | null;
  verification: string | null;
  notes: string | null;
  error_message: string | null;
  raw_output: string | null;
}

export function createDataRequest(input: {
  sourceJobId?: string | null;
  sourceAgent?: string | null;
  tcRef?: string | null;
  need: string;
  reason?: string | null;
  inputs?: unknown;
  preferredTool?: string | null;
}): DataRequest {
  const id = `dr_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const inputs = typeof input.inputs === "string" ? input.inputs : JSON.stringify(input.inputs ?? {});
  db.prepare(
    `INSERT INTO data_requests
      (id, source_job_id, source_agent, tc_ref, need, reason, inputs, preferred_tool)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sourceJobId || null,
    input.sourceAgent || null,
    input.tcRef || null,
    input.need.trim(),
    input.reason || null,
    inputs,
    input.preferredTool || null
  );
  return getDataRequest(id)!;
}

export function getDataRequest(id: string): DataRequest | null {
  return db.prepare(`SELECT * FROM data_requests WHERE id=?`).get(id) as DataRequest | undefined ?? null;
}

export function listDataRequests(opts: { sourceJobId?: string | null; limit?: number } = {}): DataRequest[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (opts.sourceJobId) {
    return db.prepare(
      `SELECT * FROM data_requests WHERE source_job_id=? ORDER BY created_at DESC LIMIT ?`
    ).all(opts.sourceJobId, limit) as DataRequest[];
  }
  return db.prepare(`SELECT * FROM data_requests ORDER BY created_at DESC LIMIT ?`).all(limit) as DataRequest[];
}

export function claimNextDataRequest(worker: string): DataRequest | null {
  return db.transaction(() => {
    closeDataRequestsForFinishedJobs();
    db.prepare(
      `UPDATE data_requests
       SET status='pending', claimed_by=NULL, claimed_at=NULL, updated_at=datetime('now'),
           error_message=COALESCE(error_message, 'stale running request reclaimed')
       WHERE status='running'
         AND datetime(updated_at) < datetime('now', '-20 minutes')
         AND (
           source_job_id IS NULL
           OR source_job_id NOT IN (SELECT id FROM jobs WHERE status IN (${FINISHED_JOB_STATUSES.map(() => "?").join(",")}))
         )`
    ).run(...FINISHED_JOB_STATUSES);
    const running = db.prepare(
      `SELECT id
       FROM data_requests
       WHERE status='running'
       ORDER BY claimed_at ASC
       LIMIT 1`
    ).get() as
      | { id: string }
      | undefined;
    if (running) return null;
    const row = db.prepare(
      `SELECT dr.id
       FROM data_requests dr
       LEFT JOIN jobs j ON j.id = dr.source_job_id
       WHERE dr.status='pending'
         AND (dr.source_job_id IS NULL OR j.id IS NULL OR j.status NOT IN (${FINISHED_JOB_STATUSES.map(() => "?").join(",")}))
       ORDER BY dr.created_at ASC
       LIMIT 1`
    ).get(...FINISHED_JOB_STATUSES) as { id: string } | undefined;
    if (!row) return null;
    db.prepare(
      `UPDATE data_requests
       SET status='running', claimed_by=?, claimed_at=datetime('now'), updated_at=datetime('now')
       WHERE id=? AND status='pending'`
    ).run(worker, row.id);
    return getDataRequest(row.id);
  })();
}

export function closeDataRequestsForFinishedJobs(): number {
  const r = db.prepare(
    `UPDATE data_requests
     SET status='blocked',
         finished_at=datetime('now'),
         updated_at=datetime('now'),
         error_message=COALESCE(error_message, 'source job already finished'),
         notes=COALESCE(notes, '원 수행 잡이 종료되어 이 데이터 요청은 더 이상 사용되지 않습니다.')
     WHERE status IN ('pending', 'running')
       AND source_job_id IN (SELECT id FROM jobs WHERE status IN (${FINISHED_JOB_STATUSES.map(() => "?").join(",")}))`
  ).run(...FINISHED_JOB_STATUSES);
  return r.changes;
}

export function closeDataRequestsForJob(sourceJobId: string, reason = "source job finished"): number {
  const r = db.prepare(
    `UPDATE data_requests
     SET status='blocked',
         finished_at=datetime('now'),
         updated_at=datetime('now'),
         error_message=?,
         notes=COALESCE(notes, '원 수행 잡이 종료되어 이 데이터 요청은 더 이상 사용되지 않습니다.')
     WHERE source_job_id=?
       AND status IN ('pending', 'running')`
  ).run(reason, sourceJobId);
  return r.changes;
}

export function completeDataRequest(
  id: string,
  input: {
    status: Exclude<DataRequestStatus, "pending" | "running">;
    resultContext?: unknown;
    verification?: string | null;
    notes?: string | null;
    errorMessage?: string | null;
    rawOutput?: string | null;
  }
): DataRequest | null {
  const resultContext = typeof input.resultContext === "string"
    ? input.resultContext
    : JSON.stringify(input.resultContext ?? {});
  db.prepare(
    `UPDATE data_requests
     SET status=?, result_context=?, verification=?, notes=?, error_message=?, raw_output=?,
         finished_at=datetime('now'), updated_at=datetime('now')
     WHERE id=? AND status='running'`
  ).run(
    input.status,
    resultContext,
    input.verification || null,
    input.notes || null,
    input.errorMessage || null,
    input.rawOutput || null,
    id
  );
  return getDataRequest(id);
}

function parseInputs(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function resumeDataRequest(
  id: string,
  extraInputs: Record<string, unknown>,
  note = "사용자 입력값을 반영해 데이터 요청을 재시도합니다."
): DataRequest | null {
  const row = getDataRequest(id);
  if (!row) return null;
  if (!["blocked", "failed"].includes(row.status)) return row;

  const mergedInputs = {
    ...parseInputs(row.inputs),
    ...extraInputs,
    resumedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE data_requests
     SET status='pending',
         inputs=?,
         claimed_by=NULL,
         claimed_at=NULL,
         finished_at=NULL,
         result_context=NULL,
         verification=NULL,
         notes=?,
         error_message=NULL,
         raw_output=NULL,
         updated_at=datetime('now')
     WHERE id=? AND status IN ('blocked', 'failed')`
  ).run(JSON.stringify(mergedInputs), note, id);

  return getDataRequest(id);
}
