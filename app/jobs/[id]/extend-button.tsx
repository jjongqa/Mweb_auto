"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ExtendButton({
  jobId,
  status,
  done,
}: {
  jobId: string;
  status: string;
  done: number;
}) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [error, setError] = useState("");

  function submit() {
    startBusy(async () => {
      setError("");
      const res = await fetch(`/api/jobs/${jobId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: focus.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "추가 검증 실패");
        return;
      }
      router.push(`/jobs/${json.newJobId}`);
    });
  }

  const statusLabel = ({ failed: "실패", canceled: "취소", succeeded: "성공" } as Record<string, string>)[status] ?? status;

  return (
    <div className="card border-l-4 border-l-purple-400 bg-purple-50/40 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-purple-800">🔬 추가 검증</div>
          <div className="mt-0.5 text-xs text-neutral-700">
            {statusLabel}된 이 Job 에서 다룬 <strong>{done}건은 보존</strong>하고,
            <strong> 새로운 시나리오</strong>를 추가로 도출/검증합니다.
            report.md 의 <code className="rounded bg-white px-1 py-0.5">의문점 / 추가 검증 필요</code> 또는{" "}
            <code className="rounded bg-white px-1 py-0.5">추천 다음 액션</code> 항목을 가이드로 붙여넣어도 좋아요.
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          disabled={busy}
          className="whitespace-nowrap rounded-md bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-50"
        >
          🔬 추가 검증 시작
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="w-[560px] max-w-[92vw] rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-purple-800">🔬 추가 검증 가이드 (선택)</h3>
            <p className="mt-2 text-xs text-neutral-600">
              자유롭게 입력. 비워두면 Claude 가 report.md 의 추가 검증 필요 / 추천 다음 액션 + 미검증 엣지/부정 케이스를 알아서 도출합니다.
            </p>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder={`예: 결제 페이지 진입 후 정률/정액 할인 혼합 사용 시 계산 결과 검증 / 비로그인 → 마이쿠폰 진입 시 인증 가드`}
              rows={8}
              className="mt-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
              maxLength={5000}
            />
            {error && (
              <div className="mt-2 rounded border-l-4 border-rose-400 bg-rose-50 p-2 text-xs text-rose-700">
                ⚠ {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="rounded-md bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-50"
              >
                {busy ? "준비 중..." : "🔬 추가 검증 시작"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
