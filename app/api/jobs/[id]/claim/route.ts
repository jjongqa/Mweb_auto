import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/claim
 *
 * 워커가 *내가 가져갈게* 마킹. pending → running 으로 트랜잭션 변경.
 * 이미 다른 워커가 가져갔으면 409.
 *
 * Body: { worker: "jiho-mac" }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { worker } = await req.json().catch(() => ({}));
  if (!worker) return Response.json({ error: "worker 필수" }, { status: 400 });

  const tx = db.transaction(() => {
    const job = db.prepare(`SELECT id, status, worker_name FROM jobs WHERE id=?`).get(id) as
      | { id: string; status: string; worker_name: string | null }
      | undefined;
    if (!job) return { ok: false, code: 404, error: "Job 없음" };
    if (job.status !== "pending") {
      return { ok: false, code: 409, error: `이미 ${job.status} 상태` };
    }
    if (job.worker_name && job.worker_name !== worker) {
      return { ok: false, code: 403, error: `이 Job 은 ${job.worker_name} 전용` };
    }
    const result = db.prepare(`
      UPDATE jobs
      SET status='running',
          worker_name=?,
          assigned_at=datetime('now'),
          started_at=datetime('now'),
          updated_at=datetime('now')
      WHERE id=? AND status='pending'
    `).run(worker, id);
    // SELECT 와 UPDATE 사이에 다른 워커가 먼저 claim 했을 경우 changes=0
    if (result.changes === 0) {
      return { ok: false, code: 409, error: "이미 다른 워커가 claim 한 job" };
    }
    return { ok: true };
  });

  const result = tx();
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.code });
  }
  return Response.json({ ok: true });
}
