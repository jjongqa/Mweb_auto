import { NextRequest } from "next/server";
import { createDataRequest, listDataRequests } from "@/lib/data-requests";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sourceJobId = url.searchParams.get("sourceJobId");
  const limit = Number(url.searchParams.get("limit") || "50");
  return Response.json({ ok: true, requests: listDataRequests({ sourceJobId, limit }) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const need = String(body.need ?? "").trim();
    if (!need) return Response.json({ ok: false, error: "need is required" }, { status: 400 });
    const row = createDataRequest({
      sourceJobId: body.sourceJobId ? String(body.sourceJobId) : null,
      sourceAgent: body.sourceAgent ? String(body.sourceAgent) : null,
      tcRef: body.tcRef ? String(body.tcRef) : null,
      need,
      reason: body.reason ? String(body.reason) : null,
      inputs: body.inputs ?? {},
      preferredTool: body.preferredTool ? String(body.preferredTool) : null,
    });
    return Response.json({ ok: true, request: row });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
