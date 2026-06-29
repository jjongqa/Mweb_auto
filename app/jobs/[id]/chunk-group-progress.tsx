"use client";

import { useEffect, useState } from "react";

type Agg = { done: number; total: number; passed: number; failed: number; blocked: number; status: string; chunkCount: number; slots: number; serialOverflow: number };

// 청크 그룹 전체 진행바 — 3명(N개) 합산. running 중이면 3초마다 갱신.
export function ChunkGroupProgress({ groupId, initial }: { groupId: string; initial: Agg }) {
  const [agg, setAgg] = useState<Agg>(initial);

  useEffect(() => {
    if (agg.status !== "running") return; // 끝났으면 폴링 중단
    let cancel = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/jobs/chunk-group?groupId=${encodeURIComponent(groupId)}`);
        const d = await r.json();
        if (cancel || !d.ok) return;
        setAgg({ done: d.done, total: d.total, passed: d.passed, failed: d.failed, blocked: d.blocked, status: d.status, chunkCount: d.chunkCount, slots: d.slots ?? 0, serialOverflow: d.serialOverflow ?? 0 });
      } catch {
        /* 무시 */
      }
    };
    const t = setInterval(poll, 3000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [groupId, agg.status]);

  const pct = agg.total > 0 ? Math.round((agg.done / agg.total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-kurly-700">전체 진행 ({agg.chunkCount}명 합산)</span>
        <span className="font-mono text-neutral-600">
          {agg.done} / {agg.total} ({pct}%)
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div
          className="h-full rounded-full bg-kurly-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {agg.serialOverflow > 0 && (
        <div className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800">
          ⚠️ 이 워커는 동시 <b>{agg.slots}개</b>까지 처리 — 청크 {agg.chunkCount}개 중 <b>{agg.serialOverflow}개</b>는 순차 대기합니다.
          완전 병렬로 돌리려면 워커를 <code className="font-mono">WORKER_MAX_CONCURRENT={agg.chunkCount}</code> 이상으로 재시작하세요.
        </div>
      )}
    </div>
  );
}
