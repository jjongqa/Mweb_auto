"use client";

// 회귀 스위트 목록 — 커머스/물류 BU 토글로 분기. 각 스위트의 domain → bu 로 필터.

import { formatDateTimeKR } from "@/lib/format-date";
import type { Suite } from "@/lib/suites";
import { SuiteActions } from "./suite-actions";
import { BuProvider, BuTabs, useBu } from "@/app/_components/bu-domain-select";
import { getDomainById } from "@/lib/domains";

function fileCount(json: string): number {
  try { const a = JSON.parse(json); return Array.isArray(a) ? a.length : 0; } catch { return 0; }
}

function List({ suites }: { suites: Suite[] }) {
  const bu = useBu();
  const shown = suites.filter((s) => (getDomainById(s.domain)?.bu ?? "커머스") === bu);
  return (
    <div className="space-y-3">
      <BuTabs />
      {shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-neutral-500">
          {bu === "물류"
            ? "🚚 물류 스위트가 아직 없습니다."
            : "저장된 스위트가 없습니다. 완료된 잡 상세에서 “📁 스위트로 저장”을 눌러 만들 수 있어요."}
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100">
          {shown.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="font-medium text-neutral-900">{s.name}</div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {s.domain} · {s.platform === "app" ? "App" : s.platform === "mweb" ? "Mweb" : "Web"} · {s.qa_env} ·{" "}
                  <span className={`badge ${s.mode === "real" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{s.mode === "real" ? "REAL" : "MOCK"}</span>{" "}
                  · TC {fileCount(s.tc_filenames)}개
                  {s.claude_model && <span className="ml-1.5 font-mono text-[10px] text-neutral-400">{s.claude_model.replace("claude-", "")}</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-neutral-400">
                  {s.run_count > 0
                    ? `${s.run_count}회 실행 · 마지막 ${formatDateTimeKR(s.last_run_at)}`
                    : "아직 실행 안 함"}
                  {s.note && <span className="ml-2">· {s.note}</span>}
                </div>
              </div>
              <SuiteActions suiteId={s.id} suiteName={s.name} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SuitesList({ suites }: { suites: Suite[] }) {
  return (
    <BuProvider>
      <List suites={suites} />
    </BuProvider>
  );
}
