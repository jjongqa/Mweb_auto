"use client";

// 꺼진(offline) 워커 등록 행 삭제 — 퇴사자/테스트 워커 잔재 정리용.
// 삭제는 어드민 PC(localhost 접속)에서만 가능 — 다른 사람은 LAN IP로 접속해 버튼이 보이지 않음(서버도 차단).
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/app/_components/confirm-dialog";

const OWNER_HOSTS = ["localhost", "127.0.0.1", "::1"];

export function DeleteWorkerButton({ name, label }: { name: string; label: string }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState("");
  const [isOwner, setIsOwner] = useState(false);

  // 어드민이 도는 PC(localhost)에서 볼 때만 삭제 가능. SSR/타 PC 에서는 렌더 안 함.
  useEffect(() => {
    setIsOwner(OWNER_HOSTS.includes(window.location.hostname));
  }, []);

  async function remove() {
    const ok = await confirmDialog({
      title: "워커 삭제",
      body: `"${label}" (${name}) 등록을 목록에서 제거합니다.\n\n과거 잡 기록에는 영향 없음. 워커를 다시 켜면 자동 재등록됩니다.`,
      okLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    startBusy(async () => {
      setErr("");
      const res = await fetch(`/api/workers/${encodeURIComponent(name)}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErr(j.error || "삭제 실패"); return; }
      router.refresh();
    });
  }

  if (!isOwner) return null; // 어드민 PC(localhost) 외에는 삭제 버튼 숨김

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
        title="꺼진 워커 등록 제거"
      >
        {busy ? "..." : "🗑"}
      </button>
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </span>
  );
}
