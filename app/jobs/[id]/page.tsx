import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob, getLogs, getRetryDescendants, computeCumulativeResult, getRootJob, findFlakyTcs } from "@/lib/jobs";
import { aggregateChunkGroup } from "@/lib/result-aggregation";
import { CancelGroupButton } from "./cancel-group-button";
import { ChunkGroupProgress } from "./chunk-group-progress";
import { formatDateTimeKR, formatDuration } from "@/lib/format-date";
import { JobStream } from "./stream";
import { JobContextPanel } from "./job-context-panel";
import { SaveSuiteButton } from "./save-suite-button";
import { RestartButton } from "./restart-button";
import { ContinueButton } from "./continue-button";
import { ExtendButton } from "./extend-button";
import { RetryFailButton, RetryBlockedButton } from "./retry-button";
import { Markdown } from "./markdown";
import { JiraIssuesPanel } from "./jira-panel";
import { FailBlockedListCard } from "./fail-blocked-list";
import { MessagePanel } from "./message-panel";
import { DataRequestToast } from "./data-request-toast";
import { DataRequestResumeForm } from "./data-request-resume-form";
import { listIssuesForJob, getSettings } from "@/lib/jira";
import { getWorker } from "@/lib/workers";
import { listDataRequests, type DataRequest } from "@/lib/data-requests";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseAgentFlow(notes: string | null | undefined): Record<string, string> | null {
  if (!notes) return null;
  const marker = "agentFlow:";
  const idx = notes.indexOf(marker);
  if (idx < 0) return null;
  const raw = notes.slice(idx + marker.length).trim();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, val]) => [key, String(val ?? "")])
    );
  } catch {
    return null;
  }
}

function getHumanNotes(notes: string | null | undefined): string {
  if (!notes) return "";
  const idx = notes.indexOf("agentFlow:");
  return (idx >= 0 ? notes.slice(0, idx) : notes).trim();
}

function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (/password|token|jwt|secret|authorization/i.test(key)) return [key, "********"];
      return [key, maskSecrets(val)];
    })
  );
}

function needsCredentialInput(req: DataRequest) {
  if (!["blocked", "failed"].includes(req.status)) return false;
  const text = [
    req.need,
    req.reason,
    req.inputs,
    req.verification,
    req.notes,
    req.error_message,
    req.preferred_tool,
  ].filter(Boolean).join("\n").toLowerCase();
  const credentialWords = ["lacms", "계정", "로그인", "비밀번호", "password", "인증", "credential", "권한", "입력"];
  const dataWords = ["주문", "order", "배송", "결제", "클레임", "dealproductno", "상품"];
  return credentialWords.some((w) => text.includes(w)) && dataWords.some((w) => text.includes(w));
}

function secondsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const normalize = (v: string) => {
    const hasTimezone = v.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(v);
    return hasTimezone ? v : v.replace(" ", "T") + "Z";
  };
  const s = new Date(normalize(start)).getTime();
  const e = new Date(normalize(end)).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return Math.max(0, Math.round((e - s) / 1000));
}

function requestStatusStyle(status: DataRequest["status"]) {
  if (status === "ready") return "bg-emerald-100 text-emerald-700";
  if (status === "running") return "bg-blue-100 text-blue-700";
  if (status === "pending") return "bg-neutral-100 text-neutral-600";
  if (status === "blocked") return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function requestStatusLabel(status: DataRequest["status"]) {
  return {
    pending: "대기",
    running: "처리 중",
    ready: "전달 완료",
    blocked: "차단",
    failed: "실패",
  }[status] ?? status;
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  const initialLogs = getLogs(id, 0, 500);

  // 결과 파일 (1차 — 동급 + 다운로드용)
  let resultFiles: { name: string; size: number; rel: string }[] = [];
  let screenshotsByTC: Record<string, { rel: string; name: string }[]> = {};
  if (job.result_dir && fs.existsSync(job.result_dir)) {
    const collect = (dir: string, base: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        // 내부/디버그 파일 숨김: .숨김, _mcp.json, _tc_*(입력 사본), _admin_*(프롬프트)
        if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
        const full = path.join(dir, entry.name);
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collect(full, rel);
          // TC-* 폴더의 이미지는 갤러리로 분리
          const m = rel.match(/^TC[-_]?(\w+?)(?:\/|$)/);
          // (no-op — 이미지는 아래에서 처리)
        } else {
          resultFiles.push({ name: entry.name, size: fs.statSync(full).size, rel });
          // 스크린샷 그룹화
          if (/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
            const m = rel.match(/^TC[-_]?(\w+)/);
            const key = m ? `TC-${m[1]}` : "기타";
            (screenshotsByTC[key] ??= []).push({ rel, name: entry.name });
          }
        }
      }
    };
    collect(job.result_dir, "");
    resultFiles.sort((a, b) => {
      const w = (n: string) => (n === "summary.csv" ? 0 : n === "fail-detail.csv" ? 1 : n === "report.md" ? 2 : 3);
      return w(a.name) - w(b.name) || a.rel.localeCompare(b.rel);
    });
  }

  // 애드혹 report.md 본문 (있을 때만)
  let reportMd: string | null = null;
  if (job.result_dir) {
    const reportPath = path.join(job.result_dir, "report.md");
    if (fs.existsSync(reportPath)) {
      try { reportMd = fs.readFileSync(reportPath, "utf-8"); } catch { /* ignore */ }
    }
  }

  // FAIL 케이스 추출 — fail-detail.csv 우선, 없으면 summary.csv 의 FAIL 행
  type FailItem = {
    no: string;
    priority: string;
    title: string;
    testStep: string;
    expected: string;
    actual: string;
    failReason: string;
    notes: string;
    screenshot: string;
  };
  const failItems: FailItem[] = [];
  const blockedItems: FailItem[] = [];
  const parseRow = (line: string) => {
    const out: string[] = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
      else { if (c === '"') inQ = true; else if (c === ',') { out.push(cur); cur = ""; } else cur += c; }
    }
    out.push(cur); return out.map(s => s.trim());
  };
  // CSV 전체 파싱 — quote 안의 줄바꿈을 행 분리로 오인하지 않도록 문자 단위 파싱
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = []; let row: string[] = []; let cur = ""; let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i+1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(cur); cur = ""; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (c === '\r') { /* skip */ }
        else cur += c;
      }
    }
    if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(c => c.length > 0));
  };
  const colIdx = (header: string[], ...names: string[]) => {
    // 1차: 정확 매치 (대소문자 무시)
    for (const n of names) {
      const lower = n.toLowerCase();
      const i = header.findIndex(h => h.toLowerCase() === lower);
      if (i >= 0) return i;
    }
    // 2차: partial 매치 (fallback)
    for (const n of names) {
      const lower = n.toLowerCase();
      const i = header.findIndex(h => h.toLowerCase().includes(lower));
      if (i >= 0) return i;
    }
    return -1;
  };
  if (job.result_dir) {
    // 1순위: fail-detail.csv (FAIL Reason 컬럼 있음)
    const failDetailPath = path.join(job.result_dir, "fail-detail.csv");
    const summaryPath = path.join(job.result_dir, "summary.csv");
    let useFailDetail = fs.existsSync(failDetailPath);

    if (useFailDetail) {
      try {
        const text = fs.readFileSync(failDetailPath, "utf-8").replace(/^﻿/, "");
        const rows = parseCsv(text);
        if (rows.length >= 2) {
          const header = rows[0];
          const iNo = colIdx(header, "No");
          const iPrio = colIdx(header, "Priority");
          const iTitle = colIdx(header, "TC Title", "Title");
          const iExpected = colIdx(header, "Expected Result", "Expected");
          const iActual = colIdx(header, "Actual Result", "Actual");
          const iReason = colIdx(header, "Fail Reason", "Reason");
          const iShot = colIdx(header, "Screenshot");
          for (let i = 1; i < rows.length; i++) {
            const cells = rows[i];
            failItems.push({
              no: cells[iNo] || `?-${i}`,
              priority: cells[iPrio] || "",
              title: cells[iTitle] || "(제목 없음)",
              testStep: "",
              expected: cells[iExpected] || "",
              actual: cells[iActual] || "",
              failReason: cells[iReason] || "",
              notes: "",
              screenshot: cells[iShot] || "",
            });
          }
        }
      } catch { useFailDetail = false; }
    }

    // 2순위: summary.csv — FAIL 과 BLOCKED 모두 추출
    if (fs.existsSync(summaryPath)) {
      try {
        const text = fs.readFileSync(summaryPath, "utf-8").replace(/^﻿/, "");
        const rows = parseCsv(text);
        if (rows.length >= 2) {
          const header = rows[0];
          const iNo = colIdx(header, "No");
          const iPrio = colIdx(header, "Priority");
          const iTitle = colIdx(header, "TC Title", "Title");
          const iStep = colIdx(header, "Test Step", "Step");
          const iExpected = colIdx(header, "Expected Result", "Expected");
          const iActual = colIdx(header, "Actual Result", "Actual");
          const iResult = colIdx(header, "Result");
          const iNotes = colIdx(header, "Notes");
          const iShot = colIdx(header, "Screenshot");
          for (let i = 1; i < rows.length; i++) {
            const cells = rows[i];
            const result = (cells[iResult] || "").toUpperCase();
            const item = {
              no: cells[iNo] || `?-${i}`,
              priority: cells[iPrio] || "",
              title: cells[iTitle] || "(제목 없음)",
              testStep: cells[iStep] || "",
              expected: cells[iExpected] || "",
              actual: cells[iActual] || "",
              failReason: cells[iNotes] || "",
              notes: cells[iNotes] || "",
              screenshot: cells[iShot] || "",
            };
            if (result === "BLOCKED") {
              blockedItems.push(item);
            } else if (result === "FAIL" && !useFailDetail) {
              failItems.push(item);
            }
          }
        }
      } catch { /* ignore */ }
    }
  }
  // 사용하지 않는 parseRow 경고 회피
  void parseRow;

  const jiraSettings = getSettings();
  const jiraRegistered = listIssuesForJob(id);

  const tcFilter = job.tc_filter ? JSON.parse(job.tc_filter) : null;

  // v0.4b: 재실행 관계 정보
  const isRetryJob = !!job.parent_job_id;
  const parentJob = isRetryJob && job.parent_job_id ? getJob(job.parent_job_id) : null;
  const rootJob = getRootJob(job.id);
  const retryDescendants = getRetryDescendants(job.id);
  const cumulative = !isRetryJob && job.total > 0 && retryDescendants.length > 0
    ? computeCumulativeResult(job)
    : null;

  // F5 flaky TC — 재실행 체인 전체에서 PASS↔FAIL 뒤집힌 TC. root 기준으로 1회 계산.
  const flakyTcs = rootJob ? findFlakyTcs(rootJob.id) : [];

  // Phase 2 멀티 분할 — 이 잡이 청크면 그룹 합산
  const chunkGroup = job.chunk_group_id ? aggregateChunkGroup(job.chunk_group_id) : null;
  const dataRequests = listDataRequests({ sourceJobId: job.id, limit: 100 });

  // 완료 잡 결과 요약 (히어로 배너용)
  const isFinished = ["succeeded", "failed", "canceled"].includes(job.status);
  const statusKR: Record<string, string> = { succeeded: "성공", failed: "실패", canceled: "취소", running: "실행 중", pending: "대기" };
  // 히어로 결과: 청크 그룹 멤버면 "그룹 합산"을 주 결과로 표시(단일 청크만 보여 헷갈리던 문제). 아니면 이 잡 결과.
  const inChunkGroup = !!(chunkGroup && chunkGroup.chunkCount > 1);
  const heroPassed = inChunkGroup ? chunkGroup!.passed : job.passed;
  const heroFailed = inChunkGroup ? chunkGroup!.failed : job.failed;
  const heroBlocked = inChunkGroup ? chunkGroup!.blocked : job.blocked;
  const heroTotal = inChunkGroup ? chunkGroup!.total : job.total;
  const heroStatus = inChunkGroup ? chunkGroup!.status : job.status;
  const heroRate = heroTotal > 0 ? Math.round((heroPassed / heroTotal) * 100) : 0;
  const heroRateColor = heroRate >= 90 ? "text-emerald-600" : heroRate >= 70 ? "text-amber-600" : "text-rose-600";
  const thisChunkAgent = job.task_name?.match(/\[([^\]]+)\]\s*$/)?.[1] || null;

  return (
    <div className="space-y-6">
      <DataRequestToast jobId={job.id} jobStatus={job.status} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">
            {(job.job_type === "adhoc" ? "[애드혹] " : "") +
              (job.task_name?.replace(/__RETRY_ENCOURAGE__/g, "").trim() || job.tc_filename)}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
            <span>{job.domain}</span>
            <span className="text-neutral-300">·</span>
            <span>{job.platform === "app" ? "App" : job.platform === "mweb" ? "Mweb" : "Web"}</span>
            <span className="text-neutral-300">·</span>
            <span className="font-mono">{job.qa_env}</span>
            <span className="text-neutral-300">·</span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400" title="내부 Job ID">{job.id}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SaveSuiteButton jobId={job.id} defaultName={job.task_name || job.tc_filename} />
          <Link href="/history" className="btn-ghost text-sm">← 히스토리</Link>
        </div>
      </div>

      {/* 완료 결과 요약 히어로 — 청크 그룹이면 그룹 합산을 주 결과로(이 청크 숫자는 보조줄). */}
      {isFinished && (
        <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
          <div className="flex items-center gap-3">
            <span className={`badge text-sm ${heroStatus === "succeeded" ? "bg-emerald-100 text-emerald-700" : heroStatus === "failed" ? "bg-rose-100 text-rose-700" : heroStatus === "running" ? "bg-blue-100 text-blue-700" : "bg-neutral-200 text-neutral-600"}`}>
              {statusKR[heroStatus] ?? heroStatus}
            </span>
            {heroTotal > 0 && <span className={`text-3xl font-bold ${heroRateColor}`}>{heroRate}%</span>}
          </div>
          {heroTotal > 0 && (
            <div className="text-sm">
              {inChunkGroup && <span className="mr-2 rounded bg-kurly-100 px-1.5 py-0.5 text-[11px] font-medium text-kurly-700">🎮 에이전트 {chunkGroup!.chunkCount}명 합산</span>}
              <span className="font-semibold text-emerald-600">{heroPassed}</span> PASS
              <span className="mx-1 text-neutral-300">·</span>
              <span className="font-semibold text-rose-600">{heroFailed}</span> FAIL
              <span className="mx-1 text-neutral-300">·</span>
              <span className="font-semibold text-amber-600">{heroBlocked}</span> BLOCKED
              <span className="ml-1 text-neutral-400">/ {heroTotal}</span>
              {inChunkGroup && (
                <div className="mt-1 text-[11px] text-neutral-500">
                  이 청크{thisChunkAgent ? `(${thisChunkAgent})` : ""}: {job.passed}P · {job.failed}F · {job.blocked}B / {job.total}
                </div>
              )}
            </div>
          )}
          <div className="text-sm text-neutral-600">
            ⏱ {job.duration_sec != null ? formatDuration(job.duration_sec) : "-"}{inChunkGroup ? " (이 청크)" : ""}
          </div>
          {heroFailed > 0 && (
            <span className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">실패 {heroFailed}건 — 아래 상세 / 재실행 확인</span>
          )}
        </div>
      )}

      {chunkGroup && chunkGroup.chunkCount > 1 && (
        <div className="card border-kurly-300 bg-kurly-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-kurly-900">
              🎮 멀티 분할 수행 — 청크 {chunkGroup.doneCount}/{chunkGroup.chunkCount} 완료
            </h2>
            <div className="flex items-center gap-2">
              {chunkGroup.doneCount > 0 && (
                <a
                  href={`/api/jobs/chunk-group/summary?groupId=${chunkGroup.groupId}`}
                  className="rounded-md border border-kurly-300 px-2.5 py-1 text-xs font-medium text-kurly-700 hover:bg-kurly-50"
                  title={chunkGroup.running ? "완료된 청크까지 합쳐서 다운로드 (진행 중)" : "전체 39개 통합 summary.csv 다운로드"}
                >
                  ⬇ 통합 summary.csv{chunkGroup.running ? " (진행 중)" : ""}
                </a>
              )}
              <CancelGroupButton
                groupId={chunkGroup.groupId}
                runningCount={chunkGroup.jobs.filter((c) => c.status === "running" || c.status === "pending").length}
              />
              <span className={`badge ${chunkGroup.status === "succeeded" ? "bg-emerald-100 text-emerald-700" : chunkGroup.status === "failed" ? "bg-rose-100 text-rose-700" : chunkGroup.status === "running" ? "bg-blue-100 text-blue-700" : "bg-neutral-200 text-neutral-600"}`}>
                {statusKR[chunkGroup.status] ?? chunkGroup.status}
              </span>
            </div>
          </div>
          <div className="mt-2 text-sm">
            <span className="text-kurly-900">합산:</span>{" "}
            <span className="font-semibold text-emerald-600">{chunkGroup.passed}</span> P
            <span className="mx-1 text-neutral-300">·</span>
            <span className="font-semibold text-rose-600">{chunkGroup.failed}</span> F
            <span className="mx-1 text-neutral-300">·</span>
            <span className="font-semibold text-amber-600">{chunkGroup.blocked}</span> B
            <span className="ml-1 text-neutral-400">/ {chunkGroup.total}</span>
          </div>
          <ChunkGroupProgress
            groupId={chunkGroup.groupId}
            initial={{
              done: chunkGroup.passed + chunkGroup.failed + chunkGroup.blocked,
              total: chunkGroup.total,
              passed: chunkGroup.passed,
              failed: chunkGroup.failed,
              blocked: chunkGroup.blocked,
              status: chunkGroup.status,
              chunkCount: chunkGroup.chunkCount,
              slots: chunkGroup.slots,
              serialOverflow: chunkGroup.serialOverflow,
            }}
          />
          <div className="mt-3 space-y-1 border-t border-kurly-100 pt-2">
            {chunkGroup.jobs.map((c) => (
              <Link
                key={c.id}
                href={`/jobs/${c.id}`}
                className={`block rounded px-2 py-1 text-xs hover:bg-kurly-100 ${c.id === job.id ? "bg-kurly-100 font-medium" : ""}`}
              >
                <span className="text-neutral-400">청크 {(c.chunk_index ?? 0) + 1}/{chunkGroup.chunkTotal}</span>{" · "}
                <span className="text-neutral-700">{(c.task_name || c.tc_filename)?.replace(/__RETRY_ENCOURAGE__/g, "").trim()}</span>{" · "}
                <span className="text-neutral-500">{statusKR[c.status] ?? c.status}</span>{" · "}
                <span className="text-emerald-600">{c.passed}P</span>{" · "}
                <span className="text-rose-600">{c.failed}F</span>{" · "}
                <span className="text-amber-600">{c.blocked}B</span>
                {c.id === job.id && <span className="ml-1 text-kurly-600">← 현재</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-500">실행 정보</h2>
            <span className={`badge ${job.mode === "real" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {job.mode === "real" ? "REAL" : "MOCK"}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[80px_1fr] gap-y-1.5 text-sm">
            <dt className="text-neutral-500">파일</dt>
            <dd className="truncate">{job.tc_filename}</dd>
            <dt className="text-neutral-500">도메인</dt>
            <dd>{job.domain}</dd>
            <dt className="text-neutral-500">플랫폼</dt>
            <dd>{job.platform === "app" ? "App" : job.platform === "mweb" ? "Mweb (모바일 웹)" : "Web"}</dd>
            <dt className="text-neutral-500">QA 환경</dt>
            <dd className="font-mono">{job.qa_env}</dd>
            <dt className="text-neutral-500">과제명</dt>
            <dd>{job.task_name ?? "-"}</dd>
            <dt className="text-neutral-500">에픽</dt>
            <dd className="font-mono">{job.epic_key ?? "-"}</dd>
            <dt className="text-neutral-500">실행자</dt>
            <dd>{job.requested_by ?? "-"}</dd>
            <dt className="text-neutral-500">워커</dt>
            <dd className="font-mono text-xs">
              {job.worker_name ? (() => {
                const w = getWorker(job.worker_name);
                return (
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                    {w?.label || job.worker_name}
                    {w?.label && <span className="ml-1 text-[10px] text-purple-400">({job.worker_name})</span>}
                  </span>
                );
              })() : (
                <span className="text-neutral-400">미지정 (기본 워커)</span>
              )}
            </dd>
            <dt className="text-neutral-500">필터</dt>
            <dd className="text-xs">
              {tcFilter
                ? [
                    tcFilter.priority && `${tcFilter.priority}만`,
                    tcFilter.range && `${tcFilter.range[0]}~${tcFilter.range[1]}번 행`,
                  ].filter(Boolean).join(" / ")
                : "전체"}
            </dd>
            <dt className="text-neutral-500">시작</dt>
            <dd>{formatDateTimeKR(job.created_at)}</dd>
            <dt className="text-neutral-500">실행 시간</dt>
            <dd>{job.duration_sec != null ? formatDuration(job.duration_sec) : (job.status === "running" ? "진행 중…" : "-")}</dd>
            <dt className="text-neutral-500">결과경로</dt>
            <dd className="break-all font-mono text-xs text-neutral-600">{job.result_dir ?? "-"}</dd>
          </dl>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-semibold text-neutral-500">진행 상황</h2>
          <JobStream jobId={job.id} initial={{ ...job, logs: initialLogs }} />
        </div>
      </div>

      <JobContextPanel job={job} />

      {flakyTcs.length > 0 && (
        <div className="card border-orange-200 bg-orange-50 p-4">
          <h2 className="text-sm font-semibold text-orange-900">
            ⚠ Flaky TC {flakyTcs.length}건 — 재실행 체인에서 PASS ↔ FAIL/BLOCKED 뒤집힘
          </h2>
          <p className="mt-1 text-xs text-orange-800">
            같은 TC가 실행마다 결과가 달라졌습니다. 환경 일시 이슈 또는 불안정 케이스일 가능성.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {flakyTcs.map((f) => (
              <span
                key={f.tc_no}
                className="rounded bg-white px-2 py-0.5 font-mono text-[11px] text-orange-700 ring-1 ring-orange-200"
                title={f.runs.map((r) => r.result).join(" → ")}
              >
                No.{f.tc_no} ({f.runs.map((r) => r.result[0]).join("→")})
              </span>
            ))}
          </div>
        </div>
      )}

      <MessagePanel jobId={job.id} jobStatus={job.status} />

      {dataRequests.length > 0 && (
        <div id="data-request-handoff" className="card scroll-mt-6 border-cyan-200 bg-cyan-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-cyan-950">🧪 테스트데이터 에이전트 핸드오프</h2>
              <p className="mt-1 text-xs text-cyan-800">
                수행 에이전트가 막힌 TC 기준으로 데이터 요청을 등록하고, 테스트데이터 큐가 순서대로 생성/검증 후 dataContext를 돌려줍니다.
              </p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-cyan-700 ring-1 ring-cyan-200">
              요청 {dataRequests.length}건
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {dataRequests.map((req) => {
              const inputs = parseJsonObject(req.inputs);
              const resultContext = parseJsonObject(req.result_context);
              const agentFlow = parseAgentFlow(req.notes);
              const humanNotes = getHumanNotes(req.notes);
              const elapsed = secondsBetween(req.created_at, req.finished_at || req.updated_at);
              const requester = req.source_agent || thisChunkAgent || "수행 에이전트";
              const canResume = needsCredentialInput(req);
              const flowItems = [
                { label: requester, title: "데이터 요청 등록", desc: req.need, done: true },
                { label: "데이터", title: "필요 데이터 분석", desc: agentFlow?.["데이터"] || "요청 조건과 TC 사전조건을 분석합니다.", done: ["running", "ready", "blocked", "failed"].includes(req.status) },
                { label: "셋업", title: "생성/조회/세팅", desc: agentFlow?.["셋업"] || "테스트 데이터 페이지/API로 필요한 데이터를 준비합니다.", done: ["ready", "blocked", "failed"].includes(req.status) },
                { label: "검증", title: "사전조건 검증", desc: agentFlow?.["검증"] || req.verification || "준비된 데이터가 TC 조건을 만족하는지 확인합니다.", done: ["ready", "blocked", "failed"].includes(req.status) },
                {
                  label: requester,
                  title: req.status === "ready" ? "dataContext 수신 후 재개" : req.status === "pending" ? "큐 대기 중" : req.status === "running" ? "데이터 대기 중" : "TC 차단/실패 처리",
                  desc: req.status === "ready"
                    ? "검증된 데이터로 같은 TC를 이어서 수행합니다."
                    : req.error_message || "결과 상태에 따라 수행 에이전트가 다음 액션을 결정합니다.",
                  done: ["ready", "blocked", "failed"].includes(req.status),
                },
              ];

              return (
                <div key={req.id} className="rounded-lg border border-cyan-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge ${requestStatusStyle(req.status)}`}>{requestStatusLabel(req.status)}</span>
                        <span className="font-mono text-xs text-neutral-500">{req.id}</span>
                        {req.tc_ref && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">{req.tc_ref}</span>}
                      </div>
                      <div className="mt-2 text-sm font-medium text-neutral-900">{req.need}</div>
                      {req.reason && <div className="mt-1 text-xs text-neutral-500">{req.reason}</div>}
                    </div>
                    <div className="text-right text-[11px] text-neutral-500">
                      <div>요청: {formatDateTimeKR(req.created_at)}</div>
                      {req.claimed_by && <div>처리: {req.claimed_by}</div>}
                      {elapsed != null && <div>경과: {formatDuration(elapsed)}</div>}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 lg:grid-cols-5">
                    {flowItems.map((item, index) => (
                      <div
                        key={`${req.id}-${item.label}-${index}`}
                        className={`rounded-md border p-3 ${
                          item.done
                            ? "border-cyan-200 bg-cyan-50"
                            : "border-neutral-200 bg-neutral-50 text-neutral-400"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                            item.done ? "bg-cyan-500 text-white" : "bg-neutral-200 text-neutral-500"
                          }`}>
                            {index + 1}
                          </span>
                          <span className="truncate text-xs font-semibold">{item.label}</span>
                        </div>
                        <div className="mt-2 text-xs font-medium">{item.title}</div>
                        <div className="mt-1 line-clamp-3 text-[11px] leading-4 text-neutral-600">{item.desc}</div>
                      </div>
                    ))}
                  </div>

                  {canResume && <DataRequestResumeForm requestId={req.id} />}

                  {(resultContext || req.verification || humanNotes || inputs || req.error_message) && (
                    <details className="mt-3 rounded-md border border-cyan-100 bg-cyan-50/50 p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-cyan-800">요청/결과 상세 보기</summary>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {inputs && (
                          <div>
                            <div className="text-[11px] font-semibold text-neutral-500">요청 입력</div>
                            <pre className="mt-1 max-h-40 overflow-auto rounded bg-white p-2 text-[11px] text-neutral-700">{JSON.stringify(maskSecrets(inputs), null, 2)}</pre>
                          </div>
                        )}
                        {resultContext && (
                          <div>
                            <div className="text-[11px] font-semibold text-neutral-500">dataContext</div>
                            <pre className="mt-1 max-h-40 overflow-auto rounded bg-white p-2 text-[11px] text-neutral-700">{JSON.stringify(resultContext, null, 2)}</pre>
                          </div>
                        )}
                        {req.verification && (
                          <div>
                            <div className="text-[11px] font-semibold text-neutral-500">검증 결과</div>
                            <p className="mt-1 rounded bg-white p-2 text-xs text-neutral-700">{req.verification}</p>
                          </div>
                        )}
                        {(humanNotes || req.error_message) && (
                          <div>
                            <div className="text-[11px] font-semibold text-neutral-500">수행 에이전트 전달 메모</div>
                            <p className="mt-1 whitespace-pre-wrap rounded bg-white p-2 text-xs text-neutral-700">
                              {humanNotes || req.error_message}
                            </p>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {parentJob && (
        <div className="card border-neutral-300 bg-neutral-50 p-4">
          <h2 className="text-xs font-semibold text-neutral-500">↳ 재실행 Job</h2>
          <div className="mt-2 text-sm">
            이 Job 은 {job.retry_type === "FAIL" ? "FAIL" : job.retry_type === "BLOCKED" ? "BLOCKED" : job.retry_type === "continue" ? "이어서" : job.retry_type === "extend" ? "추가 검증" : "재실행"} 재실행입니다.
          </div>
          <div className="mt-1 text-xs text-neutral-600">
            원본:{" "}
            <Link href={`/jobs/${parentJob.id}`} className="text-kurly-500 hover:underline">
              {parentJob.tc_filename}
            </Link>
            {" · "}
            <span className="text-emerald-600">{parentJob.passed}P</span>{" · "}
            <span className="text-rose-600">{parentJob.failed}F</span>{" · "}
            <span className="text-amber-600">{parentJob.blocked}B</span>{" / "}
            <span>{parentJob.total}</span>
          </div>
        </div>
      )}

      {cumulative && (
        <div className="card border-indigo-200 bg-indigo-50 p-4">
          <h2 className="text-xs font-semibold text-indigo-900">↻ 누적 결과 ({cumulative.retryCount}회 재실행 포함)</h2>
          <div className="mt-2 flex items-baseline gap-4">
            <div className="text-sm">
              <span className="text-neutral-500">원본:</span>{" "}
              <span className="text-emerald-600">{job.passed}P</span>{" · "}
              <span className="text-rose-600">{job.failed}F</span>{" · "}
              <span className="text-amber-600">{job.blocked}B</span>{" / "}
              <span>{job.total}</span>
            </div>
            <div className="text-sm font-medium">
              <span className="text-indigo-900">누적:</span>{" "}
              <span className="text-emerald-600">{cumulative.passed}P</span>{" · "}
              <span className="text-rose-600">{cumulative.failed}F</span>{" · "}
              <span className="text-amber-600">{cumulative.blocked}B</span>{" / "}
              <span>{cumulative.total}</span>
            </div>
          </div>
          {retryDescendants.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-indigo-100 pt-2">
              {retryDescendants.map((c) => (
                <Link key={c.id} href={`/jobs/${c.id}`} className="block text-xs hover:bg-indigo-100 rounded px-2 py-1">
                  <span className="text-neutral-400">↳</span>{" "}
                  <span className="text-neutral-700">
                    {c.retry_type === "FAIL" ? "FAIL" : c.retry_type === "BLOCKED" ? "BLOCKED" : c.retry_type === "continue" ? "이어서" : c.retry_type === "extend" ? "추가 검증" : "재실행"} 재실행 ({c.total}건)
                  </span>{" · "}
                  <span className="text-emerald-600">{c.passed}P</span>{" · "}
                  <span className="text-rose-600">{c.failed}F</span>{" · "}
                  <span className="text-amber-600">{c.blocked}B</span>{" · "}
                  <span className="text-neutral-400">{formatDateTimeKR(c.created_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {job.additional_instructions && (
        <div className="card border-indigo-200 bg-indigo-50 p-5">
          <h2 className="text-sm font-semibold text-indigo-900">
            📝 추가 지시사항 (이번 실행에 전달됨)
          </h2>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-white p-3 font-mono text-xs text-neutral-800 ring-1 ring-indigo-100">
{job.additional_instructions}
          </pre>
        </div>
      )}

      {job.generated_prompt && (
        <details className="card p-5">
          <summary className="cursor-pointer text-sm font-semibold text-neutral-500">
            Claude에게 전달된 메시지 보기
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-md bg-neutral-50 p-4 text-xs text-neutral-700">
{job.generated_prompt}
          </pre>
        </details>
      )}

      {["failed", "canceled"].includes(job.status) && (job.passed + job.failed + job.blocked) > 0 && (
        <ContinueButton
          jobId={job.id}
          status={job.status}
          done={job.passed + job.failed + job.blocked}
        />
      )}

      {["succeeded", "failed", "canceled"].includes(job.status) && (job.passed + job.failed + job.blocked) > 0 && (
        <ExtendButton
          jobId={job.id}
          status={job.status}
          done={job.passed + job.failed + job.blocked}
        />
      )}

      {["succeeded", "failed", "canceled"].includes(job.status) && (
        <RestartButton jobId={job.id} status={job.status} />
      )}

      {["succeeded", "failed", "canceled"].includes(job.status) && job.failed > 0 && (
        <RetryFailButton jobId={job.id} failCount={job.failed} />
      )}

      {["succeeded", "failed", "canceled"].includes(job.status) && job.blocked > 0 && (
        <RetryBlockedButton jobId={job.id} blockedCount={job.blocked} />
      )}

      <FailBlockedListCard jobId={job.id} failItems={failItems} blockedItems={blockedItems} />

      {(failItems.length > 0 || jiraRegistered.length > 0) && (
        <JiraIssuesPanel
          jobId={job.id}
          domain={job.domain}
          qaEnv={job.qa_env}
          epicKey={job.epic_key}
          taskName={job.task_name}
          failItems={failItems}
          registered={jiraRegistered.map(r => ({
            id: r.id, tc_no: r.tc_no, issue_key: r.issue_key, issue_url: r.issue_url,
            summary: r.summary, created_at: r.created_at,
          }))}
          hasSettings={!!jiraSettings}
          jiraHost={jiraSettings?.host ?? null}
        />
      )}

      {reportMd && (
        <div className="card border-l-4 border-l-indigo-400 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-indigo-700">
              🔍 애드혹 테스트 리포트
              <span className="ml-1 text-xs text-neutral-400">(report.md)</span>
            </h2>
            <a
              href={`/api/jobs/${job.id}/file?name=report.md`}
              className="text-xs text-neutral-500 hover:text-kurly-500"
            >
              원본 다운로드
            </a>
          </div>
          <div className="mt-3">
            <Markdown source={reportMd} />
          </div>
        </div>
      )}

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-neutral-500">결과 파일</h2>
        {resultFiles.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">아직 결과 파일이 없습니다.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {resultFiles
              .filter((f) => !f.rel.includes("/"))
              .filter((f) => !(f.name === "fail-detail.csv" && job.failed === 0))
              .map((f) => (
              <li key={f.rel} className="flex items-center justify-between py-2 text-sm">
                <span className="font-mono text-neutral-700">{f.rel}</span>
                <a
                  href={`/api/jobs/${job.id}/file?name=${encodeURIComponent(f.rel)}`}
                  className="text-kurly-500 hover:underline"
                >
                  다운로드 ({(f.size / 1024).toFixed(1)} KB)
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {Object.keys(screenshotsByTC).length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-neutral-500">스크린샷 갤러리</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Object.entries(screenshotsByTC)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([tcKey, imgs]) => (
                <div key={tcKey} className="space-y-1">
                  <div className="text-xs font-medium text-neutral-700">{tcKey}</div>
                  {imgs.map((img) => (
                    <a
                      key={img.rel}
                      href={`/api/jobs/${job.id}/file?name=${encodeURIComponent(img.rel)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded border border-neutral-200 hover:border-kurly-500"
                    >
                      <img
                        src={`/api/jobs/${job.id}/file?name=${encodeURIComponent(img.rel)}&inline=1`}
                        alt={img.name}
                        className="h-24 w-full object-cover"
                        loading="lazy"
                      />
                      <div className="truncate p-1 text-[10px] text-neutral-500">{img.name}</div>
                    </a>
                  ))}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
