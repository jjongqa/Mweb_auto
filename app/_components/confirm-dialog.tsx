"use client";

// native confirm() 대체 — 멀티라인 본문/danger 강조/키보드 ESC 지원.
//
// 사용:
//   import { confirmDialog } from "@/app/_components/confirm-dialog";
//   if (!(await confirmDialog({ title: "삭제 확인", body: "...", danger: true }))) return;
//
// React 18+ createRoot 로 마운트 → 본문에 portal 처럼 동작. Provider 불필요.

import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface ConfirmOptions {
  title?: string;
  body: string;            // \n 줄바꿈 지원
  okLabel?: string;        // 기본 "확인"
  cancelLabel?: string;    // 기본 "취소"
  danger?: boolean;        // OK 버튼 빨간색 강조
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const close = (ok: boolean) => {
      try { root.unmount(); } catch {}
      try { container.remove(); } catch {}
      resolve(ok);
    };
    root.render(<ConfirmDialogContent opts={opts} onClose={close} />);
  });
}

function ConfirmDialogContent({ opts, onClose }: { opts: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close(ok: boolean) {
    if (closing) return;
    setClosing(true);
    onClose(ok);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => close(false)}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {opts.title && (
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">{opts.title}</h3>
        )}
        <div className="whitespace-pre-wrap break-words text-sm text-neutral-700">{opts.body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => close(false)}
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            {opts.cancelLabel ?? "취소"}
          </button>
          <button
            autoFocus
            onClick={() => close(true)}
            className={
              opts.danger
                ? "rounded bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600"
                : "rounded bg-kurly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kurly-600"
            }
          >
            {opts.okLabel ?? "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
