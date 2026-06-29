"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Message = {
  id: number;
  job_id: string;
  content: string;
  status: "pending" | "delivered" | "failed";
  created_at: string;
  delivered_at: string | null;
};

export function MessagePanel({ jobId, jobStatus }: { jobId: string; jobStatus: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  const isActive = jobStatus === "running" || jobStatus === "pending";

  // 메시지 목록 polling (2초)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/jobs/${jobId}/messages`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json.messages)) setMessages(json.messages);
      } catch (_) {}
    }
    load();
    if (isActive) timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobId, isActive]);

  async function send() {
    setError("");
    const text = content.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "전송 실패");
        return;
      }
      setContent("");
      // 즉시 목록에 반영 + 잡 새로고침
      setMessages((prev) => [...prev, json.message]);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  // 종료된 잡인데 메시지 이력 없으면 패널 자체를 숨김
  if (!isActive && messages.length === 0) return null;

  return (
    <div className="card border-l-4 border-l-indigo-400 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-indigo-700">
          🗨️ Claude 에게 추가 명령 보내기
          {messages.length > 0 && (
            <span className="ml-2 text-xs font-normal text-neutral-400">
              · 전송 {messages.length}건 (대기 {messages.filter(m => m.status === "pending").length})
            </span>
          )}
        </h2>
        {!isActive && <span className="text-xs text-neutral-400">종료된 테스트 (이력만 표시)</span>}
      </div>

      {isActive && (
        <>
          <p className="mt-2 text-xs text-neutral-500">
            현재 turn 끝나면 다음 단계에 반영됩니다. (예: <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">모바일 해상도도 같이 확인해줘</code>)
          </p>

          {error && (
            <div className="mt-2 rounded border-l-4 border-rose-400 bg-rose-50 p-2 text-xs text-rose-800">
              {error}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Claude 에게 보낼 메시지 (⌘/Ctrl + Enter 로 전송)"
              className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              maxLength={4000}
            />
            <button
              onClick={send}
              disabled={submitting || !content.trim()}
              className="self-stretch rounded bg-indigo-500 px-4 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              {submitting ? "전송 중..." : "전송"}
            </button>
          </div>
        </>
      )}

      {messages.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-neutral-600 mb-1.5">전송 이력</div>
          <ul className="space-y-1.5 text-xs">
            {messages.map((m) => (
              <li key={m.id} className="flex items-start gap-2 rounded border border-neutral-200 bg-neutral-50 p-2">
                <span
                  className={`mt-0.5 inline-block min-w-[60px] rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${
                    m.status === "delivered"
                      ? "bg-emerald-100 text-emerald-700"
                      : m.status === "failed"
                      ? "bg-rose-100 text-rose-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {m.status === "delivered" ? "✓ 전달됨" : m.status === "failed" ? "✗ 실패" : "⏳ 대기"}
                </span>
                <span className="flex-1 whitespace-pre-wrap text-neutral-800">{m.content}</span>
                <span className="text-neutral-400">{m.created_at.slice(11, 19)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
