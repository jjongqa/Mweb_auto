import { NextRequest } from "next/server";
import { getTcGenJob, finalizeTcGenOutput } from "@/lib/tc-gen";

export const dynamic = "force-dynamic";

// POST /api/tc-gen/:id/result  { worker, ok, output, failReason? }
// 워커가 로컬 claude -p 로 받은 raw 출력을 회신 → admin 이 CSV 추출/정규화/저장(또는 분석 저장)으로 마무리.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });

    const job = getTcGenJob(id);
    if (!job) return Response.json({ error: "잡 없음" }, { status: 404 });
    // 이미 끝났거나(중복 회신) reclaim 된 잡은 무시 — 멱등 처리
    if (job.status !== "running") {
      return Response.json({ ok: true, skipped: `상태 ${job.status} — 무시` });
    }

    const ok = body.ok !== false;
    const report = body.report ? (typeof body.report === "string" ? body.report : JSON.stringify(body.report)) : undefined;
    finalizeTcGenOutput(id, String(body.output ?? ""), ok, body.failReason ? String(body.failReason) : undefined, report);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
