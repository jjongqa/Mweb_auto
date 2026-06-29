import { NextRequest } from "next/server";
import { publishPointsBatch, type PointPublishInput } from "@/lib/test-data-point";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<PointPublishInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.memberNumber) return new Response(JSON.stringify({ error: "memberNumber 필수" }), { status: 400 });
  if (!body.point || Number(body.point) <= 0) return new Response(JSON.stringify({ error: "point 필수 (1 이상)" }), { status: 400 });

  const input: PointPublishInput = {
    memberNumber: body.memberNumber,
    point: Number(body.point),
    count: Math.max(1, Math.min(100, (body.count ?? 1) | 0 || 1)),
    expireDateTime: body.expireDateTime,
    memo: body.memo,
    detail: body.detail,
    actionMemberNumber: body.actionMemberNumber,
    historyType: body.historyType,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const results = await publishPointsBatch(input, (e) => send({ kind: "progress", event: e }));
        const okCount = results.filter((r) => r.ok).length;
        const totalCharge = results.filter((r) => r.ok).reduce((s, r) => s + (r.charge ?? 0), 0);
        send({ kind: "done", okCount, total: results.length, totalCharge, results });
      } catch (err) {
        send({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
