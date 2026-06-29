import { NextRequest } from "next/server";
import { runKurlyroAction, type ActionInput } from "@/lib/test-data-logistics-kurlyro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 단건 액션 (기본 API / 아르바이트 / 관리 / 특수건강검진 탭)
export async function POST(req: NextRequest) {
  let body: { action?: string } & Partial<ActionInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.action) return new Response(JSON.stringify({ error: "action 필수" }), { status: 400 });
  if (!body.username || !body.password) return new Response(JSON.stringify({ error: "계정 ID/PW 필수" }), { status: 400 });

  const input: ActionInput = {
    username: body.username.trim(), password: body.password, name: body.name, phone: body.phone,
    cluster: body.cluster || "CC02", center: body.center || "GGH1", workPart: body.workPart || "IB", empNum: body.empNum,
    processCode: body.processCode, processName: body.processName, overWork: body.overWork,
    workShift: body.workShift, examinationDate: body.examinationDate, rejectionReason: body.rejectionReason,
    isSecond: body.isSecond, workerType: body.workerType, adminId: body.adminId, adminPw: body.adminPw,
  };

  const r = await runKurlyroAction(body.action, input);
  return Response.json({ ok: r.ok, logs: r.logs });
}
