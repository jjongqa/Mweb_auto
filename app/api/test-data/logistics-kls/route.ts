import { NextRequest } from "next/server";
import { runKlsBatch, type KlsRunInput } from "@/lib/test-data-logistics-kls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<KlsRunInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.center) return new Response(JSON.stringify({ error: "센터 필수" }), { status: 400 });
  if (!Array.isArray(body.regions) || !body.regions.length) return new Response(JSON.stringify({ error: "권역 최소 1개 필수" }), { status: 400 });
  if (!body.channelCode) return new Response(JSON.stringify({ error: "판매처 코드 필수" }), { status: 400 });

  const z = (v: any) => ({ on: !!v?.on, cnt: Number(v?.cnt) || 0, qty: Math.max(1, Number(v?.qty) || 1) });
  const input: KlsRunInput = {
    cool: z(body.cool), froz: z(body.froz), room: z(body.room),
    center: body.center, regions: body.regions,
    addrMode: body.addrMode === "A" ? "A" : "R",
    repeatCnt: Math.max(1, Number(body.repeatCnt) || 1),
    ownerCode: body.ownerCode || "CU000294",
    channelCode: body.channelCode,
  };
  if (!input.cool.on && !input.froz.on && !input.room.on) {
    return new Response(JSON.stringify({ error: "최소 1개 온도대 선택 필요" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const { okCount, total, results, deliveryDate } = await runKlsBatch(input, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", okCount, total, results, deliveryDate });
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
