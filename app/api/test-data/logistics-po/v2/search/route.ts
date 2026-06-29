import { NextRequest } from "next/server";
import { searchPoV2 } from "@/lib/test-data-logistics-po-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { envName?: string; empEmail?: string; supplierName?: string; goodsName?: string; centers?: string[] };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400 }); }
  if (!body.empEmail) return new Response(JSON.stringify({ ok: false, error: "임직원 이메일 필수" }), { status: 400 });
  const r = await searchPoV2(body.envName || "STG", body.empEmail, body.supplierName || "", body.goodsName || "", Array.isArray(body.centers) ? body.centers : []);
  return new Response(JSON.stringify(r), { status: r.ok ? 200 : 502, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
