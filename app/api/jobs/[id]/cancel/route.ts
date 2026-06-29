import { NextRequest } from "next/server";
import { getJob, requestCancel, addLog } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "not found" }, { status: 404 });
  if (!["pending", "running"].includes(job.status)) {
    return Response.json({ error: `cannot cancel: status=${job.status}` }, { status: 400 });
  }

  requestCancel(id);
  addLog(id, "warn", "사용자가 작업 중단을 요청했습니다");

  return Response.json({ ok: true });
}
