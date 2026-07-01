import Link from "next/link";
import { notFound } from "next/navigation";
import { getTcGenJob, mergeTcGenGroupAnalysis, reviewQaDesignQuality } from "@/lib/tc-gen";
import { getDomainById } from "@/lib/domains";
import { formatDateTimeKR, formatDuration } from "@/lib/format-date";
import { PollUntilDone } from "@/app/tc-gen/[id]/poll-until-done";
import { RefinePanel } from "@/app/tc-gen/[id]/refine-panel";
import { TcGenGroupBanner } from "@/app/tc-gen/[id]/group-banner";
import { AgentRunway, getRunwayAgents } from "@/app/_components/agent-runway";
import { ToTcButton } from "./to-tc-button";

export const dynamic = "force-dynamic";

export default async function QaDesignStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getTcGenJob(id);
  if (!job || job.kind !== "design") notFound();

  const isActive = job.status === "pending" || job.status === "running";
  const domainLabel = getDomainById(job.domain)?.label ?? job.domain;
  const mergedAnalysis = job.agent_group_id ? mergeTcGenGroupAnalysis(job.agent_group_id) : null;
  const designReview = job.status === "succeeded" && job.qa_analysis
    ? reviewQaDesignQuality(mergedAnalysis || job.qa_analysis)
    : null;
  const runwayAgents = getRunwayAgents({
    workerName: job.worker_name || job.target_worker,
    group: "design",
    nicknames: job.agent_nickname ? [job.agent_nickname] : [],
  });

  return (
    <div className="space-y-5">
      <PollUntilDone status={job.status} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{job.task_name || `${domainLabel} QA 설계`}</h1>
          <div className="mt-1 text-xs text-neutral-500">
            🔬 QA 설계 · {domainLabel} · {formatDateTimeKR(job.created_at)}
            {job.duration_sec != null && <> · {formatDuration(job.duration_sec)}</>}
            {job.requested_by && <> · {job.requested_by}</>}
          </div>
        </div>
        <Link href="/qa-design" className="btn-ghost text-sm">← QA 설계</Link>
      </div>

      {/* 지시 기반 병렬(설계) 그룹 — 형제 잡 + 아래 합본 분석 */}
      {job.agent_group_id && <TcGenGroupBanner groupId={job.agent_group_id} basePath="/qa-design" />}

      {mergedAnalysis && (
        <section className="card border-kurly-200 p-5">
          <h2 className="mb-2 text-sm font-semibold text-kurly-900">🔬 합본 QA 설계 (에이전트별 분석 통합)</h2>
          <pre className="max-h-[560px] overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-4 text-[13px] leading-relaxed text-neutral-800">{mergedAnalysis}</pre>
        </section>
      )}

      {/* 개선 계보 */}
      {job.parent_id && (
        <div className="card border-neutral-200 bg-neutral-50 p-3 text-xs">
          <Link href={`/qa-design/${job.parent_id}`} className="font-medium text-violet-700 hover:underline">← 원본 설계 보기</Link>
          {job.refine_instructions && <div className="mt-1 text-neutral-600"><span className="text-neutral-400">적용된 개선 지시:</span> {job.refine_instructions}</div>}
        </div>
      )}

      {isActive && (
        <>
          <AgentRunway agents={runwayAgents} progress={job.status === "running" ? 42 : 12} phase="design" status={job.status === "pending" ? "pending" : "running"} />
          <div className="card border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <span className="font-medium">⏳ {job.status === "pending" ? "대기 중" : "QA 설계 분석 중"}…</span>
            <span className="ml-2 text-xs text-blue-700">Claude가 기획서를 QA 관점으로 분석하고 있어요. 3초마다 자동 갱신.</span>
          </div>
        </>
      )}
      {job.status === "failed" && (
        <div className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="font-medium">✗ 설계 실패</div>
          <div className="mt-1 text-xs">{job.error_message ?? "알 수 없는 오류"}</div>
        </div>
      )}

      {/* 분석 결과 */}
      {job.status === "succeeded" && job.qa_analysis && (
        <>
          <div className="card border-neutral-200 bg-neutral-50 p-4">
            <div className="text-sm font-medium text-neutral-700">✓ QA 설계 완료 — 검토 후 TC생성으로 보내기</div>
            <p className="mb-3 mt-1 text-[11px] text-neutral-700">아쉬우면 아래 <strong>개선 지시</strong>로 다듬을 수 있어요. 대상 POC를 고르고 보내면 이 분석을 반영한 TC가 POC별로 생성됩니다.</p>
            <ToTcButton id={job.id} domain={job.domain} />
          </div>

          {designReview && (
            <section className={`card p-4 ${
              designReview.grade === "A" ? "border-emerald-300 bg-emerald-50/40"
                : designReview.grade === "B" ? "border-blue-300 bg-blue-50/40"
                  : designReview.grade === "C" ? "border-amber-300 bg-amber-50/40" : "border-rose-300 bg-rose-50/40"
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">설계 품질 리뷰</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${
                  designReview.grade === "A" ? "bg-emerald-500"
                    : designReview.grade === "B" ? "bg-blue-500"
                      : designReview.grade === "C" ? "bg-amber-500" : "bg-rose-500"
                }`}>
                  {designReview.grade} · {designReview.score}/100
                </span>
              </div>
              <div className="mt-2 text-xs text-neutral-700">
                REQ {designReview.reqIds.length}개 · error {designReview.issueCounts.error} · warn {designReview.issueCounts.warn}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["REQ 인벤토리", designReview.checks.reqInventory],
                  ["TC 매트릭스", designReview.checks.tcMatrix],
                  ["커버리지 전략", designReview.checks.coverageStrategy],
                  ["모호점 분리", designReview.checks.ambiguity],
                  ["리스크", designReview.checks.risk],
                  ["우선순위", designReview.checks.priority],
                  ["POC/플랫폼", designReview.checks.pocOrPlatform],
                ].map(([label, ok]) => (
                  <div key={String(label)} className={`rounded border px-2.5 py-2 text-xs ${
                    ok ? "border-emerald-200 bg-white text-emerald-800" : "border-amber-200 bg-white text-amber-800"
                  }`}>
                    <span className="font-semibold">{ok ? "OK" : "확인"}</span>
                    <span className="ml-1.5 text-neutral-700">{label}</span>
                  </div>
                ))}
              </div>
              {designReview.reqIds.length > 0 && (
                <div className="mt-3 max-h-24 overflow-y-auto rounded border border-neutral-200 bg-white p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {designReview.reqIds.map((reqId) => (
                      <span key={reqId} className="rounded-full border border-neutral-200 px-2 py-0.5 font-mono text-[11px] text-neutral-700">{reqId}</span>
                    ))}
                  </div>
                </div>
              )}
              {designReview.issues.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {designReview.issues.slice(0, 5).map((issue) => (
                    <div key={`${issue.code}-${issue.message}`} className="rounded border border-neutral-200 bg-white px-2.5 py-2 text-xs">
                      <span className={`mr-1.5 font-semibold ${issue.severity === "error" ? "text-rose-600" : "text-amber-600"}`}>
                        {issue.severity.toUpperCase()}
                      </span>
                      <span className="font-mono text-neutral-500">{issue.code}</span>
                      <span className="ml-2 text-neutral-700">{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {designReview.hints.length > 0 && (
                <div className="mt-2 text-[11px] text-neutral-500">{designReview.hints.slice(0, 2).join(" ")}</div>
              )}
            </section>
          )}

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">QA 관점 분석</h2>
            <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-4 text-[13px] leading-relaxed text-neutral-800">{job.qa_analysis}</pre>
          </section>

          {/* 피드백 재생성 (design refine) */}
          <RefinePanel id={job.id} basePath="/qa-design" />
        </>
      )}

      {/* 진행 로그 */}
      {job.log && (
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-neutral-500">진행 로그</h2>
          <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-[11px] text-neutral-700">{job.log}</pre>
        </section>
      )}
    </div>
  );
}
