"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/app/_components/confirm-dialog";

const MY_NAME_KEY = "kurly-qa:jira-settings:my-name";

export function SuiteActions({ suiteId, suiteName }: { suiteId: number; suiteName: string }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState("");

  function run() {
    startBusy(async () => {
      setError("");
      let requestedBy: string | null = null;
      try { requestedBy = localStorage.getItem(MY_NAME_KEY); } catch {}
      const res = await fetch(`/api/suites/${suiteId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requested_by: requestedBy }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error || "실행 실패"); return; }
      router.push(`/jobs/${json.newJobId}`);
    });
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "스위트 삭제",
      body: `"${suiteName}" 스위트를 삭제합니다. (실행 기록/잡은 영향 없음)`,
      okLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    startBusy(async () => {
      const res = await fetch(`/api/suites?id=${suiteId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-600">{error}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-kurly-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-kurly-600 disabled:opacity-50"
      >
        {busy ? "..." : "▶ 지금 실행"}
      </button>
      <button
        onClick={remove}
        disabled={busy}
        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30"
        title="스위트 삭제"
      >
        🗑
      </button>
    </div>
  );
}
