"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/app/_components/confirm-dialog";

export function DeleteButton({ folder, filename }: { folder: string; filename: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  async function handleDelete() {
    const ok = await confirmDialog({
      title: "파일 삭제",
      body: `${folder}/${filename}\n\n_backup/${folder}/ 폴더로 자동 백업된 뒤 휴지통으로 이동합니다.`,
      okLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await fetch("/api/prompts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, filename }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        alert(`삭제 실패: ${json.error ?? res.statusText}`);
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  if (done) return <span className="text-[10px] text-neutral-400">삭제됨</span>;

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className="ml-2 text-[11px] text-neutral-400 hover:text-rose-500 disabled:opacity-50"
      title="휴지통으로 이동"
    >
      {busy ? "..." : "🗑"}
    </button>
  );
}
