import { NextRequest } from "next/server";
import { runCustom, type CustomInput } from "@/lib/test-data-logistics-work-type";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 커스텀 시나리오 (1~5단계 선택 실행, SSE)
export async function POST(req: NextRequest) {
  let body: Partial<CustomInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.adminId || !body.adminPw) return new Response(JSON.stringify({ error: "어드민 ID/PW 필수" }), { status: 400 });
  if (!body.username || !body.name || !body.empNum) return new Response(JSON.stringify({ error: "아이디/이름/사번 필수" }), { status: 400 });
  if (!body.workTypeName) return new Response(JSON.stringify({ error: "근무유형 필수" }), { status: 400 });
  if (!body.workDate) return new Response(JSON.stringify({ error: "근무일자 필수" }), { status: 400 });

  const input: CustomInput = {
    adminId: body.adminId, adminPw: body.adminPw,
    username: body.username.trim(), name: body.name.trim(), phone: (body.phone || "").trim(), empNum: body.empNum.trim(),
    workTypeName: body.workTypeName, shift: body.shift || "08:00 ~ 17:00",
    startTime: (body.startTime || "").trim(), endTime: (body.endTime || "").trim(), overtimeMins: body.overtimeMins || 0,
    workDate: body.workDate, month: body.month || body.workDate.slice(0, 7),
    startStep: Math.max(1, Math.min(5, Number(body.startStep) || 1)),
    endStep: Math.max(Number(body.startStep) || 1, Math.min(5, Number(body.endStep) || 5)),
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runCustom(input, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", result });
      } catch (err) {
        send({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}
