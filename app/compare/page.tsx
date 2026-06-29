import Link from "next/link";
import { listJobs } from "@/lib/jobs";
import { compareJobs } from "@/lib/compare";
import { formatDateTimeKR } from "@/lib/format-date";
import { ComparePicker, type PickerJob } from "./compare-picker";

export const dynamic = "force-dynamic";

const RESULT_STYLE: Record<string, string> = {
  PASS: "bg-emerald-100 text-emerald-700",
  FAIL: "bg-rose-100 text-rose-700",
  BLOCKED: "bg-amber-100 text-amber-700",
  "-": "bg-neutral-100 text-neutral-400",
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ jobs?: string }>;
}) {
  const sp = await searchParams;
  const ids = (sp.jobs ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  // picker 용 최근 완료 잡
  const recent = listJobs(100).filter((j) => ["succeeded", "failed", "canceled"].includes(j.status) && j.total > 0);
  const pickerJobs: PickerJob[] = recent.map((j) => ({
    id: j.id,
    label: j.task_name || j.tc_filename,
    domain: j.domain,
    created_at: j.created_at,
    summary: `${j.passed}P ${j.failed}F ${j.blocked}B / ${j.total}`,
  }));

  const cmp = ids.length >= 2 ? compareJobs(ids) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">결과 비교</h1>
          <p className="mt-1 text-sm text-neutral-600">여러 실행의 TC별 결과를 나란히 비교합니다 (fix 전후 등).</p>
        </div>
        <Link href="/history" className="btn-ghost text-sm">← 히스토리</Link>
      </div>

      <ComparePicker jobs={pickerJobs} preselected={ids} />

      {cmp && cmp.jobs.length >= 2 && (
        <>
          {/* 잡별 요약 + Δ */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-neutral-700">잡 요약</h2>
            <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: `repeat(${cmp.jobs.length}, minmax(0, 1fr))` }}>
              {cmp.jobs.map((j, i) => {
                const prev = i > 0 ? cmp.jobs[i - 1] : null;
                const dP = prev ? j.passed - prev.passed : 0;
                const dF = prev ? j.failed - prev.failed : 0;
                return (
                  <div key={j.id} className="rounded border border-neutral-200 p-3">
                    <Link href={`/jobs/${j.id}`} className="block truncate text-xs font-medium text-kurly-500 hover:underline">{j.label}</Link>
                    <div className="mt-1 text-[11px] text-neutral-400">{j.domain} · {formatDateTimeKR(j.created_at)}</div>
                    <div className="mt-2 text-sm">
                      <span className="text-emerald-600">{j.passed}P</span>{" · "}
                      <span className="text-rose-600">{j.failed}F</span>{" · "}
                      <span className="text-amber-600">{j.blocked}B</span>{" / "}{j.total}
                    </div>
                    {prev && (
                      <div className="mt-1 text-[11px]">
                        <span className={dP >= 0 ? "text-emerald-600" : "text-rose-600"}>Δ {dP >= 0 ? "+" : ""}{dP}P</span>{" "}
                        <span className={dF <= 0 ? "text-emerald-600" : "text-rose-600"}>{dF >= 0 ? "+" : ""}{dF}F</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* TC별 피벗 */}
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2">No</th>
                  <th className="px-3 py-2">TC Title</th>
                  {cmp.jobs.map((j, i) => (
                    <th key={j.id} className="px-3 py-2 text-center">#{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {cmp.rows.map((r) => {
                  // 결과가 잡마다 다르면 강조
                  const distinct = new Set(cmp.jobs.map((j) => r.results[j.id]));
                  const changed = distinct.size > 1;
                  return (
                    <tr key={r.tc_no} className={changed ? "bg-orange-50/40" : ""}>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.tc_no}</td>
                      <td className="px-3 py-1.5 max-w-[280px] truncate text-xs text-neutral-600" title={r.title ?? ""}>{r.title ?? "-"}</td>
                      {cmp.jobs.map((j) => {
                        const res = r.results[j.id] ?? "-";
                        return (
                          <td key={j.id} className="px-3 py-1.5 text-center">
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RESULT_STYLE[res] ?? RESULT_STYLE["-"]}`}>{res}</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-400">주황 배경 = 실행 간 결과가 달라진 TC.</p>
        </>
      )}

      {ids.length === 1 && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          비교하려면 잡을 2개 이상 선택하세요.
        </div>
      )}
    </div>
  );
}
