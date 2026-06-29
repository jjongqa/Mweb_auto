import { NextRequest } from "next/server";
import { tcGenGroupSummary } from "@/lib/tc-gen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tc-gen/group?groupId= — 지시기반 병렬 그룹 요약(라이브 폴링용).
export async function GET(req: NextRequest) {
  const groupId = (req.nextUrl.searchParams.get("groupId") || "").trim();
  if (!groupId) return Response.json({ error: "groupId 필수" }, { status: 400 });
  const s = tcGenGroupSummary(groupId);
  if (!s) return Response.json({ error: "그룹 없음" }, { status: 404 });
  return Response.json({
    ok: true,
    kind: s.kind,
    status: s.status,
    total: s.total,
    done: s.done,
    succeeded: s.succeeded,
    failed: s.failed,
    totalTc: s.totalTc,
    jobs: s.jobs.map((j) => ({
      id: j.id,
      nickname: j.agent_nickname,
      status: j.status,
      tc_count: j.tc_count,
    })),
  });
}
