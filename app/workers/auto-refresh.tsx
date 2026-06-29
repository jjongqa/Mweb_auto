"use client";

// 워커 관리 페이지를 주기적으로 server refresh — 모니터링 페이지라 새로고침 없이 live 유지.
// router.refresh() 가 server 컴포넌트(markStaleWorkersOffline + listWorkers) 를 다시 실행.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function WorkersAutoRefresh({ intervalMs = 10000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [on, intervalMs, router]);

  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-3.5 w-3.5" />
      <span className={on ? "text-emerald-600" : ""}>{on ? `자동 갱신 (${Math.round(intervalMs / 1000)}초)` : "자동 갱신 꺼짐"}</span>
    </label>
  );
}
