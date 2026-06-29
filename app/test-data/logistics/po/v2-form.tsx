"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.po-v2.v1";
const FIXED_CENTERS: [string, string][] = [["WH02", "김포"], ["WH03", "평택"], ["WH04", "창원"], ["MCWH01", "DMC점"], ["MCWH02", "도곡점"]];
const RP_OPTS: [string, string][] = [["", "상품 기본값"], ["KURLY_PICKUP", "컬리픽업"], ["MILKRUN_PICKUP", "밀크런픽업"], ["KURLY_MILKRUN_PICKUP", "컬리+밀크런"], ["PARCEL", "택배"], ["DIRECT_DELIVERY", "직배송"], ["ETC", "기타"]];
const WP_OPTS: [string, string][] = [["", "상품 기본값"], ["N", "직납"], ["WAY1", "경유"]];

interface Dock { dockCode: string; dockName: string; fulfillmentCenterCode: string }
interface Goods { goodsId: number; masterCode: string; goodsName: string; supplierCode: string; supplierName: string; quantityPerUnit: number; unit: string; shippingProcess: string; waypoint: string; salesProcess: string; detailShippingProcess: string; goodsEstimateId: number; goodsEstimateType: string; goodsEstimatePrice: number; goodsEstimateTaxation: string }
interface StepEvent { type: "step"; ok: boolean; level: "info" | "ok" | "err"; message: string }
interface RunResult { ok: boolean; error?: string; registrant?: string; recvDate?: string; goodsCount?: number; centers?: string; confirmedCount?: number; planGoodsCodes?: string[]; statementCodes?: string[] }
interface ExistingStatement { code: string; goodsCount: string | number; status: string }
interface MergePrompt { runId: string; statements: ExistingStatement[] }

function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function today() { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

export default function PoV2Form({ envName }: { envName: string }) {
  const [empEmail, setEmpEmail] = useState("");
  const [supId, setSupId] = useState("");
  const [supPw, setSupPw] = useState("");
  const [searchSupplier, setSearchSupplier] = useState("");
  const [searchGoods, setSearchGoods] = useState("");
  const [recvDate, setRecvDate] = useState(tomorrow());
  const [qty, setQty] = useState(1);
  const [poType, setPoType] = useState<"NORMAL" | "EMERGENCY">("NORMAL");
  const [releaseProcess, setReleaseProcess] = useState("");
  const [waypoint, setWaypoint] = useState("");
  const [skipApplyStock, setSkipApplyStock] = useState(false);
  const [selectedCenters, setSelectedCenters] = useState<string[]>(["WH02"]);
  const [selectedDockByCenter, setSelectedDockByCenter] = useState<Record<string, string | null>>({});

  const [prepared, setPrepared] = useState<{ empName: string; empCode: string } | null>(null);
  const [docksByCenter, setDocksByCenter] = useState<Record<string, Dock[]>>({});
  const [preparing, setPreparing] = useState(false);
  const [prepErr, setPrepErr] = useState<string | null>(null);

  const [goods, setGoods] = useState<Goods[]>([]);
  const [selIdx, setSelIdx] = useState<Set<number>>(new Set());
  const [searching, setSearching] = useState(false);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [mergePrompt, setMergePrompt] = useState<MergePrompt | null>(null);
  const [mergeMode, setMergeMode] = useState<"new" | "merge">("new");
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());

  useEffect(() => { try { const s = localStorage.getItem(LS_KEY); if (s) { const j = JSON.parse(s); if (j.empEmail) setEmpEmail(j.empEmail); if (j.supId) setSupId(j.supId); } } catch {} }, []);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify({ empEmail, supId })); } catch {} }, [empEmail, supId]);
  // 환경 바뀌면 로그인/조회 상태 초기화
  useEffect(() => { setPrepared(null); setDocksByCenter({}); setGoods([]); setSelIdx(new Set()); setResult(null); setSteps([]); }, [envName]);

  function toggleCenter(code: string) {
    setSelectedCenters((p) => p.includes(code) ? (p.length === 1 ? p : p.filter((c) => c !== code)) : [...p, code]);
  }

  async function onPrepare() {
    if (preparing || !empEmail.trim()) { setPrepErr("임직원 이메일 입력"); return; }
    setPreparing(true); setPrepErr(null); setPrepared(null);
    try {
      const res = await fetch("/api/test-data/logistics-po/v2/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envName, empEmail: empEmail.trim() }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setPrepared({ empName: j.empName, empCode: j.empCode }); setDocksByCenter(j.docksByCenter || {});
    } catch (e) { setPrepErr(e instanceof Error ? e.message : String(e)); }
    finally { setPreparing(false); }
  }

  async function onSearch() {
    if (searching || !prepared) { return; }
    setSearching(true); setError(null);
    try {
      const res = await fetch("/api/test-data/logistics-po/v2/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envName, empEmail: empEmail.trim(), supplierName: searchSupplier, goodsName: searchGoods, centers: selectedCenters }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setGoods(j.goods || []); setSelIdx(new Set((j.goods || []).map((_: Goods, i: number) => i)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSearching(false); }
  }

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!prepared) m.push("임직원 로그인");
    if (!selIdx.size) m.push("상품 선택");
    if (!selectedCenters.length) m.push("입고지");
    if (!supId.trim() || !supPw.trim()) m.push("공급사");
    return m;
  }, [prepared, selIdx, selectedCenters, supId, supPw]);

  async function onRun() {
    if (running) return;
    if (missing.length) { setError(`누락: ${missing.join(", ")}`); return; }
    setRunning(true); setSteps([]); setResult(null); setError(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const selGoods = [...selIdx].map((i) => goods[i]).filter(Boolean);
    try {
      const res = await fetch("/api/test-data/logistics-po/v2", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ envName, empEmail: empEmail.trim(), supId: supId.trim(), supPw, goods: selGoods, selectedCenters, selectedDockByCenter, releaseProcess, waypoint, quantity: qty, recvDate, skipApplyStock, poType }) });
      if (!res.ok || !res.body) { const t = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let nl;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
          if (!chunk.startsWith("data:")) continue;
          try {
            const p = JSON.parse(chunk.slice(5).trim());
            if (p.kind === "progress") setSteps((x) => [...x, p.event]);
            else if (p.kind === "done") setResult(p.result);
            else if (p.kind === "fatal") setError(p.error);
            else if (p.kind === "merge-prompt") {
              console.log("[merge-prompt]", p);
              setMergePrompt({ runId: p.runId, statements: p.statements });
              setMergeMode("new");
              setMergeSelected(new Set());
            }
          } catch {}
        }
      }
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); abortRef.current = null; }
  }

  async function onMergeConfirm() {
    if (!mergePrompt) return;
    const codes = mergeMode === "merge" ? Array.from(mergeSelected) : [];
    if (mergeMode === "merge" && !codes.length) { alert("병합할 거래명세서를 선택해주세요."); return; }
    try {
      await fetch("/api/test-data/logistics-po/v2/merge-choice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: mergePrompt.runId, mode: mergeMode, codes }) });
    } catch {}
    setMergePrompt(null);
  }
  function onMergeCancel() {
    if (!mergePrompt) return;
    fetch("/api/test-data/logistics-po/v2/merge-choice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: mergePrompt.runId, mode: "new", codes: [] }) }).catch(() => {});
    setMergePrompt(null);
  }

  const levelColor = { info: "text-neutral-500", ok: "text-green-600", err: "text-red-600" } as const;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border-l-4 border-teal-400 bg-teal-50 p-3 text-xs text-teal-900 leading-relaxed">
        🏭 <strong>발주 V2</strong> — 발주계획 → 발주검사 → 공급사 확정 → 거래명세서. CAPA 기반 신규 설계. <strong>{envName}</strong> 환경.
        <br />⚠ 실제 발주/명세서 데이터를 생성합니다 · STG/DEV 내부망 + 임직원/공급사 계정 필요.
      </div>

      {/* ① 임직원 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 임직원 로그인</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[260px] flex-1 text-sm"><span className="mb-1 block font-medium text-neutral-700">임직원 이메일 *</span>
            <input type="email" className="input font-mono" value={empEmail} onChange={(e) => setEmpEmail(e.target.value.trim())} /></label>
          <button type="button" onClick={onPrepare} disabled={preparing} className="btn-primary">{preparing ? "조회 중..." : prepared ? "재발급" : "토큰 발급 / 도크 조회"}</button>
        </div>
        {prepared && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">✓ {prepared.empName} <span className="font-mono">({prepared.empCode || "-"})</span></div>}
        {prepErr && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {prepErr}</div>}
      </fieldset>

      {/* ② 상품 조회 */}
      <fieldset className="card space-y-3 p-5" disabled={running || !prepared}>
        <legend className="text-sm font-semibold text-neutral-700">② 상품 조회 / 선택</legend>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="공급사명"><input className="input" value={searchSupplier} onChange={(e) => setSearchSupplier(e.target.value)} placeholder="(선택)" /></Field>
          <Field label="상품명"><input className="input" value={searchGoods} onChange={(e) => setSearchGoods(e.target.value)} placeholder="(선택)" /></Field>
          <button type="button" onClick={onSearch} disabled={searching || !prepared} className="btn-primary">{searching ? "조회 중..." : "상품 조회"}</button>
        </div>
        {goods.length > 0 && (
          <div className="max-h-72 overflow-y-auto rounded border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-50"><tr>
                <th className="p-1.5"><input type="checkbox" checked={selIdx.size === goods.length} onChange={(e) => setSelIdx(e.target.checked ? new Set(goods.map((_, i) => i)) : new Set())} /></th>
                <th className="p-1.5 text-left">상품ID</th><th className="p-1.5 text-left">마스터코드</th><th className="p-1.5 text-left">상품명</th><th className="p-1.5 text-left">공급사코드</th><th className="p-1.5 text-left">공급사명</th><th className="p-1.5 text-left">출고방법</th>
              </tr></thead>
              <tbody>
                {goods.map((g, i) => (
                  <tr key={g.goodsId} className="border-t border-neutral-100">
                    <td className="p-1.5 text-center"><input type="checkbox" checked={selIdx.has(i)} onChange={(e) => setSelIdx((p) => { const n = new Set(p); e.target.checked ? n.add(i) : n.delete(i); return n; })} /></td>
                    <td className="p-1.5 font-mono">{g.goodsId}</td><td className="p-1.5 font-mono">{g.masterCode}</td><td className="p-1.5">{g.goodsName}</td><td className="p-1.5 font-mono">{g.supplierCode}</td><td className="p-1.5">{g.supplierName}</td>
                    <td className="p-1.5">{(RP_OPTS.find(([c]) => c === (g.detailShippingProcess || g.shippingProcess)) || [, g.shippingProcess])[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {goods.length > 0 && <p className="text-[11px] text-neutral-500">{goods.length}건 조회 · {selIdx.size}건 선택</p>}
      </fieldset>

      {/* ③ 발주 옵션 */}
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">③ 발주 옵션</legend>
        <div>
          <span className="mb-2 block text-sm font-medium text-neutral-700">입고지(센터) <span className="text-[11px] text-neutral-400">(최소 1개)</span></span>
          <div className="flex flex-wrap gap-2">
            {FIXED_CENTERS.map(([code, label]) => { const on = selectedCenters.includes(code); return (
              <button key={code} type="button" onClick={() => toggleCenter(code)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${on ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 bg-white text-neutral-500"}`}>{label} ({code})</button>
            ); })}
          </div>
        </div>
        {prepared && (
          <div className="border-t border-neutral-100 pt-3">
            <span className="mb-2 block text-[11px] font-semibold uppercase text-neutral-400">도크 선택 (미선택=상품 기본값)</span>
            <div className="space-y-2">
              {selectedCenters.map((cc) => { const ds = docksByCenter[cc] || []; const sel = selectedDockByCenter[cc] ?? null; const label = FIXED_CENTERS.find(([c]) => c === cc)?.[1] || cc; return (
                <div key={cc} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[60px] font-mono text-xs font-semibold text-neutral-600">{label}</span>
                  <button type="button" onClick={() => setSelectedDockByCenter((p) => ({ ...p, [cc]: null }))} className={`rounded-full border px-2 py-1 text-xs ${sel === null ? "border-amber-400 bg-amber-50 text-amber-700" : "border-neutral-200 text-neutral-400"}`}>상품 기본값</button>
                  {ds.length === 0 && <span className="text-[11px] text-neutral-400">(도크 없음)</span>}
                  {ds.map((d) => (
                    <button key={d.dockCode} type="button" onClick={() => setSelectedDockByCenter((p) => ({ ...p, [cc]: d.dockCode }))} className={`rounded-full border px-2 py-1 font-mono text-xs ${sel === d.dockCode ? "border-amber-400 bg-amber-50 text-amber-700" : "border-neutral-200 text-neutral-400"}`}>{d.dockName} · {d.dockCode}</button>
                  ))}
                </div>
              ); })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="발주 유형"><select className="input" value={poType} onChange={(e) => { const v = e.target.value as typeof poType; setPoType(v); setRecvDate(v === "EMERGENCY" ? today() : tomorrow()); }}><option value="NORMAL">일반</option><option value="EMERGENCY">긴급</option></select></Field>
          <Field label="입고예정일"><input type="date" className="input font-mono" value={recvDate} onChange={(e) => setRecvDate(e.target.value)} /></Field>
          <Field label="수량"><input type="number" min={1} className="input font-mono" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} /></Field>
          <Field label="출고방법"><select className="input" value={releaseProcess} onChange={(e) => setReleaseProcess(e.target.value)}>{RP_OPTS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></Field>
          <Field label="경유센터"><select className="input" value={waypoint} onChange={(e) => setWaypoint(e.target.value)}>{WP_OPTS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></Field>
          <Field label="재고 증량"><select className="input" value={skipApplyStock ? "1" : "0"} onChange={(e) => setSkipApplyStock(e.target.value === "1")}><option value="0">재고 적용</option><option value="1">재고 스킵</option></select></Field>
        </div>
      </fieldset>

      {/* ④ 공급사 */}
      <fieldset className="card grid grid-cols-2 gap-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">④ 공급사 로그인 (확정용)</legend>
        <Field label="공급사 ID *"><input className="input font-mono" value={supId} onChange={(e) => setSupId(e.target.value.trim())} /></Field>
        <Field label="비밀번호 *"><input type="password" className="input" value={supPw} onChange={(e) => setSupPw(e.target.value)} /></Field>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onRun} disabled={running} className="btn-primary">{running ? "실행 중..." : "🏭 발주 V2 전체 플로우 실행"}</button>
        {running && <button type="button" onClick={() => abortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
        {missing.length > 0 && !running && <span className="text-xs text-amber-700">⚠ 누락: {missing.join(", ")}</span>}
      </div>

      {/* 거래명세서 병합 선택 모달 */}
      {mergePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[460px] max-w-[90vw] max-h-[80vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-neutral-800">거래명세서 생성 방식 선택</h3>
            <p className="text-xs text-neutral-500">확정된 발주 상품의 거래명세서를 생성합니다. 기존 거래명세서가 있어 병합하거나 신규 생성할 수 있습니다.</p>

            <table className="w-full text-xs border border-neutral-200 rounded">
              <thead className="bg-neutral-50"><tr><th className="p-2 w-8"></th><th className="p-2 text-left">거래명세서 코드</th><th className="p-2 text-left">상품 수</th><th className="p-2 text-left">상태</th></tr></thead>
              <tbody>{mergePrompt.statements.map((s) => (
                <tr key={s.code} className="border-t border-neutral-100">
                  <td className="p-2 text-center"><input type="checkbox" disabled={mergeMode !== "merge"} checked={mergeSelected.has(s.code)} onChange={(e) => setMergeSelected((p) => { const n = new Set(p); e.target.checked ? n.add(s.code) : n.delete(s.code); return n; })} /></td>
                  <td className="p-2 font-mono">{s.code}</td><td className="p-2">{s.goodsCount}</td><td className="p-2">{s.status}</td>
                </tr>
              ))}</tbody>
            </table>

            <div className="flex gap-3">
              <label className={`flex-1 cursor-pointer rounded-lg border-2 p-3 text-center text-sm transition ${mergeMode === "new" ? "border-kurly-500 bg-kurly-50" : "border-neutral-200"}`}>
                <input type="radio" name="mergeMode" className="sr-only" checked={mergeMode === "new"} onChange={() => { setMergeMode("new"); setMergeSelected(new Set()); }} />
                <div className="text-lg">📄</div><div className="font-semibold">신규 생성</div><div className="text-[11px] text-neutral-500">새로운 거래명세서를 생성합니다</div>
              </label>
              <label className={`flex-1 cursor-pointer rounded-lg border-2 p-3 text-center text-sm transition ${mergeMode === "merge" ? "border-kurly-500 bg-kurly-50" : "border-neutral-200"}`}>
                <input type="radio" name="mergeMode" className="sr-only" checked={mergeMode === "merge"} onChange={() => { setMergeMode("merge"); if (mergePrompt.statements.length === 1) setMergeSelected(new Set([mergePrompt.statements[0].code])); }} />
                <div className="text-lg">🔗</div><div className="font-semibold">기존 병합</div><div className="text-[11px] text-neutral-500">기존 거래명세서에 병합합니다</div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onMergeCancel} className="btn-ghost border border-neutral-200 px-4 py-2 text-sm">취소</button>
              <button type="button" onClick={onMergeConfirm} className="btn-primary px-4 py-2 text-sm">확인</button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}
      {steps.length > 0 && (
        <div className="card p-4"><div className="mb-2 text-sm font-semibold text-neutral-700">실행 로그</div>
          <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">{steps.map((s, i) => <div key={i} className={levelColor[s.level]}>{s.message}</div>)}</div>
        </div>
      )}
      {result && (
        <div className={`card p-4 ${result.ok ? "border-green-200" : "border-red-200"}`}>
          <div className="mb-2 text-sm font-semibold text-neutral-700">{result.ok ? "✓ 발주 V2 완료" : "❌ 실패"}</div>
          {result.ok ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <Row k="등록자">{result.registrant}</Row><Row k="입고예정일">{result.recvDate}</Row><Row k="상품">{result.goodsCount}건</Row>
              <Row k="입고지">{result.centers}</Row><Row k="확정">{result.confirmedCount}건</Row>
              <Row k="발주상품코드">{(result.planGoodsCodes || []).join(", ") || "-"}</Row>
              <Row k="거래명세서">{(result.statementCodes || []).join(", ") || "코드 확인 필요"}</Row>
            </dl>
          ) : <div className="text-xs text-red-700">{result.error}</div>}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-neutral-700">{label}</span>{children}</label>;
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <><dt className="font-mono text-neutral-400">{k}</dt><dd className="font-mono break-all text-neutral-700">{children}</dd></>;
}
