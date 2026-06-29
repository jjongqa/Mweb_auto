"use client";

import { useEffect, useState } from "react";

function fmtAgo(iso: string | null): string {
  if (!iso) return "아직 없음";
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return new Date(iso).toLocaleString("ko-KR");
}

// 자동 동기화는 작업 시작 시 하루 1회. 그 사이엔 로컬 사용. 필요할 때 "갱신" 버튼으로 즉시 최신화.
export function DriveSyncCard() {
  const [last, setLast] = useState<{ lastSyncAt: string | null; fileCount: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    fetch("/api/drive-sync").then((r) => r.json()).then(setLast).catch(() => {});
  }, []);

  async function runSync() {
    if (syncing) return;
    setSyncing(true);
    setProgress("갱신 시작…");
    try {
      const res = await fetch("/api/drive-sync", { method: "POST" });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.kind === "progress" && msg.event?.message) setProgress(msg.event.message);
            else if (msg.kind === "done") setProgress("완료 — 목록 새로고침…");
            else if (msg.kind === "fatal") setProgress("실패: " + msg.error);
          } catch { /* skip */ }
        }
      }
      window.location.reload(); // 캐시 무효화됨 → 새로고침하면 최신 목록·상태 반영
    } catch (e) {
      setProgress("실패: " + (e instanceof Error ? e.message : String(e)));
      setSyncing(false);
    }
  }

  return (
    <section className="card border-l-4 border-l-kurly-400 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <h2 className="text-sm font-semibold text-neutral-700">☁️ Drive 동기화</h2>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">자동 · 하루 1회</span>
        </div>
        <button
          onClick={runSync}
          disabled={syncing}
          className="shrink-0 rounded-md bg-kurly-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-kurly-600 disabled:opacity-50"
        >
          {syncing ? "갱신 중…" : "↻ 갱신"}
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-600 leading-relaxed">
        스킬·정책·프롬프트는 <strong>작업(설계/TC생성/기능테스트) 시작 시 하루 1회 자동 동기화</strong>돼요. 그 사이엔 로컬을 그대로 씁니다 —
        Drive를 방금 고쳤다면 <strong>갱신</strong> 버튼으로 즉시 최신화하세요.
        <br />
        마지막 갱신: <strong className="text-neutral-800">{last ? fmtAgo(last.lastSyncAt) : "…"}</strong>
        {last && last.fileCount > 0 && <span className="text-neutral-400"> · 누적 {last.fileCount}개</span>}
        {syncing && progress && (
          <>
            <br />
            <span className="text-kurly-500">{progress}</span>
          </>
        )}
      </p>
    </section>
  );
}
