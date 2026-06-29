import { NextRequest } from "next/server";
import { mark1pDeliveredBatch, type OnePDeliveryStatus } from "@/lib/test-data-1p-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { parentOrderNos?: (string | number)[]; parentOrderNosText?: string; status?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  let parentOrderNos: (string | number)[] = body.parentOrderNos ?? [];
  if (body.parentOrderNosText) {
    parentOrderNos = body.parentOrderNosText.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  if (parentOrderNos.length === 0) {
    return new Response(JSON.stringify({ error: "대표주문번호 최소 1개 필수" }), { status: 400 });
  }
  if (parentOrderNos.length > 100) {
    return new Response(JSON.stringify({ error: "한 번에 최대 100건까지" }), { status: 400 });
  }
  const status: OnePDeliveryStatus = body.status === "DELIVERING" ? "DELIVERING" : "DELIVERED";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const results = await mark1pDeliveredBatch(parentOrderNos, status, (e) => send({ kind: "progress", event: e }));
        const okCount = results.filter((r) => r.ok).length;
        send({ kind: "done", okCount, total: results.length, results });
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
