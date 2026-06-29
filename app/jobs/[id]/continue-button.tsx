"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/app/_components/confirm-dialog";

export function ContinueButton({
  jobId,
  status,
  done,
}: {
  jobId: string;
  status: string;
  done: number;  // 이미 처리된 건수 (PASS+FAIL+BLOCKED)
}) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string>("");

  async function onClick() {
    const ok = await confirmDialog({
      title: "이어서 진행",
      body: `이전 진행분 ${done}건은 보존하고, 다음 시나리오/TC 부터 이어서 진행합니다.\n\n원본 결과 폴더의 summary.csv 를 참조해 중복 처리는 자동으로 skip 됩니다.`,
      okLabel: "이어서 진행",
    });
    if (!ok) return;
    startBusy(async () => {
      setError("");
      const res = await fetch(`/api/jobs/${jobId}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "이어서 진행 실패");
        return;
      }
      router.push(`/jobs/${json.newJobId}`);
    });
  }

  const statusLabel = ({ failed: "실패", canceled: "취소", succeeded: "성공" } as Record<string, string>)[status] ?? status;

  return (
    <div className="card border-l-4 border-l-blue-400 bg-blue-50/40 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-blue-800">▶ 이어서 진행</div>
          <div className="mt-0.5 text-xs text-neutral-700">
            {statusLabel}된 시점까지 처리한 <strong>{done}건은 보존</strong>하고, 다음 시나리오/TC 부터 이어서 실행합니다.
            새 Job 의 프롬프트에 이전 결과 폴더(<code className="rounded bg-white px-1 py-0.5">summary.csv</code>)를 참고하라는 지시가 자동 추가됩니다.
          </div>
          {error && <div className="mt-2 text-xs text-rose-600">⚠ {error}</div>}
        </div>
        <button
          onClick={onClick}
          disabled={busy}
          className="whitespace-nowrap rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {busy ? "준비 중..." : "▶ 이어서 진행"}
        </button>
      </div>
    </div>
  );
}
