import { NextRequest } from "next/server";
import { getTcGenJob } from "@/lib/tc-gen";

export const dynamic = "force-dynamic";

// GET /api/tc-gen/:id — 폴링용 상태. spec_text/qa_analysis 는 큰 컬럼이라 제외.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getTcGenJob(id);
  if (!job) return Response.json({ error: "없음" }, { status: 404 });
  const { spec_text, qa_analysis, ...rest } = job;
  void spec_text; void qa_analysis;
  return Response.json({ job: rest });
}
