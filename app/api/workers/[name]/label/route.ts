import { NextRequest } from "next/server";
import { updateWorkerLabel } from "@/lib/workers";

export const dynamic = "force-dynamic";

// PATCH /api/workers/[name]/label  Body: { label: string | null }
// 사용자 친화 이름 변경 — 어드민 UI 에서 누구나 편집 (PoC 정책).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const body = await req.json();
    const label = body.label === null || body.label === "" ? null : String(body.label);
    const ok = updateWorkerLabel(decodeURIComponent(name), label);
    if (!ok) return Response.json({ error: "워커 없음" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
