import { NextRequest } from "next/server";
import { manualCommute } from "@/lib/test-data-logistics-work-type";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 수동 출퇴근 (단건)
export async function POST(req: NextRequest) {
  let body: { action?: "start" | "end"; username?: string; workDate?: string; time?: string; overtimeMins?: number };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.username || !body.workDate || !body.time) return new Response(JSON.stringify({ error: "username/workDate/time 필수" }), { status: 400 });
  const action = body.action === "end" ? "end" : "start";
  const r = await manualCommute(action, body.username.trim(), body.workDate, body.time, body.overtimeMins || 0);
  return Response.json({ ok: r.ok, status: r.status });
}
