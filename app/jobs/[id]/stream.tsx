"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Job, JobLog } from "@/lib/db";
import { confirmDialog } from "@/app/_components/confirm-dialog";

type Initial = Job & { logs: JobLog[] };

export function JobStream({ jobId, initial }: { jobId: string; initial: Initial }) {
  const router = useRouter();
  const [job, setJob] = useState<Job>(initial);
  const [logs, setLogs] = useState<JobLog[]>(initial.logs);
  const [canceling, setCanceling] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);  // 사용자가 위로 올렸으면 자동 스크롤 안 함

  useEffect(() => {
    const isTerminal = ["succeeded", "failed", "canceled"].includes(initial.status);
    if (isTerminal) return;

    const lastId = initial.logs.at(-1)?.id ?? 0;
    const url = `/api/jobs/${jobId}/stream?since=${lastId}`;
    const es = new EventSource(url);

    es.addEventListener("update", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      if (data.job) setJob(data.job);
      if (Array.isArray(data.logs) && data.logs.length > 0) {
        setLogs((prev) => [...prev, ...data.logs]);
      }
      if (["succeeded", "failed", "canceled"].includes(data.job?.status)) {
        es.close();
        // v0.4b: 작업 완료 시 SSR 영역 (결과 파일, 재실행 버튼) 다시 그리기
        // result_dir 의 summary.csv 가 디스크에 저장될 시간 약간 줌
        setJustCompleted(true);
        setTimeout(() => {
          router.refresh();
        }, 1500);
      }
    });

    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId, initial.status, initial.logs, router]);

  // 로그 컨테이너만 자동 스크롤 (페이지 viewport 는 건드리지 않음)
  // 사용자가 위로 올려두면 자동 스크롤 안 함 — 이전 로그 보기 가능
  useEffect(() => {
    const el = logsContainerRef.current;
    if (!el || userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  function onLogsScroll() {
    const el = logsContainerRef.current;
    if (!el) return;
    // 바닥에서 30px 이내면 follow-mode, 그보다 위로 올렸으면 사용자 의도로 보고 자동 스크롤 중단
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    userScrolledUpRef.current = !atBottom;
  }

  async function onCancel() {
    const ok = await confirmDialog({
      title: "작업 중단",
      body: "진행 중인 작업이 즉시 멈춥니다. 계속할까요?",
      okLabel: "중단",
      danger: true,
    });
    if (!ok) return;
    setCanceling(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`중단 실패: ${j.error ?? res.statusText}`);
      }
    } finally {
      setCanceling(false);
    }
  }

  const done = job.passed + job.failed + job.blocked;
  const pct = job.total > 0 ? Math.round((done / job.total) * 100) : 0;
  const isRunning = ["pending", "running"].includes(job.status);
  const cancelRequested = job.cancel_requested === 1;

  // 시간 추정 — total 모르거나(애드혹 초기) remaining≤0 면 표시 안 함
  const eta = (() => {
    if (!isRunning || done === 0 || !job.started_at) return null;
    if (job.total <= 0) return null;  // 애드혹: total 미정
    const remaining = job.total - done;
    if (remaining <= 0) return null;  // 이미 다 끝남 — 음수 방지
    const startMs = new Date(job.started_at + (job.started_at.includes("T") ? "" : "Z")).getTime();
    const elapsedMs = Date.now() - startMs;
    if (elapsedMs <= 0) return null;
    const perCaseMs = elapsedMs / done;
    return Math.max(0, Math.ceil((perCaseMs * remaining) / 1000));
  })();

  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-neutral-500">
            진행률
            {job.retry_type === "continue" && (
              <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                ▶ 이어서
              </span>
            )}
            {job.retry_type === "extend" && (
              <span className="ml-1.5 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                🔬 추가 검증
              </span>
            )}
          </span>
          <span className="font-mono">
            {job.total > 0
              ? `${done} / ${job.total} (${pct}%)`
              : `진행 중 · ${done}건 처리됨`}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full bg-kurly-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {eta !== null && (
          <div className="mt-1.5 text-right text-[11px] text-neutral-500">
            ⏱ 남은 시간: 약 {formatEta(eta)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <Stat label="상태" value={statusLabel(job.status)} />
        <Stat label="PASS" value={String(job.passed)} className="text-emerald-600" />
        <Stat label="FAIL" value={String(job.failed)} className="text-rose-600" />
        <Stat label="BLOCKED" value={String(job.blocked)} className="text-amber-600" />
      </div>

      {isRunning && (
        <button
          onClick={onCancel}
          disabled={canceling || cancelRequested}
          className="w-full rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
          {cancelRequested ? "중단 요청됨..." : canceling ? "중단 중..." : "⏹ 작업 중단"}
        </button>
      )}

      {justCompleted && !isRunning && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          ✓ 작업 완료 — 결과 파일 / 재실행 버튼 불러오는 중...
        </div>
      )}

      <div className="rounded-md border border-neutral-200 bg-neutral-950 p-3">
        <div className="mb-1 text-xs text-neutral-500">실시간 로그</div>
        <div
          ref={logsContainerRef}
          onScroll={onLogsScroll}
          className="h-56 overflow-y-auto font-mono text-xs leading-relaxed text-neutral-200"
        >
          {logs.length === 0 ? (
            <div className="text-neutral-500">로그 대기 중...</div>
          ) : (
            logs.map((l) => (
              <div key={l.id}>
                <span className="text-neutral-500">[{formatLogTimeKST(l.ts)}]</span>{" "}
                <span className={levelColor(l.level)}>{l.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {job.error_message && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <strong>에러:</strong> {job.error_message}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md border border-neutral-200 py-2">
      <div className="text-neutral-500">{label}</div>
      <div className={`mt-0.5 font-semibold ${className}`}>{value}</div>
    </div>
  );
}

function statusLabel(s: string) {
  return ({ pending: "대기", running: "실행 중", succeeded: "성공", failed: "실패", canceled: "취소" } as Record<string, string>)[s] ?? s;
}
function levelColor(level: string) {
  return level === "error" ? "text-rose-400" : level === "warn" ? "text-amber-300" : "text-neutral-200";
}
// DB의 ts 는 UTC (sqlite datetime('now')) — 화면엔 KST 로 변환해서 표시
function formatLogTimeKST(ts: string): string {
  try {
    const iso = ts.includes("T") ? ts : ts.replace(" ", "T") + "Z";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return ts.split(" ")[1] ?? ts;
    return d.toLocaleTimeString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" });
  } catch {
    return ts.split(" ")[1] ?? ts;
  }
}

function formatEta(sec: number): string {
  if (sec < 60) return `${sec}초`;
  if (sec < 3600) return `${Math.ceil(sec / 60)}분`;
  const h = Math.floor(sec / 3600);
  const m = Math.ceil((sec - h * 3600) / 60);
  return `${h}시간 ${m}분`;
}
