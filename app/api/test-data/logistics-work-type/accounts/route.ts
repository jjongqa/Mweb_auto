import { loadWorkTypeAccounts } from "@/lib/test-data-logistics-work-type";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 근무유형 48종 ↔ 프리셋 계정 매핑 (계정 매핑 탭 / 셀렉터용)
export async function GET() {
  try {
    return Response.json({ ok: true, accounts: loadWorkTypeAccounts() });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), { status: 500 });
  }
}
