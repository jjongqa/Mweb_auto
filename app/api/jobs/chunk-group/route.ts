import { NextRequest } from "next/server";
import { aggregateChunkGroup } from "@/lib/result-aggregation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/jobs/chunk-group?groupId= — 청크 그룹 합산(라이브 진행바용). 진행 = passed+failed+blocked.
export async function GET(req: NextRequest) {
  const groupId = (req.nextUrl.searchParams.get("groupId") || "").trim();
  if (!groupId) return Response.json({ error: "groupId 필수" }, { status: 400 });
  const agg = aggregateChunkGroup(groupId);
  if (!agg) return Response.json({ error: "그룹 없음" }, { status: 404 });
  const done = agg.passed + agg.failed + agg.blocked;
  return Response.json({
    ok: true,
    done,
    total: agg.total,
    passed: agg.passed,
    failed: agg.failed,
    blocked: agg.blocked,
    status: agg.status,
    doneCount: agg.doneCount,
    chunkCount: agg.chunkCount,
    slots: agg.slots,
    serialOverflow: agg.serialOverflow,
  });
}
