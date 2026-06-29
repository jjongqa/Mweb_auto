import { NextRequest } from "next/server";
import { runKurlyro, type KurlyroAccount, type Scenario } from "@/lib/test-data-logistics-kurlyro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  const scenario: Scenario = body.scenario === "arbeit" ? "arbeit" : "contract";
  const maxStep = scenario === "arbeit" ? 10 : 8;
  const startStep = Math.max(1, Math.min(maxStep, Number(body.startStep) || 1));
  const endStep = Math.max(startStep, Math.min(maxStep, Number(body.endStep) || maxStep));

  const a = body.account || {};
  if (!a.username || !a.password) return new Response(JSON.stringify({ error: "ID/PW 필수" }), { status: 400 });
  if (startStep <= 1 && (!a.name || !a.phone)) return new Response(JSON.stringify({ error: "회원가입 단계 포함 시 이름/전화번호 필수" }), { status: 400 });

  const account: KurlyroAccount = {
    username: String(a.username).trim(),
    password: String(a.password),
    name: String(a.name || "").trim(),
    phone: String(a.phone || "").trim(),
    cluster: a.cluster || "CC02",
    center: a.center || "GGH1",
    workPart: a.workPart || "IB",
    empNum: a.empNum,
    processCode: a.processCode,
    processName: a.processName,
    overWork: a.overWork === "NOT_WISHED" ? "NOT_WISHED" : "WISHED",
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runKurlyro(scenario, account, startStep, endStep, (e) => send({ kind: "progress", event: e }));
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
