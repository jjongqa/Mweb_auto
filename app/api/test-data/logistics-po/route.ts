import { NextRequest } from "next/server";
import { runPo, type PoRunInput } from "@/lib/test-data-logistics-po";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<PoRunInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.empEmail || !body.empEmail.trim()) return new Response(JSON.stringify({ error: "임직원 이메일 필수" }), { status: 400 });
  if (!body.supLoginId || !body.supPassword) return new Response(JSON.stringify({ error: "공급사 ID/PW 필수" }), { status: 400 });

  const input: PoRunInput = {
    envName: body.envName,
    empEmail: body.empEmail,
    searchWord: body.searchWord ?? "",
    groupName: body.groupName ?? "",
    receivingEstimateDate: body.receivingEstimateDate,
    boxQnty: body.boxQnty ?? 1,
    selectedCenters: Array.isArray(body.selectedCenters) ? body.selectedCenters : [],
    selectedDockByCenter: body.selectedDockByCenter,
    skipApplyStock: !!body.skipApplyStock,
    supLoginId: body.supLoginId,
    supPassword: body.supPassword,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runPo(input, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", result });
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
