"use client";

import { useEffect, useState } from "react";

// 설계/작성 "지시 기반 병렬" 토글 — 선택 워커의 해당 그룹(design/write)이 multi(2명+)면 배너+체크박스 노출.
// 켜면 폼이 multi_agent=1 을 보내고, 서버가 활성 에이전트마다 잡 1개씩(각자 instruction=focus) 생성 후 합본.
export function AgentMultiToggle({
  worker,
  group,
  enabled,
  setEnabled,
}: {
  worker: string;
  group: "design" | "write";
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}) {
  const [agents, setAgents] = useState<{ nickname: string; instruction: string }[]>([]);
  const [mode, setMode] = useState<string>("single");

  useEffect(() => {
    if (!worker) {
      setMode("single");
      setAgents([]);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/agents?worker=${encodeURIComponent(worker)}`);
        const d = await r.json();
        if (cancel) return;
        setMode(d.modes?.[group] || "single");
        setAgents(
          (d.agents || [])
            .filter((a: { grp: string }) => a.grp === group)
            .map((a: { nickname: string; instruction?: string }) => ({ nickname: a.nickname, instruction: a.instruction || "" }))
        );
      } catch {
        if (!cancel) {
          setMode("single");
          setAgents([]);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [worker, group]);

  const available = mode === "multi" && agents.length >= 2;
  useEffect(() => {
    if (!available && enabled) setEnabled(false);
  }, [available, enabled, setEnabled]);

  if (!available) return null;
  const label = group === "design" ? "설계" : "작성";
  return (
    <div className="rounded-md border border-kurly-300 bg-kurly-50/60 p-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5" />
        <div>
          <div className="font-medium text-kurly-900">🎮 지시 기반 병렬 {label} — {agents.length}개 에이전트</div>
          <div className="mt-0.5 text-xs text-kurly-700">
            같은 기획서를 {agents.map((a) => a.nickname).join(" · ")}가 <strong>각자 지시(focus)대로</strong> 동시에 {label} → 결과를 하나로 합본해요.
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-kurly-700">
            {agents.map((a) => (
              <li key={a.nickname}>
                · <strong>{a.nickname}</strong>:{" "}
                {a.instruction.trim() ? a.instruction : <span className="text-amber-600">지시 없음 (기획서 전반 담당)</span>}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[11px] text-kurly-600">
            지시는 <a href="/agents" className="underline">🎮 에이전트 오피스</a>에서 설정.
          </div>
        </div>
      </label>
    </div>
  );
}
