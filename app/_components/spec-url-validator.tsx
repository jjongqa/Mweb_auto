"use client";

// 잡 등록 전 기획서 URL 추출 가능 여부 미리 확인. upload/adhoc 양쪽에서 공유 (drift 방지).
// /api/jobs/validate-spec 호출 — Confluence 토큰/권한/URL 을 실행 전에 검증.

import { useState, useEffect } from "react";

interface ValidationRow { url: string; ok: boolean; length: number; reason: string | null }

export function SpecUrlValidator({ specUrl, requestedBy }: { specUrl: string; requestedBy?: string }) {
  const [validating, setValidating] = useState(false);
  const [results, setResults] = useState<ValidationRow[] | null>(null);

  // URL 이 바뀌면 이전 결과 무효화
  useEffect(() => { setResults(null); }, [specUrl]);

  if (!specUrl.trim()) return null;

  async function validate() {
    setValidating(true);
    setResults(null);
    try {
      const res = await fetch("/api/jobs/validate-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec_url: specUrl, requested_by: requestedBy || null }),
      });
      const json = await res.json();
      if (json.results) setResults(json.results);
      else setResults([{ url: "", ok: false, length: 0, reason: json.error || "검증 실패" }]);
    } catch (e) {
      setResults([{ url: "", ok: false, length: 0, reason: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={validate}
          disabled={validating}
          className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {validating ? "확인 중…" : "🔍 URL 추출 미리 확인"}
        </button>
        <span className="text-[11px] text-emerald-700">잡 실행 전에 Confluence 토큰/권한/URL을 검증합니다.</span>
      </div>
      {results && (
        <div className="mt-2 space-y-1">
          {results.map((r, i) => (
            <div
              key={i}
              className={`rounded border px-2 py-1.5 text-[11px] ${r.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}
            >
              {r.ok ? "✓" : "✗"} <span className="break-all font-mono">{r.url || "(URL)"}</span>
              {r.ok ? <span className="ml-1">— 추출 {r.length.toLocaleString()}자</span> : <span className="ml-1">— {r.reason}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
