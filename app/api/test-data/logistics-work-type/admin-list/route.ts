import { NextRequest } from "next/server";
import { adminListSchedules } from "@/lib/test-data-logistics-work-type";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 어드민 리스트 조회 (work-schedules)
export async function POST(req: NextRequest) {
  let body: { adminId?: string; adminPw?: string; workDate?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.adminId || !body.adminPw) return new Response(JSON.stringify({ error: "어드민 ID/PW 필수" }), { status: 400 });
  if (!body.workDate) return new Response(JSON.stringify({ error: "근무일자 필수" }), { status: 400 });

  const r = await adminListSchedules(body.adminId, body.adminPw, body.workDate);
  return new Response(JSON.stringify(r), { status: r.ok ? 200 : 502, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
