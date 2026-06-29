import { NextRequest } from "next/server";
import { getJob, deleteJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

// 잡 1건 + 재실행 후손 cascade 삭제. running/pending 잡은 보호.
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = getJob(id);
    if (!job) return Response.json({ error: "테스트 없음" }, { status: 404 });
    if (job.status === "running" || job.status === "pending") {
      return Response.json({
        error: `이 테스트는 ${job.status === "running" ? "실행 중" : "대기 중"}입니다. 먼저 중단해 주세요.`,
      }, { status: 400 });
    }
    const { deletedIds } = deleteJob(id);
    return Response.json({ ok: true, deletedIds });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
