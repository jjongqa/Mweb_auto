"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SaveSuiteButton({ jobId, defaultName }: { jobId: string; defaultName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);

  async function save() {
    if (!name.trim()) { setError("이름을 입력하세요"); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/suites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_job_id: jobId, name: name.trim(), note: note.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error || "저장 실패"); return; }
      setSavedId(json.suiteId);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (savedId) {
    return (
      <button
        onClick={() => router.push("/suites")}
        className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100"
      >
        ✓ 스위트 저장됨 — 보러가기 →
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => { setName(defaultName); setNote(""); setError(""); setOpen(true); }}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
      >
        📁 스위트로 저장
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-neutral-900">회귀 스위트로 저장</h3>
            <p className="mt-1 text-xs text-neutral-500">이 잡의 파일/도메인/플랫폼/환경/모델/필터를 저장해 한 번에 재실행합니다.</p>
            <label className="mt-3 block">
              <div className="mb-1 text-xs font-medium text-neutral-700">스위트 이름</div>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" placeholder="예: 멤버스 web 스모크" />
            </label>
            <label className="mt-2 block">
              <div className="mb-1 text-xs font-medium text-neutral-700">메모 (선택)</div>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </label>
            {error && <div className="mt-2 text-xs text-rose-600">⚠ {error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">취소</button>
              <button onClick={save} disabled={busy} className="rounded-md bg-kurly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kurly-600 disabled:opacity-50">{busy ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
