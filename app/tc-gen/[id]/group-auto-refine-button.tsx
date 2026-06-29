"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RefineResponse = {
  ok?: boolean;
  id?: string;
  existing?: boolean;
  error?: string;
};

// 종합(합본) 품질 리뷰 카드의 "전체 자동 개선" 버튼.
// 합본 점수가 기준 미만일 때만 노출되며(부모에서 제어), 클릭 시 기준 미달 에이전트만 골라 자동 개선 잡을 띄운다.
// (per-agent 자동개선은 분할 멀티에서 '가짜 미달'을 보고 누르기 쉬워 그룹 단위로 일원화.)
export function GroupAutoRefineButton({
  agents,
  threshold,
}: {
  agents: { id: string; score: number }[];
  threshold: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const targets = agents.filter((a) => a.score < threshold);
  if (targets.length === 0) return null;

  async function go() {
    setBusy(true);
    setMsg("");
    try {
      const results = await Promise.all(
        targets.map(async (t): Promise<RefineResponse> => {
          try {
            const res = await fetch(`/api/tc-gen/${t.id}/auto-refine`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ threshold, max: 2 }),
            });
            const json = (await res.json().catch(() => ({}))) as RefineResponse;
            if (!res.ok) return { ok: false, error: json.error || `HTTP ${res.status}` };
            return json;
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        })
      );

      const started = results.filter((r): r is RefineResponse & { ok: true; id: string } => Boolean(r.ok && r.id));
      if (started.length === 0) {
        const errors = results.map((r) => r.error).filter(Boolean);
        setMsg(errors.length > 0 ? `자동 개선 실패: ${errors.slice(0, 2).join(" / ")}` : "자동 개선을 시작하지 못했어요.");
        return;
      }
      const createdCount = started.filter((r) => !r.existing).length;
      const existingCount = started.length - createdCount;
      setMsg(`자동 개선 ${createdCount}건${existingCount ? ` · 진행 중 ${existingCount}건` : ""} 시작. 이동합니다...`);
      router.push(`/tc-gen/${started[0].id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
        title="합본 품질이 기준 미만일 때, 기준 미달 에이전트만 골라 자동 개선합니다 (최대 2회 자동 반복)."
      >
        {busy ? "자동 개선 시작 중..." : `🔄 합본 자동 개선 — 미달 ${targets.length}명 재생성`}
      </button>
      {msg && <span className="text-[11px] text-rose-600">{msg}</span>}
    </div>
  );
}
