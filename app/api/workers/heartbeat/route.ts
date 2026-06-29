import { NextRequest } from "next/server";
import { updateWorkerHeartbeat } from "@/lib/workers";

export const dynamic = "force-dynamic";

/**
 * POST /api/workers/heartbeat
 *
 * 워커가 30초마다 호출. "나 살아있어요".
 *
 * Body: { name: "jiho-mac", status?: "online" | "busy" }
 */
export async function POST(req: NextRequest) {
  try {
    const { name, status, active_jobs, max_concurrent, version } = await req.json();
    if (!name) return Response.json({ error: "name 필수" }, { status: 400 });

    const meta: { active_jobs?: number; max_concurrent?: number; version?: string | null } = {};
    if (typeof active_jobs === "number") meta.active_jobs = Math.max(0, active_jobs | 0);
    if (typeof max_concurrent === "number") meta.max_concurrent = Math.max(1, max_concurrent | 0);
    if (typeof version === "string" && version.trim()) meta.version = version.trim().slice(0, 20);
    const ok = updateWorkerHeartbeat(String(name).trim(), status, meta);
    if (!ok) {
      // 워커가 등록 안 된 상태 → 워커가 알아서 재등록 시도하도록 안내
      return Response.json({ error: "워커 등록 안 됨. 먼저 /api/workers/register 호출", needsReregister: true }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
