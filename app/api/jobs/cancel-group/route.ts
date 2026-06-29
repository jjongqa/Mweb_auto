import { NextRequest } from "next/server";
import { getChunkSiblings, requestCancel } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/jobs/cancel-group { groupId } — 청크 그룹의 진행 중/대기 잡을 한 번에 취소.
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const groupId = String(b.groupId || "").trim();
  if (!groupId) return Response.json({ error: "groupId 필수" }, { status: 400 });

  const sibs = getChunkSiblings(groupId);
  if (sibs.length === 0) return Response.json({ error: "그룹을 찾을 수 없음" }, { status: 404 });

  let canceled = 0;
  for (const j of sibs) {
    if (j.status === "running" || j.status === "pending") {
      requestCancel(j.id);
      canceled++;
    }
  }
  return Response.json({ ok: true, canceled, total: sibs.length });
}
