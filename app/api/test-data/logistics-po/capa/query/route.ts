import { NextRequest } from "next/server";
import { capaQuery } from "@/lib/test-data-logistics-po-capa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400 }); }
  if (!body.empEmail) return new Response(JSON.stringify({ ok: false, error: "임직원 이메일 필수" }), { status: 400 });
  if (!body.rmsId || !body.rmsPw) return new Response(JSON.stringify({ ok: false, error: "RMS ID/PW 필수" }), { status: 400 });
  if (!body.dateFrom || !body.dateTo) return new Response(JSON.stringify({ ok: false, error: "조회 기간 필수" }), { status: 400 });

  const r = await capaQuery({
    envName: body.envName || "STG", empEmail: body.empEmail, rmsId: body.rmsId, rmsPw: body.rmsPw,
    dateFrom: body.dateFrom, dateTo: body.dateTo,
    shipFilter: body.shipFilter === "PARCEL" ? "PARCEL" : "CAR", wpFilter: body.wpFilter || "",
  });
  return new Response(JSON.stringify(r), { status: r.ok ? 200 : 502, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
