// F2 잡 컨텍스트 패널 — DB 에 저장되지만 그동안 UI 에 안 보이던 필드를 한 곳에.
// 서버 컴포넌트 (순수 읽기, <details> 로 접힘). null 필드는 자동 숨김.

import type { Job } from "@/lib/db";

function fmtModel(m: string | null): string {
  if (!m) return "워커 기본 (Sonnet)";
  if (m.toLowerCase().startsWith("codex")) return `Codex (${m})`;
  if (m.includes("opus")) return `Opus (${m})`;
  if (m.includes("sonnet")) return `Sonnet (${m})`;
  return m;
}

export function JobContextPanel({ job }: { job: Job }) {
  // analyzer_summary: CSV 자동분석 결과 JSON
  let analyzer: Record<string, unknown> | null = null;
  if (job.analyzer_summary) {
    try { analyzer = JSON.parse(job.analyzer_summary); } catch { analyzer = null; }
  }

  // tc_filenames: 다중 TC 파일 JSON array
  let tcFiles: string[] = [];
  if (job.tc_filenames) {
    try {
      const parsed = JSON.parse(job.tc_filenames);
      if (Array.isArray(parsed)) tcFiles = parsed;
    } catch { /* ignore */ }
  }

  const hasSpec = !!(job.spec_url || job.spec_filename || job.spec_text);
  const hasAnything =
    hasSpec || !!analyzer || tcFiles.length > 1 || !!job.adhoc_focus || !!job.claude_model;

  if (!hasAnything) return null;

  return (
    <details className="card p-5">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-500">
        잡 설정 컨텍스트 (분석 · 기획서 · 모델 · 파일)
      </summary>
      <div className="mt-4 space-y-4 text-sm">
        {/* 모델 */}
        {job.claude_model && (
          <div>
            <div className="text-xs font-medium text-neutral-500">실행 모델</div>
            <div className="mt-0.5 font-mono text-xs">{fmtModel(job.claude_model)}</div>
          </div>
        )}

        {/* 애드혹 포커스 */}
        {job.adhoc_focus && (
          <div>
            <div className="text-xs font-medium text-neutral-500">애드혹 탐색 포커스</div>
            <div className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-700">{job.adhoc_focus}</div>
          </div>
        )}

        {/* 다중 TC 파일 */}
        {tcFiles.length > 1 && (
          <div>
            <div className="text-xs font-medium text-neutral-500">TC 파일 ({tcFiles.length}개)</div>
            <ul className="mt-1 space-y-0.5">
              {tcFiles.map((f, i) => (
                <li key={i} className="font-mono text-xs text-neutral-700">{i + 1}. {f}</li>
              ))}
            </ul>
          </div>
        )}

        {/* CSV 자동 분석 */}
        {analyzer && (
          <div>
            <div className="text-xs font-medium text-neutral-500">CSV 자동 분석</div>
            <div className="mt-1 grid grid-cols-[110px_1fr] gap-y-0.5 text-xs text-neutral-700">
              {typeof analyzer.totalRows === "number" && (<><span className="text-neutral-400">전체 케이스</span><span className="font-mono">{String(analyzer.totalRows)}</span></>)}
              {analyzer.recommendedDomain != null && (<><span className="text-neutral-400">추천 도메인</span><span className="font-mono">{String(analyzer.recommendedDomain)}</span></>)}
              {analyzer.recommendedPlatform != null && (<><span className="text-neutral-400">추천 플랫폼</span><span className="font-mono">{String(analyzer.recommendedPlatform)}</span></>)}
            </div>
            {Array.isArray(analyzer.warnings) && analyzer.warnings.length > 0 && (
              <div className="mt-1 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                ⚠ {(analyzer.warnings as string[]).join(" / ")}
              </div>
            )}
          </div>
        )}

        {/* 기획 문서 (spec) */}
        {hasSpec && (
          <div>
            <div className="text-xs font-medium text-neutral-500">기획 문서</div>
            {job.spec_url && (
              <div className="mt-0.5 break-all text-xs">
                <span className="text-neutral-400">URL: </span>
                <span className="font-mono text-neutral-700">{job.spec_url}</span>
              </div>
            )}
            {job.spec_filename && (
              <div className="mt-0.5 text-xs">
                <span className="text-neutral-400">파일: </span>
                <span className="font-mono text-neutral-700">{job.spec_filename}</span>
              </div>
            )}
            {job.spec_text ? (
              <div className="mt-1">
                <div className="text-[11px] text-emerald-700">추출 본문 {job.spec_text.length.toLocaleString()}자</div>
                <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-[11px] text-neutral-600">
{job.spec_text.slice(0, 1200)}{job.spec_text.length > 1200 ? "\n…(생략)" : ""}
                </pre>
              </div>
            ) : (
              (job.spec_url || job.spec_filename) && (
                <div className="mt-1 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
                  ⚠ spec 본문이 비어 있습니다. 추출(Confluence fetch / PDF 파싱)이 실패했을 수 있어요.
                </div>
              )
            )}
          </div>
        )}
      </div>
    </details>
  );
}
