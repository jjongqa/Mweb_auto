import { NextRequest } from "next/server";
import { upsertWorker } from "@/lib/workers";

export const dynamic = "force-dynamic";

/**
 * POST /api/workers/register
 *
 * 워커가 시작 시 호출. 인증 없음 (PoC 한정).
 *
 * Body:
 * {
 *   name: "jiho-mac",
 *   capabilities: { web: true, app: false }
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, capabilities } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return Response.json({ error: "워커 이름(name) 필수" }, { status: 400 });
    }

    // 클라이언트 IP
    const forwardedFor = req.headers.get("x-forwarded-for");
    const realIp = req.headers.get("x-real-ip");
    const ip = forwardedFor?.split(",")[0]?.trim() || realIp || null;

    const worker = upsertWorker({
      name: name.trim(),
      ip_address: ip,
      capabilities: capabilities || { web: true, app: false },
    });

    return Response.json({
      ok: true,
      worker: {
        name: worker.name,
        ip_address: worker.ip_address,
        status: worker.status,
        registered_at: worker.registered_at,
      },
      message: `워커 '${name}' 등록 성공`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
