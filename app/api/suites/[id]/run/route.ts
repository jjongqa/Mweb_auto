import { NextRequest } from "next/server";
import { runSuite } from "@/lib/suites";

export const dynamic = "force-dynamic";

// POST /api/suites/:id/run  { requested_by? } → 새 잡 생성
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const requestedBy = body.requested_by ? String(body.requested_by) : null;
    const job = runSuite(Number(id), requestedBy);
    return Response.json({ ok: true, newJobId: job.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
