"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type GJob = { id: string; nickname: string | null; status: string; tc_count: number };
type Summary = {
  kind: "design" | "tc";
  status: "running" | "succeeded" | "failed";
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  totalTc: number;
  jobs: GJob[];
};

const jobLabel = (s: string) =>
  s === "succeeded" ? "완료" : s === "failed" ? "실패" : s === "running" ? "생성 중" : "대기";

// 지시 기반 병렬 그룹 배너 — 같은 그룹 에이전트별 잡 상태 + 합본(작성 CSV 다운로드 / 설계 분석은 아래 표시).
export function TcGenGroupBanner({ groupId, basePath }: { groupId: string; basePath: string }) {
  const router = useRouter();
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let prevDone = -1;
    const tick = async () => {
      try {
        const r = await fetch(`/api/tc-gen/group?groupId=${encodeURIComponent(groupId)}`);
        const d = await r.json();
        if (cancel || !d.ok) return;
        setS(d);
        if (d.done !== prevDone) {
          prevDone = d.done;
          router.refresh(); // 완료 수 변하면 서버 컴포넌트 갱신(개별 결과·합본 분석 반영)
        }
        if (d.status === "running") timer = setTimeout(tick, 3000);
      } catch {
        if (!cancel) timer = setTimeout(tick, 3000);
      }
    };
    tick();
    return () => {
      cancel = true;
      if (timer) clearTimeout(timer);
    };
  }, [groupId, router]);

  if (!s) return null;
  const isTc = s.kind === "tc";
  const label = isTc ? "작성" : "설계";
  return (
    <div className="card border-kurly-300 bg-kurly-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-kurly-900">
          🎮 지시 기반 병렬 {label} — {s.done}/{s.total} 완료
          {isTc && s.totalTc > 0 ? ` · 합산 TC ${s.totalTc}건` : ""}
        </h2>
        <div className="flex items-center gap-2">
          {isTc && s.succeeded > 0 && (
            <a
              href={`/api/tc-gen/group/download?groupId=${groupId}`}
              className="rounded-md border border-kurly-300 px-2.5 py-1 text-xs font-medium text-kurly-700 hover:bg-kurly-50"
            >
              ⬇ 통합 CSV{s.status === "running" ? " (진행 중)" : ""}
            </a>
          )}
          <span
            className={`badge ${s.status === "succeeded" ? "bg-emerald-100 text-emerald-700" : s.status === "failed" ? "bg-rose-100 text-rose-700" : "bg-blue-100 text-blue-700"}`}
          >
            {s.status === "succeeded" ? "완료" : s.status === "failed" ? "실패" : "진행 중"}
          </span>
        </div>
      </div>
      <div className="mt-2 space-y-1 border-t border-kurly-100 pt-2">
        {s.jobs.map((j) => (
          <Link key={j.id} href={`${basePath}/${j.id}`} className="block rounded px-2 py-1 text-xs hover:bg-kurly-100">
            <span className="font-medium text-neutral-700">{j.nickname || "에이전트"}</span>
            {" · "}
            <span className="text-neutral-500">{jobLabel(j.status)}</span>
            {isTc && j.status === "succeeded" ? <span className="text-emerald-600"> · TC {j.tc_count}건</span> : null}
          </Link>
        ))}
      </div>
      {!isTc && s.status === "succeeded" && (
        <p className="mt-2 text-[11px] text-kurly-700">아래에 에이전트별 설계 분석이 합본으로 표시돼요.</p>
      )}
    </div>
  );
}
