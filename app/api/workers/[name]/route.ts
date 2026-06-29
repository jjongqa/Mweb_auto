import { NextRequest } from "next/server";
import { deleteWorker, getWorker, workerStatusLabel } from "@/lib/workers";

export const dynamic = "force-dynamic";

// 어드민이 도는 PC(localhost 접속)만 워커 삭제 가능. 다른 사람은 LAN IP로 접속하므로 Host 가 다름.
// 사내망 무인증 환경의 최소 권한 가드 — UI 버튼 숨김(delete-worker-button.tsx)과 짝.
const OWNER_HOSTS = ["localhost", "127.0.0.1", "::1"];
function isOwnerRequest(req: NextRequest): boolean {
  const host = (req.headers.get("host") || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return OWNER_HOSTS.includes(host);
}

// DELETE /api/workers/[name] — 워커 등록 행 삭제 (offline 만 허용; 실행 중/대기 워커는 보호).
// jobs.worker_name 은 텍스트 참조라 cascade 없음 — 과거 잡 기록은 그대로 유지됨.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  if (!isOwnerRequest(req)) {
    return Response.json({ error: "삭제 권한 없음 — 어드민 PC(localhost)에서만 가능합니다" }, { status: 403 });
  }
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const w = getWorker(decoded);
  if (!w) return Response.json({ error: "워커 없음" }, { status: 404 });
  if (workerStatusLabel(w) !== "꺼짐") {
    return Response.json({ error: "온라인/실행 중 워커는 삭제할 수 없습니다 (꺼진 워커만)" }, { status: 409 });
  }
  const ok = deleteWorker(decoded);
  return Response.json({ ok });
}
