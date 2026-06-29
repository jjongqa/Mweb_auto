import { NextRequest } from "next/server";
import { runWorkVerify, type WorkVerifyInput } from "@/lib/test-data-logistics-work-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<WorkVerifyInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.adminId || !body.adminPw) return new Response(JSON.stringify({ error: "어드민 ID/PW 필수" }), { status: 400 });
  if (!body.cluster) return new Response(JSON.stringify({ error: "클러스터 필수" }), { status: 400 });
  if (!body.startDate || !body.endDate) return new Response(JSON.stringify({ error: "조회 기간 필수" }), { status: 400 });

  const input: WorkVerifyInput = {
    adminId: body.adminId, adminPw: body.adminPw, cluster: body.cluster,
    center: body.center || undefined, workPart: body.workPart || undefined,
    startDate: body.startDate, endDate: body.endDate, workTypes: body.workTypes,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runWorkVerify(input, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", result });
      } catch (err) {
        send({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" },
  });
}
