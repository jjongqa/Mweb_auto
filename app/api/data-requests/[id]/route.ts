import { getDataRequest } from "@/lib/data-requests";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDataRequest(id);
  if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return Response.json({ ok: true, request: row });
}
