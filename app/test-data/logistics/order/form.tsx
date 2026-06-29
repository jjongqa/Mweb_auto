"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.order.v2";

// 센터→권역 (lib/test-data-logistics-order.ts CENTER_REGIONS 와 동일, 서버 lib 미import).
const CENTER_REGIONS: Record<string, string[]> = {
  "2cc": ["A", "B", "C", "D", "F", "S", "T", "W", "X", "Z"],
  "3cc": ["-", "CA", "CS", "DJ", "GW", "H", "M", "PT", "R", "U", "Y"],
  "4cc": ["BS", "DE", "DW", "GC", "JI", "PG", "UL", "YS"],
};
const MODE_OPTIONS = ["미선택", "1P 상품", "FBK 포함 (1P+FBK)", "FBK 상품만"] as const;
type OrderMode = (typeof MODE_OPTIONS)[number];

interface ZoneSel { mode: OrderMode; cnt: number; qty: number }
interface OrderResult { index: number; ok: boolean; orderNo?: string; outbound?: string; region?: string; totalPrice?: number; status: string; invoice?: string; tmsPublished?: number; error?: string }
interface ProgressEvent { type: "order"; index: number; ok: boolean; message: string }
interface TmsResult { index: number; clientOrderCode: string; ok: boolean; outbound?: string; labels?: string[]; published?: number; error?: string }
interface TmsProgressEvent { type: "tms"; index: number; ok: boolean; message: string }

interface FormState {
  userId: string;
  cool: ZoneSel; froz: ZoneSel; room: ZoneSel;
  center: string;
  regions: string[];
  addrMode: "R" | "A";
  repeatCnt: number;
  omsTransfer: boolean;
  publishTms: boolean;
}

const Z0: ZoneSel = { mode: "미선택", cnt: 0, qty: 1 };
const INITIAL: FormState = {
  userId: "",
  cool: { ...Z0 }, froz: { ...Z0 }, room: { ...Z0 },
  center: "2cc",
  regions: [],
  addrMode: "R",
  repeatCnt: 1,
  omsTransfer: false,
  publishTms: false,
};

const ZONES: { key: "cool" | "froz" | "room"; label: string; emoji: string }[] = [
  { key: "cool", label: "냉장 (210)", emoji: "🌡️" },
  { key: "froz", label: "냉동 (220)", emoji: "❄️" },
  { key: "room", label: "상온 (225)", emoji: "☀️" },
];

export default function OrderForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [userPw, setUserPw] = useState("");  // 비번 미저장

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ProgressEvent[]>([]);
  const [results, setResults] = useState<OrderResult[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 독립 TMS 발행 (기존 주문번호)
  const [tmsCodes, setTmsCodes] = useState("");
  const [tmsRunning, setTmsRunning] = useState(false);
  const [tmsSteps, setTmsSteps] = useState<TmsProgressEvent[]>([]);
  const [tmsDone, setTmsDone] = useState<{ okCount: number; total: number } | null>(null);
  const [tmsError, setTmsError] = useState<string | null>(null);
  const tmsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setForm((p) => ({ ...p, ...JSON.parse(saved) }));
    } catch {}
  }, []);
  useEffect(() => {
    if (!running) { try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {} }
  }, [form, running]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));
  const updateZone = (key: "cool" | "froz" | "room", patch: Partial<ZoneSel>) =>
    setForm((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const regionOpts = CENTER_REGIONS[form.center] || [];
  const allRegionsSelected = regionOpts.length > 0 && form.regions.length === regionOpts.length;

  function toggleRegion(r: string) {
    setForm((p) => ({ ...p, regions: p.regions.includes(r) ? p.regions.filter((x) => x !== r) : [...p.regions, r] }));
  }
  function toggleAllRegions() {
    setForm((p) => ({ ...p, regions: allRegionsSelected ? [] : [...regionOpts] }));
  }
  function onCenterChange(c: string) {
    setForm((p) => ({ ...p, center: c, regions: [] }));  // 센터 바뀌면 권역 초기화
  }

  const anyZone = form.cool.mode !== "미선택" || form.froz.mode !== "미선택" || form.room.mode !== "미선택";
  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.userId.trim() || !userPw.trim()) m.push("컬리 계정");
    if (!anyZone) m.push("온도대 상품 구성");
    if (!form.regions.length) m.push("권역");
    return m;
  }, [form, userPw, anyZone]);

  const estOrders = form.addrMode === "R" ? form.regions.length * Math.max(1, form.repeatCnt) : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length) { setError(`누락: ${missing.join(", ")}`); return; }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/logistics-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, userPw: userPw.trim() }),
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
            else if (payload.kind === "done") { setResults(payload.results ?? []); setDone({ okCount: payload.okCount, total: payload.total }); }
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
  function onCancel() { abortRef.current?.abort(); }
  function onReset() { setSteps([]); setResults([]); setDone(null); setError(null); }

  // 결과의 성공 주문번호를 TMS 입력란에 채우기
  function fillTmsFromResults() {
    const codes = results.filter((r) => r.ok && r.orderNo).map((r) => r.orderNo);
    setTmsCodes(codes.join("\n"));
  }

  async function onTmsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tmsRunning) return;
    const codes = tmsCodes.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!codes.length) { setTmsError("주문번호를 입력하세요"); return; }
    setTmsRunning(true); setTmsSteps([]); setTmsDone(null); setTmsError(null);
    const ctrl = new AbortController(); tmsAbortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/logistics-order/tms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCodes: codes }), signal: ctrl.signal,
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
            if (payload.kind === "progress") setTmsSteps((prev) => [...prev, payload.event]);
            else if (payload.kind === "done") setTmsDone({ okCount: payload.okCount, total: payload.total });
            else if (payload.kind === "fatal") setTmsError(payload.error);
          } catch {}
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) setTmsError(err instanceof Error ? err.message : String(err));
    } finally {
      setTmsRunning(false); tmsAbortRef.current = null;
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-lg border-l-4 border-sky-400 bg-sky-50 p-3 text-xs text-sky-900 leading-relaxed">
        📦 <strong>1P 컬리몰 주문</strong> — 로그인 → 주문서 → 적립금 결제 → (옵션)OMS 전송·출고요청번호 조회까지 자동. 주소 1건당 주문 1건.
        <br />⚠ <strong>적립금 전액 결제</strong>라 계정에 결제예정금액 이상 적립금이 있어야 통과합니다. STG 내부망 필요.
      </div>

      {/* 계정 */}
      <fieldset className="card grid grid-cols-2 gap-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 컬리 계정 (STG)</legend>
        <Field label="아이디 *"><input className="input font-mono" value={form.userId} onChange={(e) => update("userId", e.target.value.trim())} placeholder="stg 계정 ID" /></Field>
        <Field label="비밀번호 *"><input type="password" className="input" value={userPw} onChange={(e) => setUserPw(e.target.value)} placeholder="••••" /><Help>저장되지 않습니다</Help></Field>
      </fieldset>

      {/* 온도대별 상품 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 온도대별 상품 구성</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {ZONES.map(({ key, label, emoji }) => (
            <div key={key} className="rounded-lg border border-neutral-200 p-3">
              <div className="mb-2 text-sm font-semibold text-neutral-700">{emoji} {label}</div>
              <label className="block text-xs">
                <span className="mb-1 block text-neutral-500">상품 구성</span>
                <select className="input" value={form[key].mode} onChange={(e) => updateZone(key, { mode: e.target.value as OrderMode })}>
                  {MODE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-neutral-500">종류(0=랜덤)</span>
                  <input type="number" min={0} max={100} className="input font-mono" value={form[key].cnt} onChange={(e) => updateZone(key, { cnt: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-neutral-500">수량</span>
                  <input type="number" min={1} max={100} className="input font-mono" value={form[key].qty} onChange={(e) => updateZone(key, { qty: Math.max(1, Number(e.target.value) || 1) })} />
                </label>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500">FBK 포함은 최소 2종 보장 · FBK 종류는 데이터에 따라 제한됩니다.</p>
      </fieldset>

      {/* 권역 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">③ 권역 / 주소</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="센터">
            <select className="input" value={form.center} onChange={(e) => onCenterChange(e.target.value)}>
              {Object.keys(CENTER_REGIONS).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="주소 모드">
            <div className="flex gap-2">
              {([["R", "랜덤 1개"], ["A", "전체 반복"]] as [("R" | "A"), string][]).map(([v, l]) => (
                <button key={v} type="button" onClick={() => update("addrMode", v)}
                  className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition ${form.addrMode === v ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 bg-white text-neutral-500"}`}>{l}</button>
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
            {regionOpts.map((r) => {
              const active = form.regions.includes(r);
              return (
                <button key={r} type="button" onClick={() => toggleRegion(r)}
                  className={`rounded-full border px-3 py-1 font-mono text-xs transition ${active ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"}`}>{r}</button>
              );
            })}
          </div>
        </div>

        {form.addrMode === "R" && (
          <Field label="반복 횟수 (권역별)">
            <input type="number" min={1} max={100} className="input font-mono w-32" value={form.repeatCnt} onChange={(e) => update("repeatCnt", Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={form.omsTransfer} onChange={(e) => update("omsTransfer", e.target.checked)} />
          주문 후 OMS 전송 (testTransferPlan) — 출고요청번호 조회 정확도 ↑
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={form.publishTms} onChange={(e) => update("publishTms", e.target.checked)} />
          주문 후 <strong>Kafka TMS 발행</strong> (운송장 생성) — OMS 출고 처리 후 발행되므로 OMS 전송 동반 권장
        </label>
      </fieldset>

      <div className="rounded bg-emerald-50 p-2 text-[11px] text-emerald-800">
        {estOrders != null
          ? <>📦 예상 주문 수: 권역 {form.regions.length} × 반복 {form.repeatCnt} = <code className="font-bold">{estOrders}건</code> (최대 100건 제한)</>
          : <>📦 전체 반복 모드 — 선택 권역의 모든 주소가 주문됩니다 (최대 100건 제한)</>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">{running ? "실행 중..." : "🔥 주문 생성 시작"}</button>
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
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">주문번호</th><th className="p-2 text-left">출고요청번호</th><th className="p-2 text-left">운송장</th><th className="p-2 text-left">권역</th><th className="p-2 text-left">금액</th><th className="p-2 text-left">상태</th></tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.orderNo ?? "-"}</td>
                    <td className="p-2 font-mono">{r.outbound ?? "-"}</td>
                    <td className="p-2 font-mono text-[11px]" title={r.invoice ?? ""}>{r.tmsPublished ? `${r.tmsPublished}건` : "-"}</td>
                    <td className="p-2 font-mono">{r.region ?? "-"}</td>
                    <td className="p-2 font-mono">{r.totalPrice?.toLocaleString() ?? "-"}</td>
                    <td className="p-2">{r.ok ? "✅" : <span className="text-red-600" title={r.error ?? ""}>❌ {r.status}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {results.some((r) => r.ok && r.orderNo) && (
            <button type="button" onClick={fillTmsFromResults} className="mt-3 text-xs text-kurly-500 underline">↓ 성공 주문번호를 아래 TMS 발행란에 채우기</button>
          )}
        </div>
      )}

      {/* 독립 TMS 발행 — 기존 주문번호 */}
      <fieldset className="card space-y-3 p-5" disabled={tmsRunning}>
        <legend className="text-sm font-semibold text-neutral-700">＋ 기존 주문번호로 TMS 발행 (운송장 생성)</legend>
        <p className="text-[11px] text-neutral-500">이미 만든 주문(대표주문번호)에 대해 Kafka TMS 만 발행합니다. OMS 출고 처리가 끝난 뒤 실행하세요. (한 줄에 하나, 최대 100건)</p>
        <textarea className="input font-mono h-24" value={tmsCodes} onChange={(e) => setTmsCodes(e.target.value)} placeholder={"주문번호1\n주문번호2"} />
        <div className="flex items-center gap-3">
          <button type="button" onClick={onTmsSubmit} disabled={tmsRunning} className="btn-primary">{tmsRunning ? "발행 중..." : "📮 TMS 발행"}</button>
          {tmsRunning && <button type="button" onClick={() => tmsAbortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
        </div>
        {tmsError && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {tmsError}</div>}
        {tmsSteps.length > 0 && (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded bg-neutral-50 p-2 font-mono text-xs">
            {tmsSteps.map((s, i) => <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>{s.message}</div>)}
          </div>
        )}
        {tmsDone && (
          <div className="text-sm font-semibold">완료: <span className={tmsDone.okCount === tmsDone.total ? "text-green-600" : "text-amber-600"}>{tmsDone.okCount} / {tmsDone.total} 발행 성공</span></div>
        )}
      </fieldset>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-neutral-700">{label}</span>{children}</label>;
}
function Help({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] text-neutral-500">{children}</p>;
}
