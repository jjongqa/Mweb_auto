import { NextRequest } from "next/server";
import { runKurlyworksSetup, type KurlyworksInput } from "@/lib/test-data-logistics-kurlyworks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: Partial<KurlyworksInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (body.runWorks && (!body.worksId || !body.worksPw)) return new Response(JSON.stringify({ error: "컬리웍스 ID/PW 필수" }), { status: 400 });
  if (body.runKurlyro && (!body.roId || !body.roPw)) return new Response(JSON.stringify({ error: "컬리로 ID/PW 필수" }), { status: 400 });
  if (!body.runWorks && !body.runKurlyro) return new Response(JSON.stringify({ error: "최소 1개 플로우 선택" }), { status: 400 });

  const input: KurlyworksInput = {
    worksId: body.worksId || "", worksPw: body.worksPw || "",
    roId: body.roId || "", roPw: body.roPw || "",
    cc: body.cc || "김포 CC", center: body.center || "김포상온", part: body.part || "IB",
    startHour: body.startHour, endHour: body.endHour,
    headless: body.headless !== false,
    runWorks: !!body.runWorks, runKurlyro: !!body.runKurlyro,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runKurlyworksSetup(input, (e) => send({ kind: "progress", event: e }));
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
