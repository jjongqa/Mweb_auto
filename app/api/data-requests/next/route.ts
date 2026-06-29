import { NextRequest } from "next/server";
import { claimNextDataRequest } from "@/lib/data-requests";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const worker = url.searchParams.get("worker") || "unknown-worker";
  const request = claimNextDataRequest(worker);
  return Response.json({ ok: true, request });
}
