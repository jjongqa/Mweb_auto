"use client";

import Link from "next/link";
import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Job } from "@/lib/db";
import { formatDateTimeKR, formatDuration } from "@/lib/format-date";
import { confirmDialog } from "@/app/_components/confirm-dialog";
import { useBu, BuTabs } from "@/app/_components/bu-domain-select";
import { getDomainById } from "@/lib/domains";

const HISTORY_FILTER_KEY = "kurly-qa:history:filter-name";
const MY_NAME_KEY = "kurly-qa:jira-settings:my-name";

export type JobGroup = {
  root: Job;
  retries: Job[];
  cumulative: { passed: number; failed: number; blocked: number; retryCount: number } | null;
  // 에이전트 멀티 분할 그룹(chunk_group_id) — retries 에 형제 청크가 들어감.
  isChunkGroup?: boolean;
  chunkTotal?: number;
  aggregate?: { passed: number; failed: number; blocked: number; total: number; chunkCount: number } | null;
};

const stripChunkPrefix = (s: string) => s.replace(/^\[\d+\/\d+\]\s*/, "");
const stripAgentSuffix = (s: string) => s.replace(/\s*\[[^\]]+\]\s*$/, "");

export function HistoryTable({ groups, workerLabels = {} }: { groups: JobGroup[]; workerLabels?: Record<string, string> }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  // F8 요청자 필터 ("내 잡만")
  // localStorage 는 client 전용 — 렌더 본문에서 직접 읽으면 SSR("") ↔ client 첫 렌더 불일치(hydration warning).
  // 둘 다 useEffect 로 마운트 후 채운다.
  const [filterName, setFilterName] = useState<string>("");
  const [myName, setMyName] = useState<string>("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_FILTER_KEY); if (saved) setFilterName(saved);
      setMyName(localStorage.getItem(MY_NAME_KEY) ?? "");
    } catch {}
  }, []);
  const changeFilter = (v: string) => {
    setFilterName(v);
    try { v ? localStorage.setItem(HISTORY_FILTER_KEY, v) : localStorage.removeItem(HISTORY_FILTER_KEY); } catch {}
  };

  // 검색 / 상태 / 도메인 필터 (세션 한정 — 새로고침 시 초기화)
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");   // "" | succeeded | failed | canceled | active
  const [domainFilter, setDomainFilter] = useState("");
  const bu = useBu(); // 커머스/물류 토글 (BuProvider 가 history 페이지에서 감쌈)

  const names = Array.from(new Set(groups.map((g) => g.root.requested_by).filter(Boolean))) as string[];
  // 도메인 옵션은 현재 BU(커머스/물류)에 속한 잡의 도메인만 — 토글 따라 분기.
  const domains = Array.from(new Set(
    groups
      .filter((g) => (getDomainById(g.root.domain)?.bu ?? "커머스") === bu)
      .map((g) => g.root.domain)
      .filter(Boolean)
  )) as string[];

  // BU 전환 시 이전 BU 도메인 필터값은 초기화(다른 BU 도메인이 남아 빈 결과 되는 것 방지).
  useEffect(() => { setDomainFilter(""); }, [bu]);

  const q = search.trim().toLowerCase();
  const shownGroups = groups.filter((g) => {
    const r = g.root;
    if ((getDomainById(r.domain)?.bu ?? "커머스") !== bu) return false; // BU 분기(커머스/물류)
    if (filterName && r.requested_by !== filterName) return false;
    if (domainFilter && r.domain !== domainFilter) return false;
    if (statusFilter) {
      if (statusFilter === "active") { if (r.status !== "pending" && r.status !== "running") return false; }
      else if (r.status !== statusFilter) return false;
    }
    if (q) {
      const hay = `${r.tc_filename} ${r.task_name ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const filtersActive = !!(filterName || statusFilter || domainFilter || q);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function deleteOne(id: string, label: string, hasChildren: boolean) {
    const ok = await confirmDialog({
      title: hasChildren ? "테스트 + 재실행 후손 삭제" : "테스트 삭제",
      body: hasChildren
        ? `${label}\n\n이 테스트와 모든 재실행 후손이 함께 삭제됩니다.`
        : `${label}`,
      okLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    setBusy(id, true);
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        alert(`삭제 실패: ${json.error ?? res.statusText}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(id, false);
    }
  }

  // 청크 그룹 등 여러 잡 일괄 삭제 (클라이언트에서 순차 DELETE — 서버 카스케이드 없는 형제 청크용).
  async function deleteJobs(ids: string[], title: string, body: string) {
    const ok = await confirmDialog({ title, body, okLabel: "삭제", danger: true });
    if (!ok) return;
    setBusy(ids[0], true);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
        if (!res.ok) { const j = await res.json().catch(() => ({})); alert(`삭제 실패: ${j.error ?? res.statusText}`); break; }
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(ids[0], false);
    }
  }

  async function deleteAll() {
    const ok = await confirmDialog({
      title: "종료된 테스트 일괄 삭제",
      body: "종료된(succeeded / failed / canceled) 모든 테스트를 삭제합니다.\n\n실행 중 / 대기 중 테스트는 보호됩니다.",
      okLabel: "일괄 삭제",
      danger: true,
    });
    if (!ok) return;
    setBusy("__all__", true);
    try {
      const res = await fetch("/api/jobs", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        alert(`삭제 실패: ${json.error ?? res.statusText}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy("__all__", false);
    }
  }

  return (
    <>
      <div className="mt-4"><BuTabs /></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="파일명 · 과제명 검색"
            className="w-48 rounded border border-neutral-300 px-2.5 py-1 text-xs"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1 text-xs"
          >
            <option value="">상태 전체</option>
            <option value="succeeded">성공</option>
            <option value="failed">실패</option>
            <option value="canceled">취소</option>
            <option value="active">진행 중/대기</option>
          </select>
          {domains.length > 1 && (
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              <option value="">도메인 전체</option>
              {domains.map((d) => (<option key={d} value={d}>{getDomainById(d)?.label ?? d}</option>))}
            </select>
          )}
          {names.length > 0 && (
            <select
              value={filterName}
              onChange={(e) => changeFilter(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
              title="요청자"
            >
              <option value="">요청자 전체</option>
              {names.map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          )}
          {myName && names.includes(myName) && filterName !== myName && (
            <button onClick={() => changeFilter(myName)} className="rounded border border-kurly-300 px-2 py-1 text-kurly-600 hover:bg-kurly-50">내 잡만</button>
          )}
          {filtersActive && (
            <button
              onClick={() => { changeFilter(""); setSearch(""); setStatusFilter(""); setDomainFilter(""); }}
              className="text-neutral-400 hover:text-neutral-600"
            >
              × 필터 해제
            </button>
          )}
          <span className="text-neutral-400">
            {filtersActive ? `${shownGroups.length} / ${groups.length}건` : `${groups.length}건`}
          </span>
          <Link href="/compare" className="ml-1 text-neutral-500 hover:text-kurly-600">결과 비교 →</Link>
        </div>
        <button
          onClick={deleteAll}
          disabled={busyIds.has("__all__") || groups.length === 0}
          className="rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          {busyIds.has("__all__") ? "삭제 중..." : "전체 삭제 (종료된 테스트)"}
        </button>
      </div>

      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[1280px] text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 w-10"></th>
              <th className="whitespace-nowrap px-4 py-3">파일명 / 과제명</th>
              <th className="whitespace-nowrap px-4 py-3">도메인</th>
              <th className="whitespace-nowrap px-4 py-3">플랫폼</th>
              <th className="whitespace-nowrap px-4 py-3">환경</th>
              <th className="whitespace-nowrap px-4 py-3">모드</th>
              <th className="whitespace-nowrap px-4 py-3">워커</th>
              <th className="whitespace-nowrap px-4 py-3">상태</th>
              <th className="whitespace-nowrap px-4 py-3">결과 (누적)</th>
              <th className="whitespace-nowrap px-4 py-3">실행시간</th>
              <th className="whitespace-nowrap px-4 py-3">시작</th>
              <th className="whitespace-nowrap px-4 py-3 w-16">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shownGroups.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-neutral-400">
                  {groups.length === 0 ? "실행 기록이 없습니다." : "필터 조건에 맞는 기록이 없습니다."}
                </td>
              </tr>
            ) : (
              shownGroups.flatMap((g) => {
                const open = expanded.has(g.root.id);
                const chunkInfo = g.isChunkGroup
                  ? { chunkCount: g.aggregate?.chunkCount ?? g.retries.length + 1, agg: g.aggregate ?? null }
                  : null;
                const rows = [
                  <Row
                    key={g.root.id}
                    job={g.root}
                    isRetry={false}
                    retryCount={g.retries.length}
                    expanded={open}
                    onToggle={() => toggle(g.root.id)}
                    cumulative={g.cumulative}
                    chunkInfo={chunkInfo}
                    onDelete={() =>
                      g.isChunkGroup
                        ? deleteJobs(
                            [g.root.id, ...g.retries.map((r) => r.id)],
                            "에이전트 멀티 수행 삭제",
                            `${stripAgentSuffix(g.root.task_name || stripChunkPrefix(g.root.tc_filename))}\n\n에이전트 ${chunkInfo?.chunkCount ?? g.retries.length + 1}개 청크가 함께 삭제됩니다.`
                          )
                        : deleteOne(
                            g.root.id,
                            `${g.root.tc_filename}${g.retries.length ? ` (+재실행 ${g.retries.length}건)` : ""}`,
                            g.retries.length > 0
                          )
                    }
                    busy={busyIds.has(g.root.id)}
                    workerLabels={workerLabels}
                  />,
                ];
                if (open) {
                  for (const r of g.retries) {
                    rows.push(
                      <Row
                        key={r.id}
                        job={r}
                        isRetry={true}
                        retryCount={0}
                        expanded={false}
                        onToggle={null}
                        cumulative={null}
                        chunkInfo={null}
                        onDelete={() => deleteOne(r.id, r.tc_filename, false)}
                        busy={busyIds.has(r.id)}
                        workerLabels={workerLabels}
                      />
                    );
                  }
                }
                return rows;
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({
  job: j,
  isRetry,
  retryCount,
  expanded,
  onToggle,
  cumulative,
  chunkInfo,
  onDelete,
  busy,
  workerLabels,
}: {
  job: Job;
  isRetry: boolean;
  retryCount: number;
  expanded: boolean;
  onToggle: (() => void) | null;
  cumulative: JobGroup["cumulative"];
  chunkInfo: { chunkCount: number; agg: { passed: number; failed: number; blocked: number; total: number } | null } | null;
  onDelete: () => void;
  busy: boolean;
  workerLabels: Record<string, string>;
}) {
  const canDelete = j.status !== "running" && j.status !== "pending";
  return (
    <tr className={isRetry ? "bg-neutral-50/60 hover:bg-neutral-50" : "hover:bg-neutral-50"}>
      <td className="px-4 py-3 align-top">
        {onToggle && retryCount > 0 ? (
          <button
            onClick={onToggle}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200"
            aria-label={expanded ? "접기" : "펼치기"}
            title={chunkInfo ? `에이전트 ${chunkInfo.chunkCount}명 ${expanded ? "접기" : "펼치기"}` : (expanded ? "접기" : `재실행 ${retryCount}건 펼치기`)}
          >
            {expanded ? "▼" : "▶"} <span className="text-[10px]">{chunkInfo ? chunkInfo.chunkCount : retryCount}</span>
          </button>
        ) : null}
      </td>
      <td className={`px-4 py-3 min-w-[300px] max-w-[500px] ${isRetry ? "pl-10" : ""}`}>
        <Link href={`/jobs/${j.id}`} className="block">
          <div className="font-medium text-kurly-500 hover:underline break-all">
            {isRetry && <span className="mr-1 text-neutral-400">↳</span>}
            {chunkInfo ? stripChunkPrefix(j.tc_filename) : j.tc_filename}
            {chunkInfo && (
              <span className="ml-2 align-middle rounded bg-kurly-100 px-1.5 py-0.5 text-[10px] font-medium text-kurly-700">🎮 에이전트 {chunkInfo.chunkCount}명</span>
            )}
          </div>
          {j.task_name && (
            <div className="mt-0.5 text-xs text-neutral-500 break-all">
              {(chunkInfo ? stripAgentSuffix(j.task_name) : j.task_name).replace(/__RETRY_ENCOURAGE__/g, "")}
            </div>
          )}
        </Link>
        {j.requested_by && (
          <span className="mt-1 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">{j.requested_by}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">{j.domain}</td>
      <td className="whitespace-nowrap px-4 py-3 text-xs">{j.platform === "app" ? "App" : j.platform === "mweb" ? "Mweb" : "Web"}</td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{j.qa_env}</td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={`badge ${j.mode === "real" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {j.mode === "real" ? "REAL" : "MOCK"}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs">
        {j.worker_name ? (
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700" title={j.worker_name}>{workerLabels[j.worker_name] || j.worker_name}</span>
        ) : (
          <span className="text-neutral-400">-</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <Status s={j.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
        {chunkInfo && chunkInfo.agg ? (
          <div>
            <div>
              <span className="text-emerald-600">{chunkInfo.agg.passed}P</span>{" · "}
              <span className="text-rose-600">{chunkInfo.agg.failed}F</span>{" · "}
              <span className="text-amber-600">{chunkInfo.agg.blocked}B</span>{" / "}
              <span>{chunkInfo.agg.total}</span>
            </div>
            <div className="mt-1 text-[11px] text-kurly-600">🎮 에이전트 {chunkInfo.chunkCount} 합산</div>
          </div>
        ) : j.total > 0 ? (
          <div>
            <div>
              <span className="text-emerald-600">{j.passed}P</span>{" · "}
              <span className="text-rose-600">{j.failed}F</span>{" · "}
              <span className="text-amber-600">{j.blocked}B</span>{" / "}
              <span>{j.total}</span>
            </div>
            {cumulative && cumulative.retryCount > 0 && (
              <div className="mt-1 text-[11px] text-indigo-600">
                ↻ 누적: <span className="font-medium">{cumulative.passed}P · {cumulative.failed}F · {cumulative.blocked}B</span> ({cumulative.retryCount}회 재실행)
              </div>
            )}
          </div>
        ) : ("-")}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
        {j.duration_sec != null ? formatDuration(j.duration_sec) : (j.status === "running" ? "진행 중…" : "-")}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
        {formatDateTimeKR(j.created_at)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <button
          onClick={onDelete}
          disabled={busy || !canDelete}
          className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30"
          title={canDelete ? (retryCount > 0 ? `재실행 ${retryCount}건 포함 삭제` : "삭제") : "실행/대기 중은 삭제 불가"}
        >
          {busy ? "..." : "🗑"}
        </button>
      </td>
    </tr>
  );
}

function Status({ s }: { s: string }) {
  const styles: Record<string, string> = {
    pending: "bg-neutral-100 text-neutral-700",
    running: "bg-blue-100 text-blue-700",
    succeeded: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
    canceled: "bg-neutral-100 text-neutral-500",
  };
  const labels: Record<string, string> = {
    pending: "대기", running: "실행 중", succeeded: "성공", failed: "실패", canceled: "취소",
  };
  return <span className={`badge ${styles[s] ?? ""}`}>{labels[s] ?? s}</span>;
}
