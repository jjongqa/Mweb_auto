import { NextRequest } from "next/server";
import { createQualityRefineJob, getActiveQualityRefineChild, getTcGenJob, readTcQualityReview, AUTO_REFINE_THRESHOLD } from "@/lib/tc-gen";

export const dynamic = "force-dynamic";

// POST /api/tc-gen/:id/auto-refine
// 품질 리뷰를 기반으로 개선 프롬프트를 자동 생성해 refine 잡을 시작한다.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const threshold = Number(body.threshold ?? AUTO_REFINE_THRESHOLD);
    const max = Number(body.max ?? 2);

    const parent = getTcGenJob(id);
    if (!parent) return Response.json({ error: "원본 생성 잡 없음" }, { status: 404 });
    if (parent.status === "running" || parent.status === "pending") {
      return Response.json({ error: "원본 생성이 끝난 뒤 자동 개선할 수 있어요" }, { status: 409 });
    }
    if (parent.kind !== "tc") {
      return Response.json({ error: "자동 품질 개선은 TC 생성 결과에서만 사용할 수 있어요" }, { status: 400 });
    }
    const activeChild = getActiveQualityRefineChild(id);
    if (activeChild) {
      return Response.json({ ok: true, id: activeChild.id, existing: true });
    }

    const review = readTcQualityReview(parent.output_path);
    if (!review) return Response.json({ error: "품질 리뷰 파일이 없습니다" }, { status: 404 });
    if (review.score >= threshold) {
      return Response.json({ error: `이미 기준 점수 이상입니다 (${review.score}/${threshold})` }, { status: 409 });
    }

    const child = createQualityRefineJob(id, {
      iteration: 1,
      max: Math.max(1, Math.min(5, Number.isFinite(max) ? max : 2)),
      threshold: Math.max(0, Math.min(100, Number.isFinite(threshold) ? threshold : AUTO_REFINE_THRESHOLD)),
    });
    return Response.json({ ok: true, id: child.id, score: review.score, threshold });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
