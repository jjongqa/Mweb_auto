import { NextRequest } from "next/server";
import { capaRegister, type CapaRegisterItem, type CapaRegisterSettings } from "@/lib/test-data-logistics-po-capa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }
  if (!body.rmsId || !body.rmsPw) return new Response(JSON.stringify({ error: "RMS ID/PW 필수" }), { status: 400 });
  if (!Array.isArray(body.items) || !body.items.length) return new Response(JSON.stringify({ error: "등록 대상 최소 1개 필수" }), { status: 400 });
  const items: CapaRegisterItem[] = body.items;
  const s: CapaRegisterSettings = body.settings;
  if (!s) return new Response(JSON.stringify({ error: "settings 필수" }), { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const { okCount, failCount, results, error } = await capaRegister(body.envName || "STG", body.rmsId, body.rmsPw, items, s, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", okCount, failCount, results, error });
      } catch (err) {
        send({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
