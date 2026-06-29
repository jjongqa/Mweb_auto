"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.po.v2";

// 입고지(센터) — lib/test-data-logistics-po.ts 의 PO_CENTERS 와 동일 (서버 lib를 클라에 import하지 않으려 인라인).
const PO_CENTERS: { code: string; label: string }[] = [
  { code: "WH02", label: "김포(WH02)" },
  { code: "WH03", label: "평택(WH03)" },
  { code: "WH04", label: "창원(WH04)" },
  { code: "MCWH01", label: "1MC" },
  { code: "MCWH02", label: "2MC" },
  { code: "MCWH03", label: "3MC" },
  { code: "MCWH04", label: "4MC" },
];

interface PoDock { dockCode: string; dockName: string }
interface StepEvent { type: "step"; ok: boolean; level: "info" | "ok" | "err" | "warn" | "sub"; message: string }
interface RunResult {
  ok: boolean;
  registrantName?: string; registrantEmployeeCode?: string; groupName?: string;
  purchaseGroupId?: number | string; purchaseGroupCode?: string; receivingEstimateDate?: string;
  purchaseOrderIds?: (number | string)[]; okCount?: number; failCount?: number; total?: number; error?: string;
}

interface FormState {
  empEmail: string;
  searchWord: string;
  groupName: string;
  receivingEstimateDate: string;  // YYYY-MM-DD
  boxQnty: number;
  selectedCenters: string[];
  skipApplyStock: boolean;
  supLoginId: string;
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const INITIAL: FormState = {
  empEmail: "",
  searchWord: "세희",
  groupName: "세희발주테스트",
  receivingEstimateDate: tomorrow(),
  boxQnty: 1,
  selectedCenters: ["WH02", "WH03", "WH04", "MCWH01", "MCWH02"],
  skipApplyStock: false,
  supLoginId: "",
};

export default function PoForm({ envName = "STG" }: { envName?: string }) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [supPassword, setSupPassword] = useState("");  // 비번은 localStorage 미저장

  // prepare(토큰 발급 + 도크) 상태
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<{ empName: string; empCode: string } | null>(null);
  const [docksByCenter, setDocksByCenter] = useState<Record<string, PoDock[]>>({});
  const [selectedDockByCenter, setSelectedDockByCenter] = useState<Record<string, string | null>>({});
  const [prepareError, setPrepareError] = useState<string | null>(null);

  // run 상태
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setForm((p) => ({ ...p, ...JSON.parse(saved) }));
    } catch {}
  }, []);
  useEffect(() => {
    if (!running && !preparing) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {}
    }
  }, [form, running, preparing]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  function toggleCenter(code: string) {
    setForm((p) => {
      const has = p.selectedCenters.includes(code);
      if (has) {
        if (p.selectedCenters.length === 1) return p;  // 최소 1개
        return { ...p, selectedCenters: p.selectedCenters.filter((c) => c !== code) };
      }
      return { ...p, selectedCenters: [...p.selectedCenters, code] };
    });
  }

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.empEmail.trim()) m.push("임직원 이메일");
    if (!supPassword.trim() || !form.supLoginId.trim()) m.push("공급사 ID/PW");
    return m;
  }, [form, supPassword]);

  async function onPrepare() {
    if (preparing || !form.empEmail.trim()) { setPrepareError("임직원 이메일을 입력하세요"); return; }
    setPreparing(true); setPrepareError(null); setPrepared(null);
    try {
      const res = await fetch("/api/test-data/logistics-po/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envName, empEmail: form.empEmail.trim() }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setPrepared({ empName: json.empName, empCode: json.empCode });
      setDocksByCenter(json.docksByCenter || {});
      setSelectedDockByCenter({});  // 기본값(상품 기본값) 으로 초기화
    } catch (e) {
      setPrepareError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length > 0) { setError(`누락: ${missing.join(", ")}`); return; }
    setRunning(true); setSteps([]); setResult(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/logistics-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envName,
          empEmail: form.empEmail.trim(),
          searchWord: form.searchWord.trim(),
          groupName: form.groupName.trim(),
          receivingEstimateDate: form.receivingEstimateDate || undefined,
          boxQnty: form.boxQnty,
          selectedCenters: form.selectedCenters,
          selectedDockByCenter,
          skipApplyStock: form.skipApplyStock,
          supLoginId: form.supLoginId.trim(),
          supPassword: supPassword.trim(),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`);
      }
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
      if (!(err instanceof Error && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function onCancel() { abortRef.current?.abort(); }
  function onReset() { setSteps([]); setResult(null); setError(null); }

  const stepColor: Record<StepEvent["level"], string> = {
    info: "text-neutral-700", ok: "text-green-600", err: "text-red-600",
    warn: "text-amber-600", sub: "text-neutral-400 pl-4",
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-lg border-l-4 border-sky-400 bg-sky-50 p-3 text-xs text-sky-900 leading-relaxed">
        🏭 <strong>Kurly Partner Portal STG</strong> — 임직원 로그인 → 발주그룹 등록 → 발주서 생성 → 공급사 확정까지 자동.
        먼저 ① 임직원 토큰을 발급하면 센터별 도크를 선택할 수 있고, ② 전체 실행으로 끝까지 진행됩니다.
      </div>

      {/* STEP 1 — 임직원 로그인 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 임직원 로그인</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[260px] flex-1 text-sm">
            <span className="mb-1 block font-medium text-neutral-700">임직원 이메일 *</span>
            <input type="email" className="input font-mono" value={form.empEmail}
              onChange={(e) => update("empEmail", e.target.value.trim())} placeholder="example@kurlycorp.com" />
          </label>
          <button type="button" onClick={onPrepare} disabled={preparing || running} className="btn-primary">
            {preparing ? "조회 중..." : prepared ? "재발급" : "토큰 발급 / 도크 조회"}
          </button>
        </div>
        {prepared && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            ✓ {prepared.empName} <span className="font-mono text-green-600">({prepared.empCode || "-"})</span> 로그인 확인
          </div>
        )}
        {prepareError && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {prepareError}</div>}
      </fieldset>

      {/* STEP 2 — 발주그룹 설정 */}
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 발주그룹 설정</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="상품 검색어">
            <input className="input" value={form.searchWord} onChange={(e) => update("searchWord", e.target.value)} placeholder="검색어 입력" />
          </Field>
          <Field label="발주그룹명">
            <input className="input" value={form.groupName} onChange={(e) => update("groupName", e.target.value)} placeholder="발주그룹명 입력" />
          </Field>
          <Field label="입고예정일">
            <input type="date" className="input font-mono" value={form.receivingEstimateDate} onChange={(e) => update("receivingEstimateDate", e.target.value)} />
            <Help>기본: 내일</Help>
          </Field>
          <Field label="박스 수 (boxQnty)">
            <input type="number" min={1} className="input font-mono" value={form.boxQnty} onChange={(e) => update("boxQnty", Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>

        {/* 입고지 칩 */}
        <div>
          <span className="mb-2 block text-sm font-medium text-neutral-700">입고지 선택 <span className="text-[11px] text-neutral-400">(최소 1개)</span></span>
          <div className="flex flex-wrap gap-2">
            {PO_CENTERS.map((c) => {
              const active = form.selectedCenters.includes(c.code);
              return (
                <button key={c.code} type="button" onClick={() => toggleCenter(c.code)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${active ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"}`}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 도크 선택 (prepare 후) */}
        {prepared && (
          <div className="border-t border-neutral-100 pt-4">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">도크(하차장) 선택 — 미선택 시 상품 기본값</span>
            <div className="space-y-2">
              {form.selectedCenters.map((center) => {
                const docks = docksByCenter[center] || [];
                const sel = selectedDockByCenter[center] ?? null;
                const label = PO_CENTERS.find((c) => c.code === center)?.label || center;
                return (
                  <div key={center} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-[72px] font-mono text-xs font-semibold text-neutral-600">{label}</span>
                    <button type="button" onClick={() => setSelectedDockByCenter((p) => ({ ...p, [center]: null }))}
                      className={`rounded-full border px-3 py-1 text-xs transition ${sel === null ? "border-amber-400 bg-amber-50 text-amber-700" : "border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300"}`}>
                      상품 기본값
                    </button>
                    {docks.length === 0 && <span className="text-[11px] text-neutral-400">(도크 없음)</span>}
                    {docks.map((d) => (
                      <button key={d.dockCode} type="button" onClick={() => setSelectedDockByCenter((p) => ({ ...p, [center]: d.dockCode }))}
                        className={`rounded-full border px-3 py-1 font-mono text-xs transition ${sel === d.dockCode ? "border-amber-400 bg-amber-50 text-amber-700" : "border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300"}`}>
                        {d.dockName !== d.dockCode ? `${d.dockName} · ${d.dockCode}` : d.dockCode}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 재고 증량 */}
        <div className="border-t border-neutral-100 pt-4">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">재고 증량 여부 (skipApplyStock)</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => update("skipApplyStock", false)}
              className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition ${!form.skipApplyStock ? "border-green-500 bg-green-50 text-green-700" : "border-neutral-200 bg-white text-neutral-500"}`}>
              재고 적용
            </button>
            <button type="button" onClick={() => update("skipApplyStock", true)}
              className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition ${form.skipApplyStock ? "border-amber-500 bg-amber-50 text-amber-700" : "border-neutral-200 bg-white text-neutral-500"}`}>
              재고 스킵
            </button>
          </div>
          <p className={`mt-1.5 text-[11px] ${form.skipApplyStock ? "text-amber-600" : "text-green-600"}`}>
            {form.skipApplyStock ? "재고에 반영되지 않습니다" : "재고에 반영됩니다"}
          </p>
        </div>
      </fieldset>

      {/* STEP 3 — 공급사 로그인 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">③ 공급사 로그인 (발주확정용)</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="공급사 로그인 ID *">
            <input className="input font-mono" value={form.supLoginId} onChange={(e) => update("supLoginId", e.target.value.trim())} placeholder="공급사 ID" />
          </Field>
          <Field label="비밀번호 *">
            <input type="password" className="input" value={supPassword} onChange={(e) => setSupPassword(e.target.value)} placeholder="••••" />
            <Help>저장되지 않습니다</Help>
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">
          {running ? "실행 중..." : "🏭 발주 전체 플로우 실행"}
        </button>
        {running && <button type="button" onClick={onCancel} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
        {!running && (steps.length > 0 || result) && <button type="button" onClick={onReset} className="btn-ghost border border-neutral-200">결과 지우기</button>}
        {missing.length > 0 && !running && <span className="text-xs text-amber-700">⚠ 누락: {missing.join(", ")}</span>}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}

      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">실행 로그</div>
          <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
            {steps.map((s, i) => <div key={i} className={stepColor[s.level]}>{s.message}</div>)}
          </div>
        </div>
      )}

      {result && (
        <div className={`card p-4 ${result.ok ? "border-green-200" : "border-red-200"}`}>
          <div className="mb-3 text-sm font-semibold text-neutral-700">
            {result.ok ? "✓ 발주 플로우 완료" : "❌ 실패"}
            {result.ok && <span className="ml-2 text-neutral-500">확정 {result.okCount}/{result.total}건</span>}
          </div>
          {result.ok ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <Row k="등록자">{result.registrantName} ({result.registrantEmployeeCode})</Row>
              <Row k="발주그룹명">{result.groupName}</Row>
              <Row k="그룹코드">{result.purchaseGroupCode}</Row>
              <Row k="그룹 ID">{String(result.purchaseGroupId)}</Row>
              <Row k="입고예정일">{result.receivingEstimateDate}</Row>
              <Row k="발주서 수">{result.total}건</Row>
              <Row k="확정 성공/실패">{result.okCount} / {result.failCount}건</Row>
            </dl>
          ) : (
            <div className="text-xs text-red-700">{result.error}</div>
          )}
        </div>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}
function Help({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] text-neutral-500">{children}</p>;
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-neutral-400">{k}</dt>
      <dd className="font-mono break-all text-neutral-700">{children}</dd>
    </>
  );
}
