"use client";

import { useEffect, useRef, useState } from "react";

type WorkerOption = {
  name: string;
  label: string | null;
  status_label: string;
  is_self: boolean;
  version?: string | null;
};

// TC 설계/작성 실행 워커 선택.
// 내장 워커 운영에서는 로컬 내장 워커명을 기본 선택해 에이전트 설정(design/write/exec)과 잡 라우팅을 같은 키로 묶는다.
export function WorkerPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const json = await (await fetch("/api/workers/list")).json();
        if (cancel) return;
        const list: WorkerOption[] = json.workers || [];
        setWorkers(list);
        if (!autoSelectedRef.current) {
          const builtin = list.find((w) => w.name === json.builtin_worker) || list.find((w) => w.version === "builtin");
          if (builtin) {
            autoSelectedRef.current = true;
            onChange(builtin.name);
          }
        }
      } catch {
        if (!cancel) setWorkers([]);
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => { cancel = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-neutral-800">실행 워커</div>
          <div className="text-xs text-neutral-600">기본값은 로컬 내장 워커입니다. 별도 지정하지 않으면 내장 워커가 자동으로 처리합니다.</div>
        </div>
        <a href="/workers" className="text-xs text-neutral-600 hover:underline">워커 상태 →</a>
      </div>
      {workers.length === 0 ? (
        <div className="rounded border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600">
          등록된 워커 행이 없어도 내장 워커는 실행 가능합니다. 작업이 대기 상태로 남으면 <code>npm run worker</code> 또는 <code>npm run dev:all</code>을 확인하세요.
        </div>
      ) : (
        <>
          <select value={value} onChange={(e) => onChange(e.target.value)} className="input w-full text-sm">
            <option value="">미지정</option>
            {workers.map((w) => {
              const idle = w.status_label === "대기 중";
              const selectable = w.is_self && idle;   // 본인 PC + 대기중만 선택 가능
              return (
                <option key={w.name} value={w.name} disabled={!selectable}>
                  {w.is_self ? "⭐ " : ""}{w.label || w.name} · {w.status_label}
                  {w.is_self ? " · 본인 PC" : " · 다른 PC (지정 불가)"}
                  {w.is_self && !idle && " (사용 불가)"}
                </option>
              );
            })}
          </select>
          <div className="mt-1.5 text-[11px] text-neutral-500">
            내장 워커만 쓰는 환경에서는 자동을 권장합니다. 특정 워커를 고르면 해당 이름으로 잡이 고정됩니다.
          </div>
        </>
      )}
    </div>
  );
}
