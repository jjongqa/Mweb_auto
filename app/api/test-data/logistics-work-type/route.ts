import { NextRequest } from "next/server";
import { runWorkTypeBatch, type WorkTypeRunInput } from "@/lib/test-data-logistics-work-type";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<WorkTypeRunInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.adminId || !body.adminPw) return new Response(JSON.stringify({ error: "어드민 ID/PW 필수" }), { status: 400 });
  if (!body.workDate) return new Response(JSON.stringify({ error: "근무일자 필수" }), { status: 400 });

  const input: WorkTypeRunInput = {
    adminId: body.adminId, adminPw: body.adminPw,
    scope: body.scope === "all" ? "all" : "workOk",
    workDate: body.workDate,
    includeStart: body.includeStart !== false,
    includeEnd: body.includeEnd !== false,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const { okCount, total, results, error } = await runWorkTypeBatch(input, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", okCount, total, results, error });
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
