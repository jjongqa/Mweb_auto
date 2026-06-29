"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/app/_components/confirm-dialog";

export function RestartButton({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string>("");

  async function onClick() {
    const ok = await confirmDialog({
      title: "처음부터 다시 시작",
      body: "이 작업을 같은 설정으로 처음부터 다시 시작할까요?\n\n원본 CSV / 도메인 / 플랫폼 / 환경 / 필터 그대로 새 Job 으로 등록됩니다.",
      okLabel: "다시 시작",
    });
    if (!ok) return;
    startBusy(async () => {
      setError("");
      const res = await fetch(`/api/jobs/${jobId}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "재시작 실패");
        return;
      }
      router.push(`/jobs/${json.newJobId}`);
    });
  }

  const statusLabel = ({ failed: "실패", canceled: "취소", succeeded: "성공" } as Record<string, string>)[status] ?? status;

  return (
    <div className="card border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-neutral-800">처음부터 다시 시작</div>
          <div className="mt-0.5 text-xs text-neutral-600">
            {statusLabel}된 이 Job 을 동일한 설정으로 처음부터 다시 실행합니다. 원본 CSV / 도메인 / 플랫폼 / 환경 / 필터 모두 그대로 상속.
          </div>
          {error && <div className="mt-2 text-xs text-rose-600">⚠ {error}</div>}
        </div>
        <button
          onClick={onClick}
          disabled={busy}
          className="whitespace-nowrap rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? "준비 중..." : "🔄 처음부터 다시"}
        </button>
      </div>
    </div>
  );
}
