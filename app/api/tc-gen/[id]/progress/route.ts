import { NextRequest } from "next/server";
import { appendTcGenProgress } from "@/lib/tc-gen";

export const dynamic = "force-dynamic";

// POST /api/tc-gen/:id/progress  { worker, phase }
// 워커가 하네스 실행 중 현재 단계(Phase 0~6 + 게이트 점수)를 보고 → 진행 로그에 표시(실시간).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const phase = body && typeof body.phase === "string" ? body.phase.trim().slice(0, 200) : "";
    if (phase) appendTcGenProgress(id, phase);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
