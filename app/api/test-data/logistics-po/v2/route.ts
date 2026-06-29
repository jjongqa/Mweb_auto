import { NextRequest } from "next/server";
import { runPoV2, type V2RunInput, type V2ExistingStatement } from "@/lib/test-data-logistics-po-v2";
import { waitForMergeChoice } from "./_merge-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

let runCounter = 0;

export async function POST(req: NextRequest) {
  let body: Partial<V2RunInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.empEmail) return new Response(JSON.stringify({ error: "임직원 이메일 필수" }), { status: 400 });
  if (!body.supId || !body.supPw) return new Response(JSON.stringify({ error: "공급사 ID/PW 필수" }), { status: 400 });
  if (!Array.isArray(body.goods) || !body.goods.length) return new Response(JSON.stringify({ error: "상품 최소 1개 필수" }), { status: 400 });
  if (!Array.isArray(body.selectedCenters) || !body.selectedCenters.length) return new Response(JSON.stringify({ error: "입고지 최소 1개 필수" }), { status: 400 });

  const input: V2RunInput = {
    envName: body.envName || "STG", empEmail: body.empEmail, supId: body.supId, supPw: body.supPw,
    goods: body.goods, selectedCenters: body.selectedCenters, selectedDockByCenter: body.selectedDockByCenter,
    releaseProcess: body.releaseProcess, waypoint: body.waypoint, quantity: Math.max(1, Number(body.quantity) || 1),
    recvDate: body.recvDate, skipApplyStock: !!body.skipApplyStock, poType: body.poType === "EMERGENCY" ? "EMERGENCY" : "NORMAL",
  };

  const runId = `run-${Date.now()}-${++runCounter}`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runPoV2(
          input,
          (e) => send({ kind: "progress", event: e }),
          async (statements: V2ExistingStatement[]) => {
            send({ kind: "merge-prompt", runId, statements });
            return waitForMergeChoice(runId);
          },
        );
        send({ kind: "done", result });
      } catch (err) {
        send({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
