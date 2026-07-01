import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { getTcGenJob, parseJobPocs, mergeTcGenGroupCsv, getEffectiveTcGenGroupJobs, getTcGenEffectiveGroupId, reviewTcCsvQuality, AUTO_REFINE_THRESHOLD, resolveTcOutputPath } from "@/lib/tc-gen";
import { getDomainById } from "@/lib/domains";
import { normalizePoc, POC_IDS } from "@/lib/pocs";
import { formatDateTimeKR, formatDuration } from "@/lib/format-date";
import { splitCsvLines, parseCsvRow } from "@/lib/csv-parser";
import { PollUntilDone } from "./poll-until-done";
import { RefinePanel } from "./refine-panel";
import { TcGenGroupBanner } from "./group-banner";
import { AutoRefineButton } from "./auto-refine-button";
import { GroupAutoRefineButton } from "./group-auto-refine-button";
import { AgentRunway, getRunwayAgents } from "@/app/_components/agent-runway";

export const dynamic = "force-dynamic";

const UNCLASSIFIED = "(미분류)";

interface PreviewRow {
  no: string; priority: string; type: string; title: string;
  path: string; precond: string; expected: string; poc: string;
}

interface PreviewData {
  total: number;
  groups: { poc: string; rows: PreviewRow[] }[];   // POCS 순 + 미분류 마지막
}

interface CompareRow {
  no: string;
  poc: string;
  type: string;
  tags: string;
  title: string;
  precond: string;
  expected: string;
}

interface TcRefineComparison {
  beforeCount: number;
  afterCount: number;
  added: CompareRow[];
  removed: CompareRow[];
  changed: { before: CompareRow; after: CompareRow }[];
  unchanged: number;
  scoreDelta?: {
    before: number;
    after: number;
    diff: number;
    errorDiff: number;
    warnDiff: number;
  };
  coverageDelta?: {
    beforeCovered: number;
    afterCovered: number;
    beforeMissing: number;
    afterMissing: number;
    newlyCovered: string[];
    newlyMissing: string[];
  };
}

interface QualityReview {
  score: number;
  grade: "A" | "B" | "C" | "D";
  totalRows: number;
  issueCounts: { error: number; warn: number };
  issues: { severity: "error" | "warn"; code: string; message: string; rows?: string[] }[];
  hints: string[];
  coverage?: {
    requiredReqIds: string[];
    taggedReqIds?: string[];
    coveredReqIds: string[];
    missingReqIds: string[];
  };
}

interface GroupQualityReview extends QualityReview {
  agentCount: number;
  agents: {
    id: string;
    nickname: string;
    score: number;
    grade: QualityReview["grade"];
    totalRows: number;
    error: number;
    warn: number;
  }[];
}

function readPreview(outputPath: string | null): PreviewData | null {
  const resolved = resolveTcOutputPath(outputPath);
  if (!resolved || !fs.existsSync(resolved)) return null;
  try {
    return previewFromText(fs.readFileSync(resolved, "utf-8"));
  } catch {
    return null;
  }
}

function readQualityReview(outputPath: string | null): QualityReview | null {
  const resolved = resolveTcOutputPath(outputPath);
  if (!resolved) return null;
  const reviewPath = path.join(path.dirname(resolved), "quality-review.json");
  if (!fs.existsSync(reviewPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reviewPath, "utf-8")) as QualityReview;
  } catch {
    return null;
  }
}

function computeQualityReviewFromOutput(job: NonNullable<ReturnType<typeof getTcGenJob>>): QualityReview | null {
  const outputPath = resolveTcOutputPath(job.output_path);
  if (!outputPath || !fs.existsSync(outputPath)) return readQualityReview(job.output_path);
  try {
    const csv = fs.readFileSync(outputPath, "utf-8");
    return reviewTcCsvQuality(csv, {
      domain: job.domain,
      pocs: parseJobPocs(job.pocs),
      focus: job.focus,
      designAnalysis: job.qa_analysis,
    }) as QualityReview;
  } catch {
    return readQualityReview(job.output_path);
  }
}

function aggregateGroupQualityReview(groupId: string | null): GroupQualityReview | null {
  if (!groupId) return null;
  const jobs = getEffectiveTcGenGroupJobs(groupId);
  const merged = mergeTcGenGroupCsv(groupId);
  if (!merged) return null;
  const items = jobs
    .filter((j) => j.kind === "tc" && j.status === "succeeded" && j.output_path)
    .map((j) => ({ job: j, review: readQualityReview(j.output_path) }))
    .filter((x): x is { job: NonNullable<typeof x.job>; review: QualityReview } => !!x.review);
  const seedJob = jobs.find((j) => j.kind === "tc") ?? null;
  const designAnalysis = jobs.map((j) => j.qa_analysis).filter(Boolean).join("\n\n");
  const mergedReview = reviewTcCsvQuality(merged.csv, {
    domain: seedJob?.domain ?? "회원",
    pocs: seedJob ? parseJobPocs(seedJob.pocs) : [],
    focus: jobs.map((j) => j.focus).filter(Boolean).join("\n\n"),
    designAnalysis,
    scope: "group",
  }) as QualityReview;

  const hints = [...new Set(items.flatMap((x) => x.review.hints))];
  mergedReview.hints.forEach((hint) => hints.push(hint));

  return {
    ...mergedReview,
    hints: [...new Set(hints)],
    agentCount: jobs.length,
    agents: items.map((x) => ({
      id: x.job.id,
      nickname: x.job.agent_nickname || "에이전트",
      score: x.review.score,
      grade: x.review.grade,
      totalRows: x.review.totalRows,
      error: x.review.issueCounts.error,
      warn: x.review.issueCounts.warn,
    })),
  };
}

// CSV 텍스트 → 미리보기 구조. (단일=output_path / 그룹=합본 CSV 둘 다 사용)
function previewFromText(text: string): PreviewData | null {
  try {
    const lines = splitCsvLines(text.replace(/^﻿/, ""));
    if (lines.length < 2) return { total: 0, groups: [] };
    const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
    const idx = (...names: string[]) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
    // 커머스 21열 + 물류 13열 사인오프(No.·우선순위·Test Scenario (시나리오)…) 헤더 둘 다 인식
    const iNo = idx("no", "no.");
    const iPrio = idx("priority", "우선순위");
    const iType = idx("type", "tc type", "유형");
    const iTitle = idx("title", "test scenario (시나리오)", "test scenario", "시나리오", "scenario");
    const i1 = idx("1depth"), i2 = idx("2depth"), i3 = idx("3depth");
    const iPre = idx("pre-condition (사전조건)", "pre-condition", "precondition", "사전조건");
    const iExp = idx("expected results (예상결과)", "expected result", "expected results", "expected", "기대결과", "예상결과");
    const iPoc = idx("시트분류", "poc", "sheet");
    const get = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
    const rows: PreviewRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const c = parseCsvRow(lines[i]);
      if (!c.some((x) => x.trim())) continue;
      const path = [get(c, i1), get(c, i2), get(c, i3)].filter(Boolean).join(" > ");
      rows.push({
        no: get(c, iNo) || String(i),
        priority: get(c, iPrio),
        type: get(c, iType),
        title: get(c, iTitle),
        path,
        precond: get(c, iPre),
        expected: get(c, iExp),
        poc: normalizePoc(get(c, iPoc)) ?? UNCLASSIFIED,
      });
    }
    // POC별 그룹 (POCS 정의 순, 존재하는 것만 + 미분류 마지막)
    const order = [...POC_IDS, UNCLASSIFIED];
    const groups = order
      .map((poc) => ({ poc, rows: rows.filter((r) => r.poc === poc) }))
      .filter((g) => g.rows.length > 0);
    // POC 그룹별로 No 를 1부터 다시 매김 (다운로드 per-POC CSV 와 동일)
    groups.forEach((g) => g.rows.forEach((r, i) => { r.no = String(i + 1); }));
    return { total: rows.length, groups };
  } catch {
    return null;
  }
}

function compareRowsFromText(text: string): CompareRow[] {
  const lines = splitCsvLines(text.replace(/^﻿/, ""));
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iNo = idx("no", "no.");
  const iPoc = idx("시트분류", "poc", "sheet");
  const iType = idx("type", "tc type", "유형");
  const iTags = idx("tags", "tag", "태그");
  const iTitle = idx("title", "test scenario (시나리오)", "test scenario", "시나리오", "scenario");
  const iPre = idx("pre-condition (사전조건)", "pre-condition", "precondition", "사전조건");
  const iExp = idx("expected results (예상결과)", "expected result", "expected results", "expected", "기대결과", "예상결과");
  const get = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
  return lines.slice(1).flatMap((line, i) => {
    const c = parseCsvRow(line);
    if (!c.some((x) => x.trim())) return [];
    return [{
      no: get(c, iNo) || String(i + 1),
      poc: normalizePoc(get(c, iPoc)) ?? UNCLASSIFIED,
      type: get(c, iType),
      tags: get(c, iTags),
      title: get(c, iTitle),
      precond: get(c, iPre),
      expected: get(c, iExp),
    }];
  });
}

function normalizeCompareText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function compareRowKey(row: CompareRow): string {
  const reqIds = Array.from(new Set(`${row.tags} ${row.title}`.match(/\bREQ-[A-Z0-9_-]+\b/gi) ?? [])).sort().join("|");
  const title = normalizeCompareText(row.title);
  return `${row.poc}::${reqIds || title}`;
}

function compareRowSignature(row: CompareRow): string {
  return [row.type, row.title, row.precond, row.expected].map(normalizeCompareText).join("||");
}

function buildTcRefineComparison(
  beforeJob: NonNullable<ReturnType<typeof getTcGenJob>>,
  afterJob: NonNullable<ReturnType<typeof getTcGenJob>>,
  beforeReview: QualityReview | null,
  afterReview: QualityReview | null
): TcRefineComparison | null {
  const beforePath = resolveTcOutputPath(beforeJob.output_path);
  const afterPath = resolveTcOutputPath(afterJob.output_path);
  if (!beforePath || !afterPath || !fs.existsSync(beforePath) || !fs.existsSync(afterPath)) return null;
  try {
    const beforeRows = compareRowsFromText(fs.readFileSync(beforePath, "utf-8"));
    const afterRows = compareRowsFromText(fs.readFileSync(afterPath, "utf-8"));
    const beforeMap = new Map(beforeRows.map((row) => [compareRowKey(row), row]));
    const afterMap = new Map(afterRows.map((row) => [compareRowKey(row), row]));
    const added: CompareRow[] = [];
    const removed: CompareRow[] = [];
    const changed: { before: CompareRow; after: CompareRow }[] = [];
    let unchanged = 0;

    for (const row of afterRows) {
      const before = beforeMap.get(compareRowKey(row));
      if (!before) {
        added.push(row);
      } else if (compareRowSignature(before) !== compareRowSignature(row)) {
        changed.push({ before, after: row });
      } else {
        unchanged++;
      }
    }
    for (const row of beforeRows) {
      if (!afterMap.has(compareRowKey(row))) removed.push(row);
    }

    const beforeMissing = new Set(beforeReview?.coverage?.missingReqIds ?? []);
    const afterMissing = new Set(afterReview?.coverage?.missingReqIds ?? []);
    const beforeCovered = new Set(beforeReview?.coverage?.coveredReqIds ?? []);
    const afterCovered = new Set(afterReview?.coverage?.coveredReqIds ?? []);

    return {
      beforeCount: beforeRows.length,
      afterCount: afterRows.length,
      added,
      removed,
      changed,
      unchanged,
      scoreDelta: beforeReview && afterReview ? {
        before: beforeReview.score,
        after: afterReview.score,
        diff: afterReview.score - beforeReview.score,
        errorDiff: afterReview.issueCounts.error - beforeReview.issueCounts.error,
        warnDiff: afterReview.issueCounts.warn - beforeReview.issueCounts.warn,
      } : undefined,
      coverageDelta: beforeReview?.coverage && afterReview?.coverage ? {
        beforeCovered: beforeCovered.size,
        afterCovered: afterCovered.size,
        beforeMissing: beforeMissing.size,
        afterMissing: afterMissing.size,
        newlyCovered: [...beforeMissing].filter((req) => afterCovered.has(req)),
        newlyMissing: [...afterMissing].filter((req) => !beforeMissing.has(req)),
      } : undefined,
    };
  } catch {
    return null;
  }
}

function DeltaBadge({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "neutral" }) {
  return (
    <div className={`rounded border px-3 py-2 text-xs ${
      tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : tone === "bad" ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-neutral-200 bg-white text-neutral-700"
    }`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function TcRefineComparisonPanel({ comparison }: { comparison: TcRefineComparison }) {
  const scoreTone = !comparison.scoreDelta || comparison.scoreDelta.diff === 0 ? "neutral" : comparison.scoreDelta.diff > 0 ? "good" : "bad";
  const coverageTone = !comparison.coverageDelta || comparison.coverageDelta.afterMissing === comparison.coverageDelta.beforeMissing
    ? "neutral"
    : comparison.coverageDelta.afterMissing < comparison.coverageDelta.beforeMissing ? "good" : "bad";
  const sampleAdded = comparison.added.slice(0, 3);
  const sampleChanged = comparison.changed.slice(0, 3);
  const sampleRemoved = comparison.removed.slice(0, 3);

  return (
    <section className="card border-blue-200 bg-blue-50/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-blue-950">개선 전/후 비교</h2>
        <div className="text-xs text-blue-700">원본 {comparison.beforeCount}건 → 개선본 {comparison.afterCount}건</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <DeltaBadge
          label="품질 점수"
          value={comparison.scoreDelta ? `${comparison.scoreDelta.before} → ${comparison.scoreDelta.after} (${comparison.scoreDelta.diff >= 0 ? "+" : ""}${comparison.scoreDelta.diff})` : "비교 불가"}
          tone={scoreTone}
        />
        <DeltaBadge
          label="REQ 미커버"
          value={comparison.coverageDelta ? `${comparison.coverageDelta.beforeMissing} → ${comparison.coverageDelta.afterMissing}` : "비교 불가"}
          tone={coverageTone}
        />
        <DeltaBadge label="추가/삭제" value={`+${comparison.added.length} / -${comparison.removed.length}`} tone={comparison.added.length || comparison.removed.length ? "neutral" : "good"} />
        <DeltaBadge label="내용 변경" value={`${comparison.changed.length}건`} tone={comparison.changed.length ? "neutral" : "good"} />
      </div>
      {comparison.scoreDelta && (
        <div className="mt-2 text-[11px] text-neutral-500">
          이슈 변화: error {comparison.scoreDelta.errorDiff >= 0 ? "+" : ""}{comparison.scoreDelta.errorDiff}, warn {comparison.scoreDelta.warnDiff >= 0 ? "+" : ""}{comparison.scoreDelta.warnDiff}
        </div>
      )}
      {comparison.coverageDelta && (comparison.coverageDelta.newlyCovered.length > 0 || comparison.coverageDelta.newlyMissing.length > 0) && (
        <div className="mt-2 rounded border border-blue-100 bg-white px-2.5 py-2 text-[11px] text-neutral-600">
          {comparison.coverageDelta.newlyCovered.length > 0 && <div>새로 커버됨: {comparison.coverageDelta.newlyCovered.join(", ")}</div>}
          {comparison.coverageDelta.newlyMissing.length > 0 && <div className="text-rose-700">새 미커버: {comparison.coverageDelta.newlyMissing.join(", ")}</div>}
        </div>
      )}
      {(sampleAdded.length > 0 || sampleChanged.length > 0 || sampleRemoved.length > 0) && (
        <details className="mt-3 rounded border border-blue-100 bg-white px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-blue-800">변경된 TC 샘플 보기</summary>
          <div className="mt-2 grid gap-2 lg:grid-cols-3">
            {sampleAdded.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-emerald-700">추가</div>
                <ul className="space-y-1 text-neutral-600">
                  {sampleAdded.map((row) => <li key={`a-${row.no}-${row.title}`} className="line-clamp-2">[{row.poc}] {row.title}</li>)}
                </ul>
              </div>
            )}
            {sampleChanged.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-blue-700">변경</div>
                <ul className="space-y-1 text-neutral-600">
                  {sampleChanged.map(({ after }) => <li key={`c-${after.no}-${after.title}`} className="line-clamp-2">[{after.poc}] {after.title}</li>)}
                </ul>
              </div>
            )}
            {sampleRemoved.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-rose-700">삭제</div>
                <ul className="space-y-1 text-neutral-600">
                  {sampleRemoved.map((row) => <li key={`r-${row.no}-${row.title}`} className="line-clamp-2">[{row.poc}] {row.title}</li>)}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="sticky top-0 z-10 bg-neutral-50 text-left text-xs text-neutral-500 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
          <tr>
            <th className="px-3 py-2 w-12">No</th>
            <th className="px-3 py-2 min-w-[220px]">Title</th>
            <th className="px-3 py-2 min-w-[220px]">사전조건</th>
            <th className="px-3 py-2 min-w-[140px]">경로</th>
            <th className="px-3 py-2 min-w-[260px]">기대결과</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 align-top">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-neutral-50">
              <td className="px-3 py-1.5 font-mono text-xs text-neutral-500">{r.no}</td>
              <td className="px-3 py-1.5 text-xs">{r.title}</td>
              <td className="px-3 py-1.5 text-[11px] text-neutral-600">
                <div className="line-clamp-2 max-w-[300px] whitespace-pre-wrap" title={r.precond}>{r.precond || "-"}</div>
              </td>
              <td className="px-3 py-1.5 text-[11px] text-neutral-500">{r.path || "-"}</td>
              <td className="px-3 py-1.5 text-[11px] text-neutral-600">
                <div className="line-clamp-2 max-w-[360px] whitespace-pre-wrap" title={r.expected}>{r.expected || "-"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReqCoveragePanel({ review }: { review: QualityReview }) {
  const coverage = review.coverage;
  if (!coverage) return null;
  const covered = new Set(coverage.coveredReqIds);
  const tagged = new Set(coverage.taggedReqIds ?? []);
  const missing = new Set(coverage.missingReqIds);
  const coveragePct = coverage.requiredReqIds.length
    ? Math.round((coverage.coveredReqIds.length / coverage.requiredReqIds.length) * 100)
    : 0;

  return (
    <div className="mt-3 rounded border border-neutral-200 bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-neutral-800">REQ-ID 커버리지</div>
        <div className="text-neutral-600">
          커버 {coverage.coveredReqIds.length}/{coverage.requiredReqIds.length}
          <span className="ml-2 text-neutral-400">태그 {coverage.taggedReqIds?.length ?? 0}</span>
          <span className={`ml-2 font-semibold ${missing.size ? "text-rose-600" : "text-emerald-600"}`}>{coveragePct}%</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full ${missing.size ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${coveragePct}%` }} />
      </div>
      <div className="mt-3 grid max-h-44 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {coverage.requiredReqIds.map((reqId) => {
          const status = covered.has(reqId) ? "covered" : tagged.has(reqId) ? "tagged" : "missing";
          return (
            <div key={reqId} className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 ${
              status === "covered" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : status === "tagged" ? "border-blue-200 bg-blue-50 text-blue-900"
                  : "border-rose-200 bg-rose-50 text-rose-900"
            }`}>
              <span className="truncate font-mono">{reqId}</span>
              <span className="shrink-0 text-[11px] font-semibold">
                {status === "covered" ? "커버됨" : status === "tagged" ? "태그만" : "미커버"}
              </span>
            </div>
          );
        })}
      </div>
      {coverage.missingReqIds.length > 0 && (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
          미커버 REQ: {coverage.missingReqIds.join(", ")}
        </div>
      )}
    </div>
  );
}

export default async function TcGenStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getTcGenJob(id);
  if (!job) notFound();

  const isActive = job.status === "pending" || job.status === "running";
  // 하네스 진행 단계 — 워커가 보고한 진행 로그(⚙️)의 최신 단계 추출(실행 중 '멈춤?' 오인 방지)
  const harnessPhase = job.status === "running" && job.log
    ? (job.log.split("\n").filter((l) => l.includes("⚙️")).pop() || "").replace(/^.*⚙️\s*/, "").trim()
    : "";
  // 실행 중 경과 시간(분) — started_at 은 UTC wall-clock 문자열이라 'Z' 붙여 파싱
  const elapsedMin = job.status === "running" && job.started_at
    ? Math.max(0, Math.floor((Date.now() - new Date(job.started_at.replace(" ", "T") + "Z").getTime()) / 60000))
    : 0;
  const effectiveGroupId = getTcGenEffectiveGroupId(job);
  // 에이전트 상세는 해당 에이전트 산출물만 보여준다. 합본/종합 리뷰는 /tc-gen/group/[groupId] 메인에서 담당.
  const preview = job.status === "succeeded" ? readPreview(job.output_path) : null;
  const runwayAgents = getRunwayAgents({
    workerName: job.worker_name || job.target_worker,
    group: job.kind === "design" ? "design" : "write",
    nicknames: job.agent_nickname ? [job.agent_nickname] : [],
  });
  const qualityReview = job.status === "succeeded" ? computeQualityReviewFromOutput(job) : null;
  const parentJob = job.parent_id ? getTcGenJob(job.parent_id) : null;
  const parentQualityReview = parentJob?.status === "succeeded" ? computeQualityReviewFromOutput(parentJob) : null;
  const refineComparison = job.status === "succeeded" && parentJob
    ? buildTcRefineComparison(parentJob, job, parentQualityReview, qualityReview)
    : null;
  const domainLabel = getDomainById(job.domain)?.label ?? job.domain;
  const targetPocs = parseJobPocs(job.pocs);

  return (
    <div className="space-y-5">
      <PollUntilDone status={job.status} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{job.task_name || `${domainLabel} TC 생성`}</h1>
          <div className="mt-1 text-xs text-neutral-500">
            {domainLabel} · {formatDateTimeKR(job.created_at)}
            {job.duration_sec != null && <> · {formatDuration(job.duration_sec)}</>}
            {job.requested_by && <> · {job.requested_by}</>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {effectiveGroupId && <Link href={`/tc-gen/group/${effectiveGroupId}`} className="btn-ghost text-sm">← 종합 TC</Link>}
          <Link href="/tc-gen" className="btn-ghost text-sm">TC 생성</Link>
        </div>
      </div>

      {/* 지시 기반 병렬(작성) 그룹 — 진행 중일 때만 크게 노출. 완료 화면은 최종 결과 카드에 집중한다. */}
      {effectiveGroupId && job.status !== "succeeded" && <TcGenGroupBanner groupId={effectiveGroupId} basePath="/tc-gen" />}

      {/* 개선 계보 — 이 생성이 개선본이면 원본 링크 + 적용된 피드백 */}
      {job.parent_id && job.status === "succeeded" && (
        <details className="rounded-[8px] border border-violet-200 bg-violet-50/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-violet-700">← 원본/개선 지시 보기</summary>
          <div className="mt-2 space-y-1.5 text-neutral-600">
            <Link href={`/tc-gen/${job.parent_id}`} className="font-medium text-violet-700 hover:underline">원본 생성 보기</Link>
            {job.refine_instructions && (
              <div><span className="text-neutral-400">적용된 개선 지시:</span> {job.refine_instructions}</div>
            )}
          </div>
        </details>
      )}
      {job.parent_id && job.status !== "succeeded" && (
        <div className="card border-violet-200 bg-violet-50/40 p-3 text-xs">
          <Link href={`/tc-gen/${job.parent_id}`} className="font-medium text-violet-700 hover:underline">← 원본 생성 보기</Link>
          {job.refine_instructions && (
            <div className="mt-1 text-neutral-600"><span className="text-neutral-400">적용된 개선 지시:</span> {job.refine_instructions}</div>
          )}
        </div>
      )}

      {/* QA 설계에서 넘어온 경우 — 원본 설계 링크 */}
      {job.source_design_id && job.status === "succeeded" && (
        <details className="rounded-[8px] border border-violet-200 bg-violet-50/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-violet-700">🔬 QA 설계 보기</summary>
          <div className="mt-2 text-neutral-500">이 설계 분석이 아래 최종 TC에 반영되었습니다.</div>
          <Link href={`/qa-design/${job.source_design_id}`} className="mt-1 inline-block font-medium text-violet-700 hover:underline">설계 결과 페이지 열기</Link>
        </details>
      )}
      {job.source_design_id && job.status !== "succeeded" && (
        <div className="card border-violet-200 bg-violet-50/40 p-3 text-xs">
          🔬 <Link href={`/qa-design/${job.source_design_id}`} className="font-medium text-violet-700 hover:underline">QA 설계 보기</Link>
          <span className="ml-1 text-neutral-500">— 이 설계 분석이 아래 TC에 반영됨</span>
        </div>
      )}

      {/* 대상 POC(시트분류) */}
      {targetPocs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-neutral-400">대상 POC:</span>
          {targetPocs.map((p) => (
            <span key={p} className="rounded-full border border-kurly-200 bg-kurly-50 px-2 py-0.5 font-medium text-kurly-700">{p}</span>
          ))}
        </div>
      )}

      {/* 상태 배너 */}
      {isActive && (
        <>
          <AgentRunway agents={runwayAgents} progress={job.status === "running" ? (harnessPhase ? 72 : 48) : 10} phase="write" status={job.status === "pending" ? "pending" : "running"} />
          <div className="card border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <span className="font-medium">⏳ {job.status === "pending" ? "워커 대기 중" : "생성 중"}…</span>
            <span className="ml-2 text-xs text-blue-700">
              {job.status === "pending"
                ? "워커가 잡을 가져가면 그 워커의 Claude로 실행돼요. 워커가 떠 있어야 진행됩니다. 3초마다 자동 갱신."
                : <>워커 <strong>{job.worker_name ?? "?"}</strong> 가 기획서를 분석해 작성 중. 3초마다 자동 갱신.</>}
            </span>
            {harnessPhase && (
              <div className="mt-2 flex items-center gap-2 rounded-md bg-white/70 px-3 py-2 text-sm font-medium text-blue-900">
                <span className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
                🔄 {harnessPhase}
                <span className="ml-auto shrink-0 text-[11px] font-normal text-blue-600">⏱ {elapsedMin}분째 · 예상 40분~1시간+ (개선 루프 변동)</span>
              </div>
            )}
          </div>
        </>
      )}
      {job.status === "failed" && (
        <div className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="font-medium">✗ 생성 실패</div>
          <div className="mt-1 text-xs">{job.error_message ?? "알 수 없는 오류"}</div>
        </div>
      )}
      {job.status === "succeeded" && (
        <div className="card border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-emerald-900">
              ✓ <span className="font-semibold">에이전트 결과</span> · <strong>TC {job.tc_count}건</strong> 생성 완료
              {effectiveGroupId
                ? <span className="ml-2 text-xs text-emerald-700">· 종합 합본은 메인 페이지에서 확인</span>
                : job.output_filename && <span className="ml-2 font-mono text-xs text-emerald-700">{job.output_filename}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/api/tc-gen/${job.id}/download`} className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50">⬇ 이 에이전트 TC 다운로드</a>
              {effectiveGroupId && <Link href={`/tc-gen/group/${effectiveGroupId}`} className="rounded-md bg-kurly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kurly-600">종합 TC 보기</Link>}
            </div>
          </div>
          {preview && preview.groups.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {preview.groups.map((g) => (
                <span key={g.poc} className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] text-emerald-800">
                  {g.poc} <strong>{g.rows.length}</strong>
                </span>
              ))}
            </div>
          )}
          {effectiveGroupId && (
            <p className="mt-2 text-[11px] text-emerald-700">
              이 화면은 현재 에이전트 산출물만 보여줍니다. 합본 다운로드와 기능테스트 전송은 <strong>종합 TC</strong> 화면에서 진행하세요.
            </p>
          )}
        </div>
      )}

      {refineComparison && <TcRefineComparisonPanel comparison={refineComparison} />}

      {/* 생성 CSV 자동 품질 리뷰 */}
      {qualityReview && (
        <div className={`card p-4 ${
          qualityReview.grade === "A" ? "border-emerald-300 bg-emerald-50/40"
            : qualityReview.grade === "B" ? "border-blue-300 bg-blue-50/40"
              : qualityReview.grade === "C" ? "border-amber-300 bg-amber-50/40" : "border-rose-300 bg-rose-50/40"
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{effectiveGroupId ? "현재 에이전트 TC 품질 리뷰" : "TC 품질 리뷰"}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${
              qualityReview.grade === "A" ? "bg-emerald-500"
                : qualityReview.grade === "B" ? "bg-blue-500"
                  : qualityReview.grade === "C" ? "bg-amber-500" : "bg-rose-500"
            }`}>
              {qualityReview.grade} · {qualityReview.score}/100
            </span>
          </div>
          <div className="mt-2 text-xs text-neutral-700">
            전체 {qualityReview.totalRows}건 · error {qualityReview.issueCounts.error} · warn {qualityReview.issueCounts.warn}
          </div>
          <ReqCoveragePanel review={qualityReview} />
          {qualityReview.issues.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {qualityReview.issues.slice(0, 6).map((issue) => (
                <div key={`${issue.code}-${issue.message}`} className="rounded border border-neutral-200 bg-white px-2.5 py-2 text-xs">
                  <span className={`mr-1.5 font-semibold ${issue.severity === "error" ? "text-rose-600" : "text-amber-600"}`}>
                    {issue.severity.toUpperCase()}
                  </span>
                  <span className="font-mono text-neutral-500">{issue.code}</span>
                  <span className="ml-2 text-neutral-700">{issue.message}</span>
                  {issue.rows && issue.rows.length > 0 && (
                    <span className="ml-2 text-neutral-400">{issue.code === "MISSING_REQ_COVERAGE" ? "REQ" : "No."} {issue.rows.join(", ")}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {qualityReview.hints.length > 0 && (
            <div className="mt-2 text-[11px] text-neutral-500">
              {qualityReview.hints.slice(0, 2).join(" ")}
            </div>
          )}
          {qualityReview.score < AUTO_REFINE_THRESHOLD && (
            <AutoRefineButton id={job.id} score={qualityReview.score} threshold={AUTO_REFINE_THRESHOLD} max={2} />
          )}
        </div>
      )}

      {/* 🎯 하네스 품질 점수 (하네스 모드 tc 잡만) */}
      {job.harness_report && (() => {
        type HReport = {
          overall_pass?: boolean | null;
          compliance?: { score?: number | null; pass?: boolean } | null;
          mode_a?: { applicable?: boolean; all_axes_pass?: boolean; axis_scores?: Record<string, number> | null } | null;
          mode_c?: { weighted_avg?: number | null; pass?: boolean } | null;
          rounds?: number;
        };
        let r: HReport;
        try { r = JSON.parse(job.harness_report) as HReport; } catch { return null; }
        const pass = r.overall_pass === true;
        const ax = r.mode_a?.axis_scores ?? {};
        const axLabels: [string, string][] = [["field_recall", "Field Recall"], ["title_pattern", "Title"], ["vocabulary", "Vocabulary"], ["expansion", "Expansion"], ["distribution", "Distribution"]];
        const fmt = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));
        return (
          <div className={`card p-4 ${pass ? "border-emerald-300 bg-emerald-50/40" : "border-amber-300 bg-amber-50/40"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">🎯 하네스 품질 점수</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${pass ? "bg-emerald-500" : "bg-amber-500"}`}>
                종합 {pass ? "PASS ✓" : "FAIL"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              {r.compliance && (
                <div className="rounded border border-neutral-200 bg-white p-2.5">
                  <div className="text-neutral-500">스킬 게이트 (형식)</div>
                  <div className="mt-0.5 text-base font-bold">{r.compliance.score ?? "—"}<span className="text-[11px] font-normal text-neutral-400">/100</span> {r.compliance.pass ? "✅" : "⚠️"}</div>
                </div>
              )}
              {r.mode_a?.applicable && (
                <div className="rounded border border-neutral-200 bg-white p-2.5">
                  <div className="text-neutral-500">정답 대비 (Mode A)</div>
                  <div className="mt-0.5 text-base font-bold">{r.mode_a.all_axes_pass ? "전축 통과 ✅" : "미달 ⚠️"}</div>
                </div>
              )}
              {r.mode_c && (
                <div className="rounded border border-neutral-200 bg-white p-2.5">
                  <div className="text-neutral-500">기획 커버리지 (Mode C)</div>
                  <div className="mt-0.5 text-base font-bold">{typeof r.mode_c.weighted_avg === "number" ? fmt(r.mode_c.weighted_avg) : "—"}<span className="text-[11px] font-normal text-neutral-400">%</span> {r.mode_c.pass ? "✅" : "⚠️"}</div>
                </div>
              )}
            </div>
            {r.mode_a?.applicable && Object.keys(ax).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {axLabels.filter(([k]) => k in ax).map(([k, label]) => (
                  <span key={k} className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-700">
                    {label} <strong>{fmt(ax[k])}</strong>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-neutral-500">
              하네스 자동 품질 게이트 — 스킬 100점(형식) + 정답 대비 5축 99+ + 기획 커버리지 95%+ 가 합격 기준.
              {typeof r.rounds === "number" && r.rounds > 0 ? ` 개선 루프 ${r.rounds}회 수행.` : ""}
            </p>
          </div>
        );
      })()}

      {/* QA 관점 분석 (분석 포함 모드) */}
      {job.qa_analysis && (
        <details className="card border-violet-200 p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-violet-900">🔬 QA 관점 분석 (이 분석이 TC에 반영됨)</summary>
          <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-violet-50/50 p-3 text-[12px] leading-relaxed text-neutral-800">{job.qa_analysis}</pre>
        </details>
      )}

      {/* 개선 재생성 — 완료/실패 모두 가능 */}
      {(job.status === "succeeded" || job.status === "failed") && <RefinePanel id={job.id} />}

      {/* CSV 미리보기 — POC(시트분류)별로 분리. 긴 컬럼(사전조건/기대결과)은 2줄로 잘라 표시(hover 전체) */}
      {preview && preview.total > 0 && (
        <section className="space-y-3">
          <div className="text-xs text-neutral-500">에이전트 TC 미리보기 — 전체 {preview.total}건{preview.groups.length > 1 ? ` · POC ${preview.groups.length}종` : ""}</div>
          {preview.groups.map((g) => (
            <div key={g.poc} className="card p-0">
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
                <div className="text-sm font-medium text-neutral-700">
                  {g.poc === UNCLASSIFIED ? <span className="text-amber-600">{g.poc}</span> : g.poc}
                  <span className="ml-1.5 text-xs font-normal text-neutral-400">{g.rows.length}건</span>
                </div>
                <a
                  href={`/api/tc-gen/${job.id}/download?poc=${encodeURIComponent(g.poc)}`}
                  className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                  title={`${g.poc} TC만 CSV로 다운로드 (${g.rows.length}건)`}
                >
                  ⬇ TC 다운로드
                </a>
              </div>
              <PreviewTable rows={g.rows} />
            </div>
          ))}
          <div className="text-[11px] text-neutral-400">사전조건·기대결과는 2줄까지 표시 — 마우스 올리면 전체. 전체 내용은 각 POC의 <strong>⬇ TC 다운로드</strong>로 확인.</div>
        </section>
      )}

      {/* 진행 로그 */}
      {job.log && (
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-neutral-500">진행 로그</h2>
          <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-[11px] text-neutral-700">{job.log}</pre>
        </section>
      )}

      {/* 입력 컨텍스트 */}
      <details className="card p-4">
        <summary className="cursor-pointer text-xs font-semibold text-neutral-500">입력 컨텍스트 (도메인 · 기획서 · 포커스)</summary>
        <div className="mt-3 space-y-2 text-xs">
          <div><span className="text-neutral-400">도메인:</span> {domainLabel} ({getDomainById(job.domain)?.tcFolder})</div>
          {job.spec_url && <div className="break-all"><span className="text-neutral-400">기획 URL:</span> <span className="font-mono">{job.spec_url}</span></div>}
          {job.spec_filename && <div><span className="text-neutral-400">기획 PDF:</span> {job.spec_filename}</div>}
          {job.focus && <div><span className="text-neutral-400">포커스:</span> {job.focus}</div>}
          {job.spec_text && <div className="text-neutral-400">기획 본문 추출: {job.spec_text.length.toLocaleString()}자</div>}
        </div>
      </details>
    </div>
  );
}
