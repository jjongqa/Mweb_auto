"use client";

import { useEffect, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.work-verify.v2";

const CLUSTER_CENTER_MAP: Record<string, [string, string][]> = {
  CC02: [["GGH1", "김포상온"], ["GGM1", "김포냉장"], ["GGL1", "김포냉동"], ["GGHUB1", "김포허브"], ["GGQ1", "김포QC"], ["GGC1", "김포CS"], ["GGR1", "김포회수"], ["GGH3", "김포롱테일"], ["GGIM1", "김포재고관리"]],
  CC03: [["GPH1", "평택상온"], ["GPM1", "평택냉장"], ["GPL1", "평택냉동"], ["GPHS1", "평택상온SIOC"], ["GPHUB1", "평택허브"], ["GPQ1", "평택QC"], ["GPC1", "평택CS"], ["GPR1", "평택 통합회수"], ["GPH2", "평택 부자재"], ["GPH3", "평택뷰티"], ["GPIM1", "평택재고관리"]],
  CC04: [["KCH1", "창원상온"], ["KCM1", "창원냉장"], ["KCL1", "창원냉동"], ["KCHUB1", "창원허브"], ["KCQ1", "창원QC"], ["KCC1", "창원CS"], ["KCR1", "창원회수"], ["KCIM1", "창원재고관리"]],
  MC01: [["MC01", "DMC"], ["MC02", "도곡"]],
};
const CLUSTERS = Object.keys(CLUSTER_CENTER_MAP);
const WORK_PARTS = ["IB", "OB", "QC", "IM"];
// 근무 유형 48종 (원본 4_work_schedule_verify.py WORK_TYPES)
const WORK_TYPES = [
  "근무", "휴일", "연차", "오전퍼플", "오후퍼플", "오전반차", "오후반차",
  "오전반반차", "오후반반차", "퍼/반", "오전퍼플/오후반반차", "오전반반차/오후반차",
  "오전반차/오후반반차", "오전반반차/오후퍼플", "반반/반반", "반반/생일", "생일",
  "공가", "공/반", "공/반반", "공/퍼", "퇴사", "병가", "병가(산재)",
  "출산휴가", "출산휴가(배우자)", "태아검진휴가", "태/반", "태/퍼", "태/반반",
  "결근", "무단결근", "경조", "보건휴가", "가족돌봄휴가", "포상휴가", "장기근속휴가",
  "육아휴직", "가족돌봄휴직", "일반휴직", "교육(입사)", "교육(지게차)", "교육(안전)",
  "출장", "출장(특)", "특근", "기타", "무급휴가",
];

interface Check { group: string; label: string; statVal: number | null; listVal: number | null; filterVal: number | null; pass: boolean }
interface Result { ok: boolean; error?: string; summary?: { total: number; passed: number; failed: number }; listTotal?: number; checks?: Check[]; charts?: any }
interface StepEvent { type: "step"; ok: boolean; message: string }

function today() { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

interface FormState { adminId: string; cluster: string; center: string; workPart: string; startDate: string; endDate: string; workTypes: string[] }
const INITIAL: FormState = { adminId: "autoqa99", cluster: "CC02", center: "", workPart: "", startDate: today(), endDate: today(), workTypes: [] };

export default function WorkVerifyForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [adminPw, setAdminPw] = useState("kurly12@");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { try { const s = localStorage.getItem(LS_KEY); if (s) setForm((p) => ({ ...p, ...JSON.parse(s) })); } catch {} }, []);
  useEffect(() => { if (!running) { try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {} } }, [form, running]);
  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));
  const centerOpts = CLUSTER_CENTER_MAP[form.cluster] || [];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (!form.adminId.trim() || !adminPw.trim()) { setError("어드민 ID/PW 필요"); return; }
    setRunning(true); setSteps([]); setResult(null); setError(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/logistics-work-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, workTypes: form.workTypes.join(","), adminPw }), signal: ctrl.signal });
      if (!res.ok || !res.body) { const t = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let nl;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
          if (!chunk.startsWith("data:")) continue;
          try { const p = JSON.parse(chunk.slice(5).trim());
            if (p.kind === "progress") setSteps((x) => [...x, p.event]);
            else if (p.kind === "done") setResult(p.result);
            else if (p.kind === "fatal") setError(p.error);
          } catch {}
        }
      }
    } catch (err) { if (!(err instanceof Error && err.name === "AbortError")) setError(err instanceof Error ? err.message : String(err)); }
    finally { setRunning(false); abortRef.current = null; }
  }

  const groups = result?.checks ? Array.from(new Set(result.checks.map((c) => c.group))) : [];

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50 p-3 text-xs text-indigo-900 leading-relaxed">
        📊 <strong>근무관리 대시보드 검증</strong> — 통계 API ↔ 리스트 직접 집계 ↔ 그래프 필터 조회를 교차 비교해 정합성을 검증합니다(데이터 생성 아님). 컬리로 QA 내부망 필요.
      </div>

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">조회 조건</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="어드민 ID *"><input className="input font-mono" value={form.adminId} onChange={(e) => update("adminId", e.target.value.trim())} /></Field>
          <Field label="어드민 PW *"><input type="password" className="input" value={adminPw} onChange={(e) => setAdminPw(e.target.value)} /></Field>
          <Field label="클러스터">
            <select className="input" value={form.cluster} onChange={(e) => setForm((p) => ({ ...p, cluster: e.target.value, center: "" }))}>{CLUSTERS.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="센터 (전체=비움)">
            <select className="input" value={form.center} onChange={(e) => update("center", e.target.value)}><option value="">전체</option>{centerOpts.map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}</select>
          </Field>
          <Field label="업무파트 (전체=비움)">
            <select className="input" value={form.workPart} onChange={(e) => update("workPart", e.target.value)}><option value="">전체</option>{WORK_PARTS.map((w) => <option key={w}>{w}</option>)}</select>
          </Field>
          <Field label="시작일"><input type="date" className="input font-mono" value={form.startDate} onChange={(e) => update("startDate", e.target.value)} /></Field>
          <Field label="종료일"><input type="date" className="input font-mono" value={form.endDate} onChange={(e) => update("endDate", e.target.value)} /></Field>
          <Field label="근무유형 추가 (드롭다운)">
            <select className="input" value="" onChange={(e) => { const v = e.target.value; if (v && !form.workTypes.includes(v)) update("workTypes", [...form.workTypes, v]); }}>
              <option value="">선택…</option>
              {WORK_TYPES.filter((w) => !form.workTypes.includes(w)).map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-3">
            <span className="text-sm font-medium text-neutral-700">선택된 근무유형 <span className="text-[11px] text-neutral-400">(없으면 전체)</span></span>
            {form.workTypes.length > 0 && <button type="button" onClick={() => update("workTypes", [])} className="text-xs text-kurly-500 underline">전체 해제</button>}
          </div>
          {form.workTypes.length === 0
            ? <span className="text-xs text-neutral-400">전체 (필터 없음)</span>
            : (
              <div className="flex flex-wrap gap-2">
                {form.workTypes.map((w) => (
                  <button key={w} type="button" onClick={() => update("workTypes", form.workTypes.filter((x) => x !== w))}
                    className="inline-flex items-center gap-1 rounded-full border border-kurly-500 bg-kurly-50 px-3 py-1 text-xs text-kurly-700">
                    {w} <span className="text-kurly-400">✕</span>
                  </button>
                ))}
              </div>
            )}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">{running ? "검증 중..." : "🔍 검증 실행"}</button>
        {running && <button type="button" onClick={() => abortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}

      {steps.length > 0 && (
        <div className="card p-4"><div className="mb-2 text-sm font-semibold text-neutral-700">진행</div>
          <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs">{steps.map((s, i) => <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>{s.message}</div>)}</div>
        </div>
      )}

      {result?.ok && result.summary && (
        <div className={`card p-4 ${result.summary.failed === 0 ? "border-green-200" : "border-red-200"}`}>
          <div className="mb-3 text-sm font-semibold">
            {result.summary.failed === 0 ? <span className="text-green-600">✅ ALL PASS ({result.summary.passed}/{result.summary.total})</span> : <span className="text-red-600">❌ FAIL {result.summary.failed}건 / 전체 {result.summary.total}건</span>}
            <span className="ml-3 text-neutral-500">리스트 total: {result.listTotal}</span>
          </div>
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="mb-1 text-xs font-semibold text-neutral-600">{g}</div>
              <table className="w-full text-xs">
                <thead className="bg-neutral-50"><tr><th className="p-1.5 text-left">항목</th><th className="p-1.5 text-left">통계</th><th className="p-1.5 text-left">리스트집계</th><th className="p-1.5 text-left">필터조회</th><th className="p-1.5 text-left">결과</th></tr></thead>
                <tbody>
                  {result.checks!.filter((c) => c.group === g).map((c, i) => (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="p-1.5">{c.label}</td>
                      <td className="p-1.5 font-mono">{c.statVal ?? "-"}</td>
                      <td className="p-1.5 font-mono">{c.listVal ?? "-"}</td>
                      <td className="p-1.5 font-mono">{c.filterVal ?? "-"}</td>
                      <td className="p-1.5">{c.pass ? <span className="text-green-600">PASS</span> : <span className="text-red-600 font-semibold">FAIL</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-neutral-700">{label}</span>{children}</label>;
}
