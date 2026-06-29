"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PickerJob {
  id: string;
  label: string;
  domain: string;
  created_at: string;
  summary: string; // "50P 3F 2B / 55"
}

export function ComparePicker({ jobs, preselected }: { jobs: PickerJob[]; preselected: string[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set(preselected));

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function go() {
    if (sel.size < 2) return;
    router.push(`/compare?jobs=${[...sel].join(",")}`);
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">비교할 잡 선택 (2개 이상)</h2>
        <button
          onClick={go}
          disabled={sel.size < 2}
          className="rounded-md bg-kurly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kurly-600 disabled:opacity-40"
        >
          {sel.size}개 비교
        </button>
      </div>
      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
        {jobs.map((j) => (
          <label
            key={j.id}
            className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-neutral-50"
          >
            <input type="checkbox" checked={sel.has(j.id)} onChange={() => toggle(j.id)} className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate">{j.label}</span>
            <span className="shrink-0 text-xs text-neutral-400">{j.domain}</span>
            <span className="shrink-0 font-mono text-[11px] text-neutral-500">{j.summary}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
