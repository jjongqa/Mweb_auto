"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/app/_components/confirm-dialog";

// 청크 그룹 전체(진행 중/대기) 일괄 중단 버튼. running 청크가 있을 때만 노출.
export function CancelGroupButton({ groupId, runningCount }: { groupId: string; runningCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (runningCount <= 0) return null;
  return (
    <button
      disabled={busy}
      onClick={async () => {
        const ok = await confirmDialog({
          title: "그룹 전체 중단",
          body: `진행 중인 청크 ${runningCount}개를 모두 중단합니다. 각 워커가 claude·브라우저를 정리합니다.`,
          okLabel: "전체 중단",
          danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
          await fetch("/api/jobs/cancel-group", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId }),
          });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
    >
      {busy ? "중단 중…" : `⛔ 그룹 전체 중단 (${runningCount})`}
    </button>
  );
}
