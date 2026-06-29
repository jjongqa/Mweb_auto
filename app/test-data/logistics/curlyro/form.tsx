"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.kurlyro.v1";

const CLUSTER_CENTER_MAP: Record<string, [string, string][]> = {
  CC02: [["GGH1", "김포상온"], ["GGM1", "김포냉장"], ["GGL1", "김포냉동"], ["GGHUB1", "김포허브"], ["GGQ1", "김포QC"], ["GGC1", "김포CS"], ["GGR1", "김포회수"], ["GGH3", "김포롱테일"], ["GGIM1", "김포재고관리"]],
  CC03: [["GPH1", "평택상온"], ["GPM1", "평택냉장"], ["GPL1", "평택냉동"], ["GPHS1", "평택상온SIOC"], ["GPHUB1", "평택허브"], ["GPQ1", "평택QC"], ["GPC1", "평택CS"], ["GPR1", "평택 통합회수"], ["GPH2", "평택 부자재"], ["GPH3", "평택뷰티"], ["GPIM1", "평택재고관리"]],
  CC04: [["KCH1", "창원상온"], ["KCM1", "창원냉장"], ["KCL1", "창원냉동"], ["KCHUB1", "창원허브"], ["KCQ1", "창원QC"], ["KCC1", "창원CS"], ["KCR1", "창원회수"], ["KCIM1", "창원재고관리"]],
  MC01: [["MC01", "DMC"], ["MC02", "도곡"]],
};
const CLUSTERS = Object.keys(CLUSTER_CENTER_MAP);
const WORK_PARTS = ["IB", "OB", "QC", "IM"];
const PROCESSES: [string, string][] = [["picking", "피킹"], ["packing", "패킹"], ["shipping", "출하"]];
const CONTRACT_STEPS = ["회원가입", "상용직 전환", "근무계획 생성", "출근 처리", "체크인", "체크아웃", "퇴근 처리", "회원탈퇴"];
const ARBEIT_STEPS = ["회원가입", "개인정보 등록", "관리자 작업인증", "근무 등록", "작업자 근로계약", "아르바이트 출근", "안전교육 진행", "체크인", "체크아웃", "회원탈퇴"];

type Scenario = "contract" | "arbeit";
interface StepEvent { type: "step"; ok: boolean; level: "info" | "ok" | "err"; message: string }
interface RunResult { ok: boolean; doneSteps: number; totalSteps: number; failedStep?: string; error?: string }

interface FormState {
  scenario: Scenario;
  username: string; name: string; phone: string;
  cluster: string; center: string; workPart: string;
  empNum: string; processCode: string; overWork: "WISHED" | "NOT_WISHED";
  startStep: number; endStep: number;
}
const INITIAL: FormState = {
  scenario: "contract",
  username: "", name: "", phone: "",
  cluster: "CC02", center: "GGH1", workPart: "IB",
  empNum: "", processCode: "picking", overWork: "WISHED",
  startStep: 1, endStep: 8,
};

function rand4() { return String(Math.floor(Math.random() * 10000)).padStart(4, "0"); }
function randAlpha4() { let s = ""; for (let i = 0; i < 4; i++) s += String.fromCharCode(65 + Math.floor(Math.random() * 26)); return s; }

export default function KurlyroForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [password, setPassword] = useState("kurly12@");

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { try { const s = localStorage.getItem(LS_KEY); if (s) setForm((p) => ({ ...p, ...JSON.parse(s) })); } catch {} }, []);
  useEffect(() => { if (!running) { try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {} } }, [form, running]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));
  const stepList = form.scenario === "contract" ? CONTRACT_STEPS : ARBEIT_STEPS;
  const centerOpts = CLUSTER_CENTER_MAP[form.cluster] || [];

  function onScenario(s: Scenario) {
    setForm((p) => ({ ...p, scenario: s, startStep: 1, endStep: s === "contract" ? 8 : 10 }));
  }
  function onClusterChange(c: string) {
    const first = CLUSTER_CENTER_MAP[c]?.[0]?.[0] || "";
    setForm((p) => ({ ...p, cluster: c, center: first }));
  }
  function randomize() {
    const n = rand4();
    setForm((p) => ({ ...p, username: `kurlyroapi${n}`, name: `컬리로${randAlpha4()}`, phone: `0109999${n}`, empNum: `mk00${n}` }));
  }

  const includesSignup = form.startStep <= 1;
  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.username.trim() || !password.trim()) m.push("ID/PW");
    if (includesSignup && (!form.name.trim() || !form.phone.trim())) m.push("이름/전화번호");
    if (form.startStep > form.endStep) m.push("단계 범위");
    return m;
  }, [form, password, includesSignup]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length) { setError(`누락: ${missing.join(", ")}`); return; }
    setRunning(true); setSteps([]); setResult(null); setError(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const processName = PROCESSES.find(([c]) => c === form.processCode)?.[1] || "피킹";
    try {
      const res = await fetch("/api/test-data/logistics-kurlyro", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: form.scenario, startStep: form.startStep, endStep: form.endStep,
          account: { username: form.username.trim(), password, name: form.name.trim(), phone: form.phone.trim(), cluster: form.cluster, center: form.center, workPart: form.workPart, empNum: form.empNum.trim() || undefined, processCode: form.processCode, processName, overWork: form.overWork },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) { const t = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`); }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
          if (!chunk.startsWith("data:")) continue;
          try {
            const payload = JSON.parse(chunk.slice(5).trim());
            if (payload.kind === "progress") setSteps((prev) => [...prev, payload.event]);
            else if (payload.kind === "done") setResult(payload.result);
            else if (payload.kind === "fatal") setError(payload.error);
          } catch {}
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false); abortRef.current = null;
    }
  }
  const onCancel = () => abortRef.current?.abort();
  const onReset = () => { setSteps([]); setResult(null); setError(null); };
  const levelColor = { info: "text-neutral-500", ok: "text-green-600", err: "text-red-600" } as const;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50 p-3 text-xs text-indigo-900 leading-relaxed">
        👷 <strong>컬리로 작업자 생명주기</strong> — 가입~탈퇴를 순수 HTTP API로 자동 실행. 시작~종료 단계를 골라 부분 실행 가능.
        <br />⚙ 마스터 근무시간대·전자계약 문서는 <strong>사전 세팅 가정</strong>(Selenium 마스터세팅은 본 도구 범위 밖). 컬리로 QA 내부망 필요.
      </div>

      {/* 시나리오 토글 */}
      <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5">
        {([["contract", "🧑‍🏭 상용직"], ["arbeit", "🧑‍🔧 아르바이트"]] as [Scenario, string][]).map(([s, l]) => (
          <button key={s} type="button" onClick={() => onScenario(s)} disabled={running}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${form.scenario === s ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}>{l}</button>
        ))}
      </div>

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 계정 / 센터</legend>
        <button type="button" onClick={randomize} className="btn-ghost border border-neutral-200 text-xs">🎲 랜덤 생성</button>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="ID *"><input className="input font-mono" value={form.username} onChange={(e) => update("username", e.target.value.trim())} placeholder="kurlyroapi0001" /></Field>
          <Field label="PW *"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /><Help>저장 안 됨</Help></Field>
          <Field label="이름"><input className="input" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="컬리로AAAA" /></Field>
          <Field label="전화번호"><input className="input font-mono" value={form.phone} onChange={(e) => update("phone", e.target.value.trim())} placeholder="01099990001" /></Field>
          <Field label="Cluster">
            <select className="input" value={form.cluster} onChange={(e) => onClusterChange(e.target.value)}>{CLUSTERS.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="Center">
            <select className="input" value={form.center} onChange={(e) => update("center", e.target.value)}>{centerOpts.map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}</select>
          </Field>
          <Field label="업무파트">
            <select className="input" value={form.workPart} onChange={(e) => update("workPart", e.target.value)}>{WORK_PARTS.map((w) => <option key={w}>{w}</option>)}</select>
          </Field>
          {form.scenario === "contract"
            ? <Field label="사번(empNum)"><input className="input font-mono" value={form.empNum} onChange={(e) => update("empNum", e.target.value.trim())} placeholder="mk000001" /><Help>비우면 자동</Help></Field>
            : <Field label="연장근무"><select className="input" value={form.overWork} onChange={(e) => update("overWork", e.target.value as FormState["overWork"])}><option value="WISHED">WISHED</option><option value="NOT_WISHED">NOT_WISHED</option></select></Field>}
        </div>
        <Field label="체크인 공정">
          <select className="input w-48" value={form.processCode} onChange={(e) => update("processCode", e.target.value)}>{PROCESSES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select>
        </Field>
      </fieldset>

      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 실행 단계 범위</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="시작 Step">
            <select className="input" value={form.startStep} onChange={(e) => update("startStep", Number(e.target.value))}>
              {stepList.map((s, i) => <option key={i} value={i + 1}>{i + 1}. {s}</option>)}
            </select>
          </Field>
          <Field label="종료 Step">
            <select className="input" value={form.endStep} onChange={(e) => update("endStep", Number(e.target.value))}>
              {stepList.map((s, i) => <option key={i} value={i + 1}>{i + 1}. {s}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-[11px] text-neutral-500">실행 범위: Step {form.startStep} ~ {form.endStep} ({stepList[form.startStep - 1]} → {stepList[form.endStep - 1]})</p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">{running ? "실행 중..." : "🚀 연속 실행"}</button>
        {running && <button type="button" onClick={onCancel} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
        {!running && (steps.length > 0 || result) && <button type="button" onClick={onReset} className="btn-ghost border border-neutral-200">결과 지우기</button>}
        {missing.length > 0 && !running && <span className="text-xs text-amber-700">⚠ 누락: {missing.join(", ")}</span>}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}

      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">진행</div>
          <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
            {steps.map((s, i) => <div key={i} className={levelColor[s.level]}>{s.message}</div>)}
          </div>
        </div>
      )}

      {result && (
        <div className={`card p-4 ${result.ok ? "border-green-200" : "border-red-200"}`}>
          <div className="text-sm font-semibold text-neutral-700">
            {result.ok ? "✅ 연속 실행 완료" : `❌ ${result.failedStep || "오류"}에서 중단`}
            <span className="ml-2 text-neutral-500">{result.doneSteps}/{result.totalSteps} 단계 완료</span>
          </div>
          {result.error && <div className="mt-1 text-xs text-red-700">{result.error}</div>}
        </div>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-neutral-700">{label}</span>{children}</label>;
}
function Help({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] text-neutral-500">{children}</p>;
}
