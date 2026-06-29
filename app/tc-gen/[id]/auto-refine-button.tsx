"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AutoRefineButton({
  id,
  score,
  threshold = 75,
  max = 2,
}: {
  id: string;
  score: number;
  threshold?: number;
  max?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function start() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/tc-gen/${id}/auto-refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold, max }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error || "자동 개선 시작 실패");
        return;
      }
      router.push(`/tc-gen/${j.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded border border-violet-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-neutral-600">
          품질 {score}/{threshold} 미만이면 리뷰 기반 개선 프롬프트로 재생성합니다. 최대 {max}회까지 자동으로 이어집니다.
        </div>
        <button
          onClick={start}
          disabled={busy}
          className="rounded-md bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
        >
          {busy ? "자동 개선 시작..." : "자동 개선 재생성"}
        </button>
      </div>
      {err && <div className="mt-1 text-xs text-rose-600">{err}</div>}
    </div>
  );
}
