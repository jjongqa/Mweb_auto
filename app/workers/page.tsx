import { listWorkers, markStaleWorkersOffline, workerStatusLabel } from "@/lib/workers";
import { formatDateTimeKR, formatRelativeKR } from "@/lib/format-date";
import { LabelCell } from "./label-cell";
import { WorkersAutoRefresh } from "./auto-refresh";
import { DeleteWorkerButton } from "./delete-worker-button";

export const dynamic = "force-dynamic";

export default function WorkersPage() {
  // SSR 시점에 stale 자동 처리
  markStaleWorkersOffline();
  const workers = listWorkers();
  const builtin = workers.find((w) => w.version === "builtin");

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">워커 관리</h1>
          <p className="mt-1 text-sm text-neutral-600">
            현재는 외부 워커 없이 로컬 내장 워커 기준으로 운영합니다. 내장 워커는 <code>npm run worker</code> 또는 <code>npm run dev:all</code>로 실행합니다.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <WorkersAutoRefresh intervalMs={10000} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border-l-4 border-blue-400 bg-blue-50 p-3 text-xs text-blue-900">
        <div className="font-medium">로컬 내장 워커 모드</div>
        <div className="mt-1 text-blue-800">
          잡 생성 시 워커를 지정하지 않으면 <code>worker_name=NULL</code>로 저장되고, 내장 워커가 DB에서 직접 가져갑니다.
          {builtin ? (
            <span className="ml-1">현재 내장 워커 heartbeat: <span className="font-mono">{builtin.last_heartbeat ? formatRelativeKR(builtin.last_heartbeat) : "-"}</span></span>
          ) : (
            <span className="ml-1">아래 목록에 내장 워커가 보이지 않아도 실행은 가능하지만, 대기 잡이 쌓이면 터미널에서 워커 실행 상태를 확인하세요.</span>
          )}
        </div>
      </div>

      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3">별칭</th>
              <th className="whitespace-nowrap px-4 py-3">호스트명</th>
              <th className="whitespace-nowrap px-4 py-3">상태</th>
              <th className="whitespace-nowrap px-4 py-3">IP</th>
              <th className="whitespace-nowrap px-4 py-3">능력</th>
              <th className="whitespace-nowrap px-4 py-3">슬롯</th>
              <th className="whitespace-nowrap px-4 py-3">마지막 heartbeat</th>
              <th className="whitespace-nowrap px-4 py-3">총 Job</th>
              <th className="whitespace-nowrap px-4 py-3">등록</th>
              <th className="whitespace-nowrap px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {workers.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-neutral-400">
                  등록된 워커가 없습니다. 워커를 시작하면 자동 등록됩니다.
                </td>
              </tr>
            ) : (
              workers.map((w) => {
                const label = workerStatusLabel(w);
                const cap = w.capabilities ? JSON.parse(w.capabilities) : null;
                return (
                  <tr key={w.name} className="hover:bg-neutral-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <LabelCell name={w.name} label={w.label} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{w.name}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge label={label} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-600">{w.ip_address || "-"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {cap?.web && <span className="mr-1 inline-block rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">Web</span>}
                      {cap?.app && <span className="inline-block rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">App</span>}
                      {!cap?.web && !cap?.app && <span className="text-neutral-400">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      <span className={`font-mono ${(w.active_jobs ?? 0) >= (w.max_concurrent || 1) ? "text-rose-600" : (w.active_jobs ?? 0) > 0 ? "text-amber-600" : "text-neutral-500"}`}>
                        {w.active_jobs ?? 0} / {w.max_concurrent || 1}
                      </span>
                      {(w.active_jobs ?? 0) > 0 && <span className="ml-1 text-[10px] text-neutral-400">처리 중</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500" title={w.last_heartbeat ? formatDateTimeKR(w.last_heartbeat) : ""}>
                      {w.last_heartbeat ? formatRelativeKR(w.last_heartbeat) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{w.total_jobs}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                      {formatDateTimeKR(w.registered_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {label === "꺼짐" && <DeleteWorkerButton name={w.name} label={w.label || w.name} />}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
        <div className="font-medium">운영 메모</div>
        <div className="mt-1 text-amber-800">
          외부 워커 설치/업데이트 플로우는 현재 운영 범위가 아닙니다. 필요해질 때 인증과 배포 방식을 다시 정리하는 것이 안전합니다.
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  const styles: Record<string, string> = {
    "대기 중": "bg-emerald-100 text-emerald-700",
    "실행 중": "bg-blue-100 text-blue-700",
    "꺼짐": "bg-neutral-200 text-neutral-600",
  };
  return <span className={`badge ${styles[label] ?? "bg-neutral-100 text-neutral-700"}`}>{label}</span>;
}
