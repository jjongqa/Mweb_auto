import { NextRequest } from "next/server";
import { verifyAccounts } from "@/lib/test-data-logistics-work-type";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 모바일 vs 어드민 교차 검증 (SSE)
export async function POST(req: NextRequest) {
  let body: { adminId?: string; adminPw?: string; usernames?: string[]; month?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.adminId || !body.adminPw) return new Response(JSON.stringify({ error: "어드민 ID/PW 필수" }), { status: 400 });
  if (!Array.isArray(body.usernames) || !body.usernames.length) return new Response(JSON.stringify({ error: "계정 최소 1개 필수" }), { status: 400 });
  if (!body.month) return new Response(JSON.stringify({ error: "조회 월(YYYY-MM) 필수" }), { status: 400 });
  const usernames = body.usernames.slice(0, 100);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const { ok, rows, passed, total, error } = await verifyAccounts(body.adminId!, body.adminPw!, usernames, body.month!, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", ok, rows, passed, total, error });
      } catch (err) {
        send({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
