"use client";

// 생성 결과가 맘에 안 들 때 — 피드백 주고 개선 재생성. 이전 CSV + 피드백 → 새 개선 잡.
import { useState } from "react";
import { useRouter } from "next/navigation";

// basePath: 재생성된 잡으로 이동할 경로 (/tc-gen 또는 /qa-design)
export function RefinePanel({ id, basePath = "/tc-gen" }: { id: string; basePath?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!text.trim()) { setErr("개선할 내용을 입력해 주세요"); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/tc-gen/${id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: text.trim() }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || "개선 재생성 실패"); return; }
      router.push(`${basePath}/${j.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-neutral-700">결과가 아쉬운가요? 개선 재생성</div>
            <div className="mt-0.5 text-xs text-neutral-500">이전 TC + 피드백으로 다시 생성합니다. 예: &quot;P1 너무 적음, 경계값 더 많이&quot; / &quot;승인상태 매트릭스 누락&quot;</div>
          </div>
          <button onClick={() => { setErr(""); setText(""); setOpen(true); }} className="shrink-0 rounded-md border border-violet-300 bg-white px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50">✏️ 개선 지시</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-violet-200 p-4">
      <div className="text-sm font-semibold text-neutral-700">개선 지시</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        autoFocus
        placeholder={"이전 생성 결과에서 고치고 싶은 점을 구체적으로.\n예) 비정상 케이스가 부족함 — 권한 없는 사용자/만료 토큰/동시성 케이스 추가\n예) 멤버스 vs 비멤버스 혜택가 분기 TC가 빠졌음\n예) Test Steps 가 너무 거침 — 클릭 단위로 더 잘게"}
        className="input mt-2 font-sans text-sm"
      />
      {err && <div className="mt-1 text-xs text-rose-600">⚠ {err}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">취소</button>
        <button onClick={submit} disabled={busy} className="rounded-md bg-violet-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50">{busy ? "재생성 시작..." : "🔁 개선 재생성"}</button>
      </div>
    </div>
  );
}
