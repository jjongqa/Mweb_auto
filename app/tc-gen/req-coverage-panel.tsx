type CoverageReview = {
  coverage?: {
    requiredReqIds: string[];
    taggedReqIds?: string[];
    coveredReqIds: string[];
    missingReqIds: string[];
  };
};

export function ReqCoveragePanel({ review }: { review: CoverageReview }) {
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
