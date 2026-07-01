import Link from "next/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import {
  getEffectiveTcGenGroupJobs,
  getTcGenGroupSiblings,
  mergeTcGenGroupCsv,
  parseJobPocs,
  resolveTcOutputPath,
  reviewTcCsvQuality,
  tcGenGroupSummary,
  AUTO_REFINE_THRESHOLD,
  type TcGenJob,
} from "@/lib/tc-gen";
import { getDomainById } from "@/lib/domains";
import { formatDateTimeKR } from "@/lib/format-date";
import { normalizePoc, POC_IDS } from "@/lib/pocs";
import { splitCsvLines, parseCsvRow } from "@/lib/csv-parser";
import { TcGenGroupBanner } from "../../[id]/group-banner";
import { GroupAutoRefineButton } from "../../[id]/group-auto-refine-button";
import { ReqCoveragePanel } from "../../req-coverage-panel";
import { GroupIssueRefineButton } from "./issue-refine-button";
import { AgentRunway, getRunwayAgents } from "@/app/_components/agent-runway";

export const dynamic = "force-dynamic";

const UNCLASSIFIED = "(미분류)";

type QualityReview = ReturnType<typeof reviewTcCsvQuality>;

type PreviewRow = {
  no: string;
  poc: string;
  title: string;
  path: string;
  precond: string;
  expected: string;
};

type PreviewGroup = { poc: string; rows: PreviewRow[] };

type GroupComparison = {
  beforeCount: number;
  afterCount: number;
  scoreBefore: number;
  scoreAfter: number;
  scoreDiff: number;
  errorBefore: number;
  errorAfter: number;
  warnBefore: number;
  warnAfter: number;
  missingBefore: number;
  missingAfter: number;
  newlyCovered: string[];
  newlyMissing: string[];
  added: number;
  removed: number;
  changed: number;
};

function stripAgentSuffix(title: string | null | undefined, nickname?: string | null): string {
  let t = (title || "종합 TC").replace(/\s*\(개선\s*\d+\)\s*$/, "").trim();
  if (nickname && t.endsWith(`[${nickname}]`)) t = t.slice(0, -`[${nickname}]`.length).trim() || t;
  while (/\s*\[[^\]]+\]\s*$/.test(t)) t = t.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  return t || title || "종합 TC";
}

function readJobCsv(job: TcGenJob): string | null {
  const outputPath = resolveTcOutputPath(job.output_path);
  if (!outputPath || !fs.existsSync(outputPath)) return null;
  try {
    return fs.readFileSync(outputPath, "utf-8");
  } catch {
    return null;
  }
}

function mergeJobsCsv(jobs: TcGenJob[]): { csv: string; count: number } | null {
  let header: string | null = null;
  const data: string[] = [];
  for (const job of jobs) {
    const text = readJobCsv(job)?.replace(/^﻿/, "");
    if (!text) continue;
    const lines = splitCsvLines(text);
    if (lines.length < 1) continue;
    if (!header) header = lines[0];
    data.push(...lines.slice(1).filter((line) => line.trim()));
  }
  if (!header || data.length === 0) return null;
  const renumbered = data.map((line, i) => line.replace(/^[^,]*/, String(i + 1)));
  return { csv: [header, ...renumbered].join("\n"), count: data.length };
}

function reviewJob(job: TcGenJob): QualityReview | null {
  const csv = readJobCsv(job);
  if (!csv) return null;
  return reviewTcCsvQuality(csv, {
    domain: job.domain,
    pocs: parseJobPocs(job.pocs),
    focus: job.focus,
    designAnalysis: job.qa_analysis,
  });
}

function pocCounts(csv: string): { poc: string; count: number }[] {
  const lines = splitCsvLines(csv.replace(/^﻿/, ""));
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
  const iPoc = ["시트분류", "poc", "sheet"].map((name) => header.indexOf(name)).find((i) => i >= 0) ?? -1;
  const counts = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const cols = parseCsvRow(line);
    if (!cols.some((x) => x.trim())) continue;
    const poc = iPoc >= 0 ? normalizePoc(cols[iPoc] ?? "") ?? UNCLASSIFIED : UNCLASSIFIED;
    counts.set(poc, (counts.get(poc) ?? 0) + 1);
  }
  return [...POC_IDS, UNCLASSIFIED]
    .map((poc) => ({ poc, count: counts.get(poc) ?? 0 }))
    .filter((x) => x.count > 0);
}

function previewGroups(csv: string): PreviewGroup[] {
  const lines = splitCsvLines(csv.replace(/^﻿/, ""));
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (...names: string[]) => {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iNo = idx("no", "no.");
  const iPoc = idx("시트분류", "poc", "sheet");
  const iTitle = idx("title", "test scenario (시나리오)", "test scenario", "시나리오", "scenario");
  const i1 = idx("1depth");
  const i2 = idx("2depth");
  const i3 = idx("3depth");
  const iPre = idx("pre-condition (사전조건)", "pre-condition", "precondition", "사전조건");
  const iExp = idx("expected results (예상결과)", "expected result", "expected results", "expected", "기대결과", "예상결과");
  const get = (cols: string[], i: number) => (i >= 0 ? (cols[i] ?? "").trim() : "");
  const rows: PreviewRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    if (!cols.some((x) => x.trim())) continue;
    rows.push({
      no: get(cols, iNo) || String(i),
      poc: iPoc >= 0 ? normalizePoc(get(cols, iPoc)) ?? UNCLASSIFIED : UNCLASSIFIED,
      title: get(cols, iTitle),
      path: [get(cols, i1), get(cols, i2), get(cols, i3)].filter(Boolean).join(" > "),
      precond: get(cols, iPre),
      expected: get(cols, iExp),
    });
  }
  return [...POC_IDS, UNCLASSIFIED]
    .map((poc) => ({ poc, rows: rows.filter((row) => row.poc === poc) }))
    .filter((group) => group.rows.length > 0)
    .map((group) => ({ ...group, rows: group.rows.map((row, i) => ({ ...row, no: String(i + 1) })) }));
}

function rowCompareKey(row: PreviewRow): string {
  return `${row.poc}::${row.title.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

function rowSignature(row: PreviewRow): string {
  return [row.title, row.precond, row.path, row.expected].map((v) => v.replace(/\s+/g, " ").trim().toLowerCase()).join("||");
}

function buildGroupComparison(
  beforeCsv: string | null,
  afterCsv: string | null,
  beforeReview: QualityReview | null,
  afterReview: QualityReview | null
): GroupComparison | null {
  if (!beforeCsv || !afterCsv || !beforeReview || !afterReview) return null;
  const beforeRows = previewGroups(beforeCsv).flatMap((group) => group.rows);
  const afterRows = previewGroups(afterCsv).flatMap((group) => group.rows);
  const beforeMap = new Map(beforeRows.map((row) => [rowCompareKey(row), row]));
  const afterMap = new Map(afterRows.map((row) => [rowCompareKey(row), row]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const row of afterRows) {
    const before = beforeMap.get(rowCompareKey(row));
    if (!before) added++;
    else if (rowSignature(before) !== rowSignature(row)) changed++;
  }
  for (const row of beforeRows) {
    if (!afterMap.has(rowCompareKey(row))) removed++;
  }
  const beforeMissing = new Set(beforeReview.coverage?.missingReqIds ?? []);
  const afterMissing = new Set(afterReview.coverage?.missingReqIds ?? []);
  const afterCovered = new Set(afterReview.coverage?.coveredReqIds ?? []);
  return {
    beforeCount: beforeRows.length,
    afterCount: afterRows.length,
    scoreBefore: beforeReview.score,
    scoreAfter: afterReview.score,
    scoreDiff: afterReview.score - beforeReview.score,
    errorBefore: beforeReview.issueCounts.error,
    errorAfter: afterReview.issueCounts.error,
    warnBefore: beforeReview.issueCounts.warn,
    warnAfter: afterReview.issueCounts.warn,
    missingBefore: beforeMissing.size,
    missingAfter: afterMissing.size,
    newlyCovered: [...beforeMissing].filter((req) => afterCovered.has(req)),
    newlyMissing: [...afterMissing].filter((req) => !beforeMissing.has(req)),
    added,
    removed,
    changed,
  };
}

function DeltaBox({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  return (
    <div className={`rounded border px-3 py-2 text-xs ${
      good === true ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : good === false ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-neutral-200 bg-white text-neutral-700"
    }`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function GroupComparisonPanel({ comparison }: { comparison: GroupComparison }) {
  return (
    <section className="card border-blue-200 bg-blue-50/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-blue-950">종합 TC 개선 전/후 비교</h2>
        <div className="text-xs text-blue-700">초기 합본 {comparison.beforeCount}건 → 최고 품질 합본 {comparison.afterCount}건</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <DeltaBox
          label="품질 점수"
          value={`${comparison.scoreBefore} → ${comparison.scoreAfter} (${comparison.scoreDiff >= 0 ? "+" : ""}${comparison.scoreDiff})`}
          good={comparison.scoreDiff > 0 ? true : comparison.scoreDiff < 0 ? false : null}
        />
        <DeltaBox
          label="REQ 미커버"
          value={`${comparison.missingBefore} → ${comparison.missingAfter}`}
          good={comparison.missingAfter < comparison.missingBefore ? true : comparison.missingAfter > comparison.missingBefore ? false : null}
        />
        <DeltaBox label="추가/삭제" value={`+${comparison.added} / -${comparison.removed}`} good={null} />
        <DeltaBox label="내용 변경" value={`${comparison.changed}건`} good={comparison.changed > 0 ? null : true} />
      </div>
      <div className="mt-2 text-[11px] text-neutral-500">
        이슈 변화: error {comparison.errorBefore} → {comparison.errorAfter}, warn {comparison.warnBefore} → {comparison.warnAfter}
      </div>
      {(comparison.newlyCovered.length > 0 || comparison.newlyMissing.length > 0) && (
        <div className="mt-2 rounded border border-blue-100 bg-white px-2.5 py-2 text-[11px] text-neutral-600">
          {comparison.newlyCovered.length > 0 && <div>새로 커버됨: {comparison.newlyCovered.join(", ")}</div>}
          {comparison.newlyMissing.length > 0 && <div className="text-rose-700">새 미커버: {comparison.newlyMissing.join(", ")}</div>}
        </div>
      )}
    </section>
  );
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <div className="max-h-[360px] overflow-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="sticky top-0 z-10 bg-neutral-50 text-left text-xs text-neutral-500 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
          <tr>
            <th className="w-12 px-3 py-2">No</th>
            <th className="min-w-[220px] px-3 py-2">Title</th>
            <th className="min-w-[220px] px-3 py-2">사전조건</th>
            <th className="min-w-[140px] px-3 py-2">경로</th>
            <th className="min-w-[260px] px-3 py-2">기대결과</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 align-top">
          {rows.map((row, i) => (
            <tr key={`${row.poc}-${row.no}-${i}`} className="hover:bg-neutral-50">
              <td className="px-3 py-1.5 font-mono text-xs text-neutral-500">{row.no}</td>
              <td className="px-3 py-1.5 text-xs">{row.title}</td>
              <td className="px-3 py-1.5 text-[11px] text-neutral-600">
                <div className="line-clamp-2 max-w-[300px] whitespace-pre-wrap" title={row.precond}>{row.precond || "-"}</div>
              </td>
              <td className="px-3 py-1.5 text-[11px] text-neutral-500">{row.path || "-"}</td>
              <td className="px-3 py-1.5 text-[11px] text-neutral-600">
                <div className="line-clamp-2 max-w-[360px] whitespace-pre-wrap" title={row.expected}>{row.expected || "-"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function gradeClass(grade: string) {
  if (grade === "A") return "bg-emerald-500";
  if (grade === "B") return "bg-blue-500";
  if (grade === "C") return "bg-amber-500";
  return "bg-rose-500";
}

function qualityCardClass(grade: string) {
  if (grade === "A") return "border-emerald-300 bg-emerald-50/40";
  if (grade === "B") return "border-blue-300 bg-blue-50/40";
  if (grade === "C") return "border-amber-300 bg-amber-50/40";
  return "border-rose-300 bg-rose-50/40";
}

export default async function TcGenGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const summary = tcGenGroupSummary(groupId);
  if (!summary || summary.kind !== "tc") notFound();

  const originals = getTcGenGroupSiblings(groupId).filter((j) => j.kind === "tc");
  const effectiveJobs = getEffectiveTcGenGroupJobs(groupId).filter((j) => j.kind === "tc");
  const seed = originals[0] ?? effectiveJobs[0];
  const domainLabel = getDomainById(seed.domain)?.label ?? seed.domain;
  const title = stripAgentSuffix(seed.task_name, seed.agent_nickname);
  const merged = mergeTcGenGroupCsv(groupId);
  const originalMerged = mergeJobsCsv(originals.filter((j) => j.status === "succeeded" && j.output_path));
  const originalGroupReview = originalMerged
    ? reviewTcCsvQuality(originalMerged.csv, {
        domain: seed.domain,
        pocs: parseJobPocs(seed.pocs),
        focus: originals.map((j) => j.focus).filter(Boolean).join("\n\n"),
        designAnalysis: originals.map((j) => j.qa_analysis).filter(Boolean).join("\n\n"),
        scope: "group",
      })
    : null;
  const groupReview = merged
    ? reviewTcCsvQuality(merged.csv, {
        domain: seed.domain,
        pocs: parseJobPocs(seed.pocs),
        focus: effectiveJobs.map((j) => j.focus).filter(Boolean).join("\n\n"),
        designAnalysis: effectiveJobs.map((j) => j.qa_analysis).filter(Boolean).join("\n\n"),
        scope: "group",
      })
    : null;
  const groupComparison = buildGroupComparison(originalMerged?.csv ?? null, merged?.csv ?? null, originalGroupReview, groupReview);
  const pocs = merged ? pocCounts(merged.csv) : [];
  const previews = merged ? previewGroups(merged.csv) : [];
  const agents = effectiveJobs.map((job) => ({ job, review: reviewJob(job) }));
  const lowAgents = agents.filter((a) => (a.review?.score ?? 0) < AUTO_REFINE_THRESHOLD);
  const agentGatePass = lowAgents.length === 0;
  const runwayAgents = getRunwayAgents({
    workerName: seed.worker_name || seed.target_worker,
    group: "write",
    nicknames: summary.jobs.map((j) => j.agent_nickname),
    fallbackCount: summary.total,
  });
  const groupProgress = summary.total > 0 ? Math.max(10, Math.min(92, (summary.done / summary.total) * 100)) : 12;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-kurly-600">종합 TC 메인</div>
          <h1 className="mt-1 truncate text-xl font-semibold">{title}</h1>
          <div className="mt-1 text-xs text-neutral-500">
            {domainLabel} · {formatDateTimeKR(seed.created_at)} · 메인 에이전트 · 종합 취합 · 작성 에이전트 {summary.total}명
          </div>
        </div>
        <Link href="/tc-gen" className="btn-ghost text-sm">← TC 생성</Link>
      </div>

      {summary.status === "running" && (
        <>
          <AgentRunway agents={runwayAgents} progress={groupProgress} phase="write" status="running" />
          <TcGenGroupBanner groupId={groupId} basePath="/tc-gen" />
        </>
      )}

      {merged ? (
        <section className="card border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-emerald-900">
              ✓ <span className="font-semibold">최종 합본</span> · <strong>TC {merged.count}건</strong>
              <span className="ml-2 text-xs text-emerald-700">에이전트별 최고 품질 개선본 반영 기준</span>
              {!agentGatePass && <span className="ml-2 text-xs font-semibold text-amber-700">· 에이전트 보완 필요</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/api/tc-gen/group/download?groupId=${encodeURIComponent(groupId)}`} className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50">⬇ 전체 TC 다운로드</a>
              <Link href={`/upload?tcGenId=${seed.id}&tcGenGroupId=${groupId}`} className="rounded-md bg-kurly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kurly-600">🚀 기능테스트로 보내기</Link>
            </div>
          </div>
          {pocs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {pocs.map((p) => (
                <a
                  key={p.poc}
                  href={`/api/tc-gen/group/download?groupId=${encodeURIComponent(groupId)}&poc=${encodeURIComponent(p.poc)}`}
                  className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] text-emerald-800 hover:bg-emerald-50"
                  title={`${p.poc} TC 다운로드`}
                >
                  {p.poc} <strong>{p.count}</strong>
                </a>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="card border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <span className="font-medium">⏳ 종합 TC 생성 진행 중</span>
          <span className="ml-2 text-xs text-blue-700">에이전트 결과가 완료되면 합본과 품질 리뷰가 이 화면에 표시됩니다.</span>
        </section>
      )}

      {groupComparison && <GroupComparisonPanel comparison={groupComparison} />}

      {groupReview && !agentGatePass && (
        <section className="card border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-950">에이전트 품질 게이트 미통과</h2>
              <p className="mt-1 text-xs text-amber-800">
                합본 점수는 {groupReview.score}/100이지만, 에이전트별 산출물 중 기준({AUTO_REFINE_THRESHOLD}점) 미만이 있어 최종 판정은 보완 필요로 봅니다.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lowAgents.map(({ job, review }) => (
                  <Link
                    key={job.id}
                    href={`/tc-gen/${job.id}`}
                    className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-50"
                  >
                    {job.agent_nickname || "에이전트"} {review?.grade ?? "-"} · {review?.score ?? 0}
                  </Link>
                ))}
              </div>
            </div>
            <GroupAutoRefineButton
              agents={agents.map(({ job, review }) => ({ id: job.id, score: review?.score ?? 0 }))}
              threshold={AUTO_REFINE_THRESHOLD}
            />
          </div>
        </section>
      )}

      {groupReview && (
        <section className={`card p-4 ${qualityCardClass(groupReview.grade)}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">종합 TC 품질 리뷰</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {!agentGatePass && <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-semibold text-white">보완 필요</span>}
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${gradeClass(groupReview.grade)}`}>
                {groupReview.grade} · {groupReview.score}/100
              </span>
            </div>
          </div>
          <div className="mt-2 text-xs text-neutral-700">
            합본 {groupReview.totalRows}건 · error {groupReview.issueCounts.error} · warn {groupReview.issueCounts.warn}
            {!agentGatePass && <span className="ml-2 text-amber-700">· 에이전트 미달 {lowAgents.length}명</span>}
          </div>
          <ReqCoveragePanel review={groupReview} />
          {groupReview.issues.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {groupReview.issues.slice(0, 6).map((issue) => (
                <div key={`${issue.code}-${issue.message}`} className="rounded border border-neutral-200 bg-white px-2.5 py-2 text-xs">
                  <span className={`mr-1.5 font-semibold ${issue.severity === "error" ? "text-rose-600" : "text-amber-600"}`}>{issue.severity.toUpperCase()}</span>
                  <span className="font-mono text-neutral-500">{issue.code}</span>
                  <span className="ml-2 text-neutral-700">{issue.message}</span>
                  {issue.rows && issue.rows.length > 0 && <span className="ml-2 text-neutral-400">{issue.code === "MISSING_REQ_COVERAGE" ? "REQ" : "No."} {issue.rows.join(", ")}</span>}
                </div>
              ))}
              <GroupIssueRefineButton
                agents={agents.map(({ job, review }) => ({
                  id: job.id,
                  nickname: job.agent_nickname || "에이전트",
                  score: review?.score ?? 0,
                  error: review?.issueCounts.error ?? 0,
                  warn: review?.issueCounts.warn ?? 0,
                }))}
                issues={groupReview.issues}
                groupScore={groupReview.score}
                groupTotalRows={groupReview.totalRows}
                threshold={AUTO_REFINE_THRESHOLD}
              />
            </div>
          )}
        </section>
      )}

      {previews.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-neutral-800">종합 TC 미리보기</h2>
            <div className="text-xs text-neutral-500">합본 CSV 기준 · 전체 {merged?.count ?? 0}건</div>
          </div>
          {previews.map((group) => (
            <div key={group.poc} className="card p-0">
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
                <div className="text-sm font-medium text-neutral-700">
                  {group.poc === UNCLASSIFIED ? <span className="text-amber-600">{group.poc}</span> : group.poc}
                  <span className="ml-1.5 text-xs font-normal text-neutral-400">{group.rows.length}건</span>
                </div>
                <a
                  href={`/api/tc-gen/group/download?groupId=${encodeURIComponent(groupId)}&poc=${encodeURIComponent(group.poc)}`}
                  className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                  title={`${group.poc} TC만 CSV로 다운로드 (${group.rows.length}건)`}
                >
                  ⬇ TC 다운로드
                </a>
              </div>
              <PreviewTable rows={group.rows} />
            </div>
          ))}
          <div className="text-[11px] text-neutral-400">
            사전조건·기대결과는 2줄까지 표시됩니다. 전체 내용은 각 POC의 <strong>⬇ TC 다운로드</strong>로 확인하세요.
          </div>
        </section>
      )}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">에이전트 결과물</h2>
          <div className="text-xs text-neutral-500">개별 결과/개선 전후 비교는 각 에이전트 페이지에서 확인</div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map(({ job, review }) => {
            const original = originals.find((o) => o.id === job.id || o.agent_nickname === job.agent_nickname);
            const refined = original && original.id !== job.id;
            return (
              <Link key={job.id} href={`/tc-gen/${job.id}`} className="rounded border border-neutral-200 bg-white px-3 py-3 text-xs hover:bg-neutral-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-neutral-800">{job.agent_nickname || "에이전트"}</span>
                  {review && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${gradeClass(review.grade)}`}>{review.grade} · {review.score}</span>}
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  TC {job.tc_count}건 · {job.status === "succeeded" ? "완료" : job.status}
                  {refined && <span className="ml-1 text-blue-600">· 개선본 적용</span>}
                </div>
                {review && (
                  <div className="mt-1 text-[11px] text-neutral-500">
                    error {review.issueCounts.error} · warn {review.issueCounts.warn}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
