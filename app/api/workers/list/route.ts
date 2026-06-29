import { NextRequest } from "next/server";
import { getBuiltinWorkerName, listWorkers, markStaleWorkersOffline, workerStatusLabel } from "@/lib/workers";

export const dynamic = "force-dynamic";

/**
 * GET /api/workers/list
 *
 * UI 드롭다운에서 사용. 1분 이상 응답 없는 워커는 자동 offline 처리.
 */
export async function GET(req: NextRequest) {
  markStaleWorkersOffline();

  // 요청 client IP (register 와 동일 패턴) — 같은 IP 의 워커가 본인 PC 일 가능성 높음
  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || realIp || "";

  // 단독/집 환경 토글 — WORKER_PICK_ANY=true 면 IP 무관 모든 워커를 '본인 PC'로 취급(어디서 접속하든 선택 가능).
  // 기본 false → 기존 IP 일치 판정 유지(회사 공유 환경 보호). 로컬 실험용.
  const pickAny = process.env.WORKER_PICK_ANY === "true";

  const builtinName = getBuiltinWorkerName();
  const workers = listWorkers();
  const rows = workers.map((w) => ({
    name: w.name,
    label: w.label,
    status: w.status,
    status_label: workerStatusLabel(w),
    ip_address: w.ip_address,
    capabilities: w.capabilities ? JSON.parse(w.capabilities) : null,
    last_heartbeat: w.last_heartbeat,
    total_jobs: w.total_jobs,
    active_jobs: w.active_jobs ?? 0,
    max_concurrent: w.max_concurrent ?? 1,
    version: w.version ?? null,
    // 본인 PC 식별 — client IP 와 워커 등록 IP 가 일치하면 true (WORKER_PICK_ANY=true 면 IP 무관 전부 true)
    is_self: pickAny || (!!clientIp && !!w.ip_address && w.ip_address === clientIp),
  }));
  if (!rows.some((w) => w.name === builtinName)) {
    rows.unshift({
      name: builtinName,
      label: "로컬 내장 워커",
      status: "online",
      status_label: "대기 중",
      ip_address: clientIp || null,
      capabilities: { web: true, app: true },
      last_heartbeat: null,
      total_jobs: 0,
      active_jobs: 0,
      max_concurrent: Number(process.env.WORKER_MAX_CONCURRENT || 1),
      version: "builtin",
      is_self: true,
    });
  }
  return Response.json({
    client_ip: clientIp || null,
    pick_any: pickAny,
    builtin_worker: builtinName,
    workers: rows,
  });
}
