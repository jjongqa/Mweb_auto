import { NextRequest } from "next/server";
import { getTcGenJob, createRefineJob } from "@/lib/tc-gen";

export const dynamic = "force-dynamic";

// POST /api/tc-gen/:id/refine  { instructions } — 이전 결과 + 피드백으로 개선 재생성.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const instructions = String(body.instructions ?? "").trim();
    if (!instructions) return Response.json({ error: "개선 지시 내용을 입력해 주세요" }, { status: 400 });

    const parent = getTcGenJob(id);
    if (!parent) return Response.json({ error: "원본 생성 잡 없음" }, { status: 404 });
    if (parent.status === "running" || parent.status === "pending") {
      return Response.json({ error: "원본 생성이 끝난 뒤 개선할 수 있어요" }, { status: 409 });
    }

    const child = createRefineJob(id, instructions);
    return Response.json({ ok: true, id: child.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
