import { completeDataRequest } from "@/lib/data-requests";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const status = String(body.status || "").toLowerCase();
    if (!["ready", "blocked", "failed"].includes(status)) {
      return Response.json({ ok: false, error: "status must be ready, blocked, or failed" }, { status: 400 });
    }
    const request = completeDataRequest(id, {
      status: status as "ready" | "blocked" | "failed",
      resultContext: body.dataContext ?? body.resultContext ?? {},
      verification: body.verification ? String(body.verification) : null,
      notes: body.notes ? String(body.notes) : null,
      errorMessage: body.errorMessage ? String(body.errorMessage) : null,
      rawOutput: body.rawOutput ? String(body.rawOutput) : null,
    });
    if (!request) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, request });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
