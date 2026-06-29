import { NextRequest } from "next/server";
import { createSuiteFromJob, deleteSuite } from "@/lib/suites";

export const dynamic = "force-dynamic";

// POST /api/suites  { source_job_id, name, note? } → 잡을 스위트로 저장
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sourceJobId = String(body.source_job_id ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!sourceJobId) return Response.json({ error: "source_job_id 필수" }, { status: 400 });
    if (!name) return Response.json({ error: "스위트 이름 필수" }, { status: 400 });
    const suite = createSuiteFromJob(sourceJobId, name, body.note ? String(body.note) : null);
    return Response.json({ ok: true, suiteId: suite.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

// DELETE /api/suites?id=123
export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return Response.json({ error: "id 필수" }, { status: 400 });
  const ok = deleteSuite(id);
  return Response.json({ ok });
}
