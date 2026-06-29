"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.kls.v1";

const CENTER_REGIONS: Record<string, string[]> = {
  "2cc": ["A", "B", "C", "D", "F", "S", "T", "W", "X", "Z"],
  "3cc": ["-", "CA", "CS", "DJ", "GW", "H", "M", "PT", "R", "U", "Y"],
  "4cc": ["BS", "DE", "DW", "GC", "JI", "PG", "UL", "YS"],
};

interface KlsZone { on: boolean; cnt: number; qty: number }
interface KlsResult { index: number; ok: boolean; clientOrderCode?: string; outbound?: string; region?: string; goods?: string[]; status: string; error?: string }
interface ProgressEvent { type: "kls"; index: number; ok: boolean; message: string }

interface FormState {
  cool: KlsZone; froz: KlsZone; room: KlsZone;
  center: string; regions: string[]; addrMode: "R" | "A"; repeatCnt: number;
  ownerCode: string; channelCode: string;
}
const Z0: KlsZone = { on: false, cnt: 0, qty: 1 };
const INITIAL: FormState = {
  cool: { ...Z0 }, froz: { ...Z0 }, room: { ...Z0 },
  center: "2cc", regions: [], addrMode: "R", repeatCnt: 1,
  ownerCode: "CU000294", channelCode: "CH00062",
};
const ZONES: { key: "cool" | "froz" | "room"; label: string; emoji: string }[] = [
  { key: "cool", label: "냉장 (210)", emoji: "🌡️" },
  { key: "froz", label: "냉동 (220)", emoji: "❄️" },
  { key: "room", label: "상온 (225)", emoji: "☀️" },
];

export default function KlsForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ProgressEvent[]>([]);
  const [results, setResults] = useState<KlsResult[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number; deliveryDate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { try { const s = localStorage.getItem(LS_KEY); if (s) setForm((p) => ({ ...p, ...JSON.parse(s) })); } catch {} }, []);
  useEffect(() => { if (!running) { try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {} } }, [form, running]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));
  const updateZone = (key: "cool" | "froz" | "room", patch: Partial<KlsZone>) => setForm((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const regionOpts = CENTER_REGIONS[form.center] || [];
  const allRegionsSelected = regionOpts.length > 0 && form.regions.length === regionOpts.length;
  const toggleRegion = (r: string) => setForm((p) => ({ ...p, regions: p.regions.includes(r) ? p.regions.filter((x) => x !== r) : [...p.regions, r] }));
  const toggleAllRegions = () => setForm((p) => ({ ...p, regions: allRegionsSelected ? [] : [...regionOpts] }));
  const onCenterChange = (c: string) => setForm((p) => ({ ...p, center: c, regions: [] }));

  const anyZone = form.cool.on || form.froz.on || form.room.on;
  const missing = useMemo(() => {
    const m: string[] = [];
    if (!anyZone) m.push("온도대");
    if (!form.regions.length) m.push("권역");
    if (!form.channelCode.trim()) m.push("판매처 코드");
    return m;
  }, [form, anyZone]);
  const estOrders = form.addrMode === "R" ? form.regions.length * Math.max(1, form.repeatCnt) : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length) { setError(`누락: ${missing.join(", ")}`); return; }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/logistics-kls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form), signal: ctrl.signal });
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
            else if (payload.kind === "done") { setResults(payload.results ?? []); setDone({ okCount: payload.okCount, total: payload.total, deliveryDate: payload.deliveryDate }); }
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
  const onReset = () => { setSteps([]); setResults([]); setDone(null); setError(null); };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-lg border-l-4 border-teal-400 bg-teal-50 p-3 text-xs text-teal-900 leading-relaxed">
        🏭 <strong>KLS (3PL·FBK)</strong> — 내부망 API(x-owner-code)로 이행계획 검증 → 주문 등록 → 출고번호 조회. 로그인/적립금 불필요.
        <br />⚙ 화주사·판매처 코드는 대상 환경에 존재하는 값이어야 합니다 · 배송일은 내일(KST) 고정 · STG 내부망 필요.
      </div>

      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 온도대별 상품 (KLS)</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {ZONES.map(({ key, label, emoji }) => (
            <div key={key} className="rounded-lg border border-neutral-200 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                <input type="checkbox" checked={form[key].on} onChange={(e) => updateZone(key, { on: e.target.checked })} />
                {emoji} {label}
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block text-xs"><span className="mb-1 block text-neutral-500">종류(0=랜덤)</span>
                  <input type="number" min={0} max={100} className="input font-mono" value={form[key].cnt} disabled={!form[key].on} onChange={(e) => updateZone(key, { cnt: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <label className="block text-xs"><span className="mb-1 block text-neutral-500">수량</span>
                  <input type="number" min={1} max={100} className="input font-mono" value={form[key].qty} disabled={!form[key].on} onChange={(e) => updateZone(key, { qty: Math.max(1, Number(e.target.value) || 1) })} /></label>
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 화주사 / 권역</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="화주사 코드"><input className="input font-mono" value={form.ownerCode} onChange={(e) => update("ownerCode", e.target.value.trim())} placeholder="CU000294" /></Field>
          <Field label="판매처 코드 *"><input className="input font-mono" value={form.channelCode} onChange={(e) => update("channelCode", e.target.value.trim())} placeholder="CH00062" /></Field>
          <Field label="센터">
            <select className="input" value={form.center} onChange={(e) => onCenterChange(e.target.value)}>
              {Object.keys(CENTER_REGIONS).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="주소 모드">
            <div className="flex gap-1">
              {([["R", "랜덤"], ["A", "전체"]] as [("R" | "A"), string][]).map(([v, l]) => (
                <button key={v} type="button" onClick={() => update("addrMode", v)}
                  className={`flex-1 rounded-lg border-2 px-2 py-2 text-xs font-semibold transition ${form.addrMode === v ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 bg-white text-neutral-500"}`}>{l}</button>
              ))}
            </div>
          </Field>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-3">
            <span className="text-sm font-medium text-neutral-700">권역 <span className="text-[11px] text-neutral-400">(최소 1개)</span></span>
            <button type="button" onClick={toggleAllRegions} className="text-xs text-kurly-500 underline">{allRegionsSelected ? "전체 해제" : "전체 선택"}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {regionOpts.map((r) => (
              <button key={r} type="button" onClick={() => toggleRegion(r)}
                className={`rounded-full border px-3 py-1 font-mono text-xs transition ${form.regions.includes(r) ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"}`}>{r}</button>
            ))}
          </div>
        </div>
        {form.addrMode === "R" && (
          <Field label="반복 횟수 (권역별)"><input type="number" min={1} max={100} className="input font-mono w-32" value={form.repeatCnt} onChange={(e) => update("repeatCnt", Math.max(1, Number(e.target.value) || 1))} /></Field>
        )}
      </fieldset>

      <div className="rounded bg-emerald-50 p-2 text-[11px] text-emerald-800">
        {estOrders != null
          ? <>📦 예상 주문 수: 권역 {form.regions.length} × 반복 {form.repeatCnt} = <code className="font-bold">{estOrders}건</code> (최대 100건)</>
          : <>📦 전체 반복 모드 — 선택 권역의 모든 주소가 주문됩니다 (최대 100건)</>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">{running ? "실행 중..." : "🚀 KLS 주문 생성 시작"}</button>
        {running && <button type="button" onClick={onCancel} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
        {!running && (steps.length > 0 || results.length > 0) && <button type="button" onClick={onReset} className="btn-ghost border border-neutral-200">결과 지우기</button>}
        {missing.length > 0 && !running && <span className="text-xs text-amber-700">⚠ 누락: {missing.join(", ")}</span>}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}

      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">진행</div>
          <div className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {steps.map((s, i) => <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>{s.message}</div>)}
          </div>
        </div>
      )}

      {done && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">
            완료: <span className={done.okCount === done.total ? "text-green-600" : "text-amber-600"}>{done.okCount} / {done.total} 성공</span>
            <span className="ml-3 text-neutral-500">배송일 {done.deliveryDate}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">주문번호(client)</th><th className="p-2 text-left">출고번호</th><th className="p-2 text-left">권역</th><th className="p-2 text-left">품목</th><th className="p-2 text-left">상태</th></tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.clientOrderCode ?? "-"}</td>
                    <td className="p-2 font-mono">{r.outbound ?? "-"}</td>
                    <td className="p-2 font-mono">{r.region ?? "-"}</td>
                    <td className="p-2 text-[11px]" title={(r.goods || []).join(", ")}>{r.goods?.length ?? 0}품목</td>
                    <td className="p-2">{r.ok ? "✅" : <span className="text-red-600" title={r.error ?? ""}>❌ {r.status}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-neutral-700">{label}</span>{children}</label>;
}
