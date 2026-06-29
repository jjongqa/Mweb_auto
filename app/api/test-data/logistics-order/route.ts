import { NextRequest } from "next/server";
import { runOrderBatch, type OrderRunInput } from "@/lib/test-data-logistics-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<OrderRunInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.userId || !body.userPw) return new Response(JSON.stringify({ error: "컬리 계정 ID/PW 필수" }), { status: 400 });
  if (!body.center) return new Response(JSON.stringify({ error: "센터 필수" }), { status: 400 });
  if (!Array.isArray(body.regions) || !body.regions.length) return new Response(JSON.stringify({ error: "권역 최소 1개 필수" }), { status: 400 });

  const z = (v: any) => ({ mode: v?.mode ?? "미선택", cnt: Number(v?.cnt) || 0, qty: Math.max(1, Number(v?.qty) || 1) });
  const input: OrderRunInput = {
    userId: body.userId, userPw: body.userPw,
    cool: z(body.cool), froz: z(body.froz), room: z(body.room),
    center: body.center, regions: body.regions,
    addrMode: body.addrMode === "A" ? "A" : "R",
    repeatCnt: Math.max(1, Number(body.repeatCnt) || 1),
    omsTransfer: !!body.omsTransfer,
    publishTms: !!body.publishTms,
  };

  if (input.cool.mode === "미선택" && input.froz.mode === "미선택" && input.room.mode === "미선택") {
    return new Response(JSON.stringify({ error: "최소 1개 온도대 상품 구성 필요" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const { okCount, total, results } = await runOrderBatch(input, (e) => send({ kind: "progress", event: e }));
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
