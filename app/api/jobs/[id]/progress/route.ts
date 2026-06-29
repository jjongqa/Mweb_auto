import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/:id/progress
 *
 * 워커가 진행 중 진행률 / 로그 보고.
 *
 * Body:
 * {
 *   worker: "jiho-mac",
 *   total?: number,             // TC 총 개수 (감지 직후 1회)
 *   passed?: number,            // 누적
 *   failed?: number,
 *   blocked?: number,
 *   logs?: [{ level: "info"|"warn"|"error", message: string }]
 * }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { worker, total, passed, failed, blocked, logs } = body;

  if (!worker) return Response.json({ error: "worker 필수" }, { status: 400 });

  // 워커 권한 확인
  const job = db.prepare(`SELECT worker_name, status, cancel_requested FROM jobs WHERE id=?`).get(id) as
    | { worker_name: string | null; status: string; cancel_requested: number }
    | undefined;
  if (!job) return Response.json({ error: "Job 없음" }, { status: 404 });
  if (job.worker_name !== worker) {
    return Response.json({ error: "권한 없음" }, { status: 403 });
  }

  // 진행률 갱신
  const setParts: string[] = [];
  const values: any[] = [];
  if (typeof total === "number") { setParts.push("total=?"); values.push(total); }
  if (typeof passed === "number") { setParts.push("passed=?"); values.push(passed); }
  if (typeof failed === "number") { setParts.push("failed=?"); values.push(failed); }
  if (typeof blocked === "number") { setParts.push("blocked=?"); values.push(blocked); }
  if (setParts.length > 0) {
    setParts.push("updated_at=datetime('now')");
    // worker_name 가드 — 만약 claim race 로 다른 워커가 잡고 있으면 무시
    db.prepare(`UPDATE jobs SET ${setParts.join(", ")} WHERE id=? AND worker_name=?`).run(...values, id, worker);
  }

  // 로그 추가
  if (Array.isArray(logs)) {
    const insertLog = db.prepare(`INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)`);
    for (const log of logs) {
      if (log && log.message) {
        insertLog.run(id, log.level || "info", String(log.message));
      }
    }
  }

  // 캔슬 요청 상태 함께 응답 → 워커가 즉시 멈출 수 있게
  return Response.json({
    ok: true,
    cancel_requested: job.cancel_requested === 1,
  });
}
