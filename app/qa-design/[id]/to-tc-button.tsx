"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PocSelector } from "@/app/_components/poc-selector";
import { getDomainById } from "@/lib/domains";

export function ToTcButton({ id, domain }: { id: string; domain?: string }) {
  const router = useRouter();
  const [pocs, setPocs] = useState<string[]>([]);
  const [engine] = useState<"harness" | "legacy">("legacy");  // 집 환경: 하네스 미사용 — 기존 도메인 스킬 고정
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    if (pocs.length === 0) { setErr("대상 POC(시트분류)를 1개 이상 선택해 주세요"); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/qa-design/${id}/to-tc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pocs, engine }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || "TC생성 전달 실패"); return; }
      // 작성 멀티면 그룹 첫 잡으로 (그룹 합본 배너가 보임)
      router.push(j.group_id ? `/tc-gen/${j.ids[0]}` : `/tc-gen/${j.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-emerald-900">대상 POC (시트분류) — 선택한 시스템/화면의 TC만 생성됩니다</div>
      <PocSelector value={pocs} onChange={setPocs} disabled={busy} bu={domain ? getDomainById(domain)?.bu : undefined} />
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={go}
          disabled={busy}
          className="rounded-md bg-kurly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kurly-600 disabled:opacity-50"
          title="선택한 POC를 반영한 TC 생성을 시작합니다"
        >
          {busy ? "전달 중..." : "🧬 TC생성으로 보내기"}
        </button>
        {err && <span className="text-xs text-rose-600">{err}</span>}
      </div>
    </div>
  );
}
