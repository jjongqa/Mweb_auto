import { getBuiltinWorkerName, listWorkers, workerDisplayName, markStaleWorkersOffline } from "@/lib/workers";
import { headers } from "next/headers";
import { AgentsOffice } from "./office";
import { getAgentOfficeInsights } from "@/lib/agent-insights";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  markStaleWorkersOffline();
  const all = listWorkers();
  const builtinName = getBuiltinWorkerName();
  const workers = [
    ...(all.some((w) => w.name === builtinName) ? [] : [{ name: builtinName, label: "로컬 내장 워커" }]),
    ...all.map((w) => ({ name: w.name, label: workerDisplayName(w) })),
  ];

  // 이 PC 자동 감지 — 요청 client IP 와 워커 등록 IP 가 "정확히 한 워커"와 일치하면 그 워커로 자동 고정.
  // (register/list 와 동일한 IP 추출. 같은 IP 워커가 2개 이상이면 모호 → 자동 선택 안 함 = 선택 화면)
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  const realIp = h.get("x-real-ip");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || realIp || "";
  let detected: string | null = all.some((w) => w.name === builtinName) || workers.length > 0 ? builtinName : null;
  if (clientIp) {
    const matches = all.filter((w) => w.ip_address && w.ip_address === clientIp);
    if (matches.length === 1) detected = matches[0].name;
  }
  const insightsByWorker = Object.fromEntries(workers.map((w) => [w.name, getAgentOfficeInsights(w.name)]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🎮 에이전트 오피스</h1>
        <p className="mt-2 text-sm text-neutral-600">
          워커별 <strong>개인 에이전트</strong> — 설계·작성·수행 단계의 단일/멀티 모드와 지시를 관리합니다.
          설정한 에이전트는 QA 설계, TC 생성, 기능테스트 실행 화면에 바로 적용돼요.
        </p>
      </div>
      <AgentsOffice workers={workers} detected={detected} insightsByWorker={insightsByWorker} />
    </div>
  );
}
