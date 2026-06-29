"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DataRequest = {
  id: string;
  status: "pending" | "running" | "ready" | "blocked" | "failed";
  source_agent: string | null;
  tc_ref: string | null;
  need: string;
  reason: string | null;
  inputs: string | null;
  verification: string | null;
  notes: string | null;
  error_message: string | null;
};

type ToastItem = {
  id: string;
  title: string;
  body: string;
  status: DataRequest["status"];
  sourceAgent: string;
};

function hasCredentialNeed(req: DataRequest) {
  const text = [
    req.need,
    req.reason,
    req.inputs,
    req.verification,
    req.notes,
    req.error_message,
  ].filter(Boolean).join("\n").toLowerCase();

  const credentialWords = ["lacms", "계정", "로그인", "비밀번호", "password", "인증", "credential", "권한", "입력 필요"];
  const orderWords = ["주문", "order", "배송", "결제", "클레임"];
  return credentialWords.some((w) => text.includes(w)) && orderWords.some((w) => text.includes(w));
}

function shouldToast(req: DataRequest) {
  if (!["blocked", "failed"].includes(req.status)) return false;
  return hasCredentialNeed(req);
}

function toToast(req: DataRequest): ToastItem {
  const sourceAgent = req.source_agent || "수행 에이전트";
  const reason = req.error_message || req.reason || req.notes || "테스트데이터 생성에 추가 입력이 필요합니다.";
  return {
    id: req.id,
    title: "LACMS 계정 입력이 필요해요",
    body: `${sourceAgent}의 ${req.tc_ref || "TC"} 요청이 멈췄습니다. ${reason}`,
    status: req.status,
    sourceAgent,
  };
}

export function DataRequestToast({ jobId, jobStatus }: { jobId: string; jobStatus: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const isActive = jobStatus === "running" || jobStatus === "pending";

  useEffect(() => {
    const storageKey = `data-request-toast-seen:${jobId}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) seenRef.current = new Set(saved.map(String));
    } catch {
      seenRef.current = new Set();
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const res = await fetch(`/api/data-requests?sourceJobId=${encodeURIComponent(jobId)}&limit=30`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        const requests = Array.isArray(json.requests) ? json.requests as DataRequest[] : [];
        const next = requests.filter(shouldToast).filter((req) => !seenRef.current.has(req.id));
        if (cancelled || next.length === 0) return;

        for (const req of next) seenRef.current.add(req.id);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...seenRef.current]));
        } catch {}
        setItems((prev) => [...prev, ...next.map(toToast)].slice(-3));
      } catch {
        // 토스트 감지는 보조 기능이라 네트워크 오류는 조용히 무시한다.
      }
    }

    load();
    if (isActive) timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobId, isActive]);

  const visibleItems = useMemo(() => items.slice(-3), [items]);
  if (visibleItems.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[min(380px,calc(100vw-32px))] space-y-2">
      {visibleItems.map((item) => (
        <div
          key={item.id}
          className="rounded-lg border border-amber-200 bg-white p-4 shadow-lg ring-1 ring-black/5"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  입력 필요
                </span>
                <span className="truncate text-[11px] text-neutral-400">{item.sourceAgent}</span>
              </div>
              <div className="mt-2 text-sm font-semibold text-neutral-900">{item.title}</div>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-neutral-600">{item.body}</p>
            </div>
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
              className="rounded px-1.5 py-0.5 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="토스트 닫기"
            >
              ×
            </button>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                document.getElementById("data-request-handoff")?.scrollIntoView({ behavior: "smooth", block: "start" });
                setItems((prev) => prev.filter((x) => x.id !== item.id));
              }}
              className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
            >
              요청 확인
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
