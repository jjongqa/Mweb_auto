import { NextRequest } from "next/server";
import { claimSettings, unclaimSettings, getSettingsById, publicSettings } from "@/lib/jira";

export const dynamic = "force-dynamic";

/**
 * POST /api/jira/settings/claim?id=N           → claim (글로벌 "내 토큰" 마킹)
 * POST /api/jira/settings/claim?id=N&unclaim=1 → unclaim
 */
export async function POST(req: NextRequest) {
  const idParam = req.nextUrl.searchParams.get("id");
  const unclaim = req.nextUrl.searchParams.get("unclaim") === "1";
  if (!idParam) return Response.json({ error: "id 쿼리 필수" }, { status: 400 });
  const id = Number(idParam);
  const existing = getSettingsById(id);
  if (!existing) return Response.json({ error: "행 없음" }, { status: 404 });

  // 이미 claim 된 행을 다시 claim 시도하면 안내 (덮어쓰기 방지)
  if (!unclaim && existing.claimed_at) {
    return Response.json({
      error: "이미 다른 사람이 claim 한 행입니다. 먼저 unclaim 하거나 다른 행을 만드세요.",
      claimed_at: existing.claimed_at,
    }, { status: 409 });
  }

  const ok = unclaim ? unclaimSettings(id) : claimSettings(id);
  if (!ok) return Response.json({ error: "처리 실패" }, { status: 500 });
  const updated = getSettingsById(id);
  return Response.json({ ok: true, settings: updated ? publicSettings(updated) : null });
}
