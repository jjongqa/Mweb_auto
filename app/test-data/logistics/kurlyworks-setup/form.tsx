"use client";

import { useEffect, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.kurlyworks.v2";
const CC_OPTIONS = ["김포 CC", "평택 CC", "창원 CC", "컬리나우", "안산FSC"];
const WORK_PARTS = ["IB", "OB", "QC", "IM"];

// 원본 2_kurlyworks_setup.py 기본값
const D = { worksId: "admin00", worksPw: "2510kurlyro!@#$", roId: "autoqa12", roPw: "kurly12@", cc: "김포 CC", center: "김포상온", part: "IB" };

interface StepEvent { type: "step"; ok: boolean; level: "info" | "ok" | "err"; message: string }
interface Result { ok: boolean; error?: string; teamName?: string; shift?: string }

type SetupMode = "auto" | "manual";
interface FormState {
  setupMode: SetupMode; headless: boolean;
  worksId: string; roId: string; cc: string; center: string; part: string; startHour: string; endHour: string;
}
const INITIAL: FormState = {
  setupMode: "auto", headless: true,
  worksId: D.worksId, roId: D.roId, cc: D.cc, center: D.center, part: D.part, startHour: "", endHour: "",
};

export default function KurlyworksForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [worksPw, setWorksPw] = useState(D.worksPw);
  const [roPw, setRoPw] = useState(D.roPw);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { try { const s = localStorage.getItem(LS_KEY); if (s) setForm((p) => ({ ...p, ...JSON.parse(s) })); } catch {} }, []);
  useEffect(() => { if (!running) { try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {} } }, [form, running]);
  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));
  const levelColor = { info: "text-neutral-500", ok: "text-green-600", err: "text-red-600" } as const;
  const manual = form.setupMode === "manual";

  // 자동 모드는 기본값으로 강제, 수동 모드는 입력값 사용
  const eff = manual
    ? { worksId: form.worksId, worksPw, roId: form.roId, roPw, cc: form.cc, center: form.center, part: form.part, startHour: form.startHour, endHour: form.endHour }
    : { worksId: D.worksId, worksPw: D.worksPw, roId: D.roId, roPw: D.roPw, cc: D.cc, center: D.center, part: D.part, startHour: "", endHour: "" };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    setRunning(true); setSteps([]); setResult(null); setError(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/logistics-kurlyworks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...eff, headless: form.headless, runWorks: true, runKurlyro: true }),
        signal: ctrl.signal,
      });
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

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed">
        🧪 <strong>실험적 — 브라우저 자동화(Playwright)</strong>. 공개 API가 없어 어드민 UI를 직접 조작합니다. <strong>라이브 UI 셀렉터에 의존</strong>하므로 UI 변경 시 단계가 실패할 수 있고, 미검증 상태입니다.
        <br />⚙ 컬리웍스(근무조·계약서·문서) + 컬리로(근무시간대) 마스터를 순서대로 세팅 · 서버에 chromium 필요 · 어드민 계정·내부망 필요.
      </div>

      {/* ① 셋업 모드 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 셋업 모드 선택</legend>
        <p className="text-xs text-neutral-500">진행 방식을 선택하세요</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {([["auto", "자동 생성 (기본값)", "기본 계정·센터값 + 현재 시각 기준 근무시간으로 실행"], ["manual", "수동 입력 (직접 설정)", "계정·센터·근무시간을 직접 입력"]] as [SetupMode, string, string][]).map(([m, label, desc]) => (
            <button key={m} type="button" onClick={() => update("setupMode", m)}
              className={`flex-1 rounded-lg border-2 px-4 py-3 text-left transition ${form.setupMode === m ? "border-kurly-500 bg-kurly-50" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
              <div className={`text-sm font-semibold ${form.setupMode === m ? "text-kurly-700" : "text-neutral-700"}`}>{label}</div>
              <div className="mt-0.5 text-[11px] text-neutral-500">{desc}</div>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={form.headless} onChange={(e) => update("headless", e.target.checked)} />
          브라우저 숨기기 (Headless Mode)
        </label>
      </fieldset>

      {/* ② 입력 — 모드별 */}
      {manual ? (
        <fieldset className="card space-y-4 p-5" disabled={running}>
          <legend className="text-sm font-semibold text-neutral-700">② 수동 입력</legend>
          <div className="rounded border-l-4 border-sky-400 bg-sky-50 p-2 text-[11px] text-sky-900">💡 수동 모드 — 값을 직접 변경할 수 있습니다.</div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="컬리웍스 ID"><input className="input font-mono" value={form.worksId} onChange={(e) => update("worksId", e.target.value.trim())} /></Field>
            <Field label="컬리웍스 PW"><input type="password" className="input" value={worksPw} onChange={(e) => setWorksPw(e.target.value)} /></Field>
            <Field label="컬리로 ID"><input className="input font-mono" value={form.roId} onChange={(e) => update("roId", e.target.value.trim())} /></Field>
            <Field label="컬리로 PW"><input type="password" className="input" value={roPw} onChange={(e) => setRoPw(e.target.value)} /></Field>
            <Field label="CC 명칭"><select className="input" value={form.cc} onChange={(e) => update("cc", e.target.value)}>{CC_OPTIONS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="센터 명칭"><input className="input" value={form.center} onChange={(e) => update("center", e.target.value)} placeholder="김포상온" /></Field>
            <Field label="업무 파트"><select className="input" value={form.part} onChange={(e) => update("part", e.target.value)}>{WORK_PARTS.map((w) => <option key={w}>{w}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="근무 시작(0~23)"><input className="input font-mono" value={form.startHour} onChange={(e) => update("startHour", e.target.value.trim())} placeholder="비우면 현재시각" /></Field>
            <Field label="근무 종료(0~23)"><input className="input font-mono" value={form.endHour} onChange={(e) => update("endHour", e.target.value.trim())} placeholder="비우면 시작+1h" /></Field>
          </div>
        </fieldset>
      ) : (
        <fieldset className="card space-y-2 p-5">
          <legend className="text-sm font-semibold text-neutral-700">② 설정값 미리보기 (자동)</legend>
          <div className="rounded border-l-4 border-green-400 bg-green-50 p-2 text-[11px] text-green-900">✅ 자동 모드 — 아래 기본 설정값으로 실행됩니다.</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-3">
            <Row k="컬리웍스 ID">{D.worksId}</Row>
            <Row k="컬리로 ID">{D.roId}</Row>
            <Row k="CC 명칭">{D.cc}</Row>
            <Row k="센터 명칭">{D.center}</Row>
            <Row k="업무 파트">{D.part}</Row>
            <Row k="근무시간">현재 시각 ~ +1h</Row>
            <Row k="Headless">{String(form.headless)}</Row>
          </dl>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">{running ? "실행 중... (브라우저 자동화)" : "🚀 자동화 실행"}</button>
        {running && <button type="button" onClick={() => abortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}
      {steps.length > 0 && (
        <div className="card p-4"><div className="mb-2 text-sm font-semibold text-neutral-700">진행</div>
          <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">{steps.map((s, i) => <div key={i} className={levelColor[s.level]}>{s.message}</div>)}</div>
        </div>
      )}
      {result && (
        <div className={`card p-4 ${result.ok ? "border-green-200" : "border-red-200"}`}>
          <div className="text-sm font-semibold">{result.ok ? "✅ 세팅 완료" : "❌ 실패"}{result.shift && <span className="ml-2 text-neutral-500">근무조 {result.shift}</span>}</div>
          {result.error && <div className="mt-1 text-xs text-red-700">{result.error}</div>}
        </div>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-neutral-700">{label}</span>{children}</label>;
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <><dt className="font-mono text-neutral-400">{k}</dt><dd className="font-mono text-neutral-700">{children}</dd></>;
}
