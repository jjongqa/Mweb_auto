import { NextRequest } from "next/server";
import { resolveMergeChoice } from "../_merge-store";

export async function POST(req: NextRequest) {
  const { runId, mode, codes } = await req.json();
  if (!runId) return new Response(JSON.stringify({ error: "runId 필수" }), { status: 400 });
  const ok = resolveMergeChoice(runId, { mode: mode || "new", codes: codes || [] });
  return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 404 });
}
