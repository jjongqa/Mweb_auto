import { NextRequest } from "next/server";
import { preparePo } from "@/lib/test-data-logistics-po";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 임직원 이메일로 로그인 검증 + 도크 목록 반환 (폼이 실행 전 도크 선택 UI를 그리기 위함).
export async function POST(req: NextRequest) {
  let body: { empEmail?: string; envName?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400 }); }

  if (!body.empEmail || !body.empEmail.trim()) {
    return new Response(JSON.stringify({ ok: false, error: "임직원 이메일 필수" }), { status: 400 });
  }

  const result = await preparePo(body.empEmail.trim(), body.envName);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
