import { NextRequest } from "next/server";
import { publishTmsBatch } from "@/lib/test-data-logistics-tms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 기존 주문번호(대표주문번호)들에 대해 Kafka TMS 발행(운송장 생성)만 수행.
export async function POST(req: NextRequest) {
  let body: { orderCodes?: string[]; orderCodesText?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  let codes: string[] = Array.isArray(body.orderCodes) ? body.orderCodes : [];
  if (body.orderCodesText) codes = body.orderCodesText.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
  codes = codes.map((c) => String(c).trim()).filter(Boolean);
  if (!codes.length) return new Response(JSON.stringify({ error: "주문번호 최소 1개 필수" }), { status: 400 });
  if (codes.length > 100) return new Response(JSON.stringify({ error: "한 번에 최대 100건" }), { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const { okCount, total, results } = await publishTmsBatch(codes, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", okCount, total, results });
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
