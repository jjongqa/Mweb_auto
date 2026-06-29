"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/app/_components/confirm-dialog";

export function LabelCell({ name, label }: { name: string; label: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = value.trim();
    // 빈 값이면 저장하지 않고 닫기 — 의도치 않은 별칭 제거 방지
    // 별칭 제거하려면 ✕ 옆 🗑️ 버튼 사용
    if (!trimmed) {
      setValue(label || "");
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/workers/${encodeURIComponent(name)}/label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`저장 실패: ${j.error ?? res.statusText}`);
        return;
      }
      setEditing(false);
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "별칭 제거",
      body: `별칭 "${label}" 을 제거합니다.`,
      okLabel: "제거",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/workers/${encodeURIComponent(name)}/label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`제거 실패: ${j.error ?? res.statusText}`);
        return;
      }
      setEditing(false);
      setValue("");
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setValue(label || "");
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          placeholder="예: 안종관 Mac"
          maxLength={100}
          className="w-32 rounded border border-kurly-300 px-1.5 py-0.5 text-xs outline-none focus:border-kurly-500"
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-kurly-500 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-kurly-600 disabled:opacity-50"
        >
          ✓
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-700 hover:bg-neutral-300"
        >
          ✕
        </button>
        {label && (
          <button
            onClick={remove}
            disabled={saving}
            title="별칭 제거"
            className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700 hover:bg-rose-200"
          >
            🗑️
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="group flex cursor-pointer items-center gap-1.5"
      title="클릭해서 별칭 편집"
    >
      <span className={label ? "font-medium" : "text-neutral-400 italic"}>
        {label || "(별칭 없음)"}
      </span>
      <span className="text-[10px] text-neutral-300 group-hover:text-neutral-500">✏️</span>
    </div>
  );
}
