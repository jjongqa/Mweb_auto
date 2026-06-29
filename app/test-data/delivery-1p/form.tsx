"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.delivery-1p.v1";

interface StepEvent { type: "order"; index: number; ok: boolean; message: string; }
interface Result { index: number; parentOrderNo: string | number; ok: boolean; status?: number; error?: string; }

interface FormState {
  parentOrderNosText: string;
  status: "DELIVERED" | "DELIVERING";
}

const INITIAL: FormState = {
  parentOrderNosText: "",
  status: "DELIVERED",
};

export default function Delivery1pForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { const saved = localStorage.getItem(LS_KEY); if (saved) setForm((p) => ({ ...p, ...JSON.parse(saved) })); } catch {}
  }, []);
  useEffect(() => {
    if (!running) { try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {} }
  }, [form, running]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const parsedOrders = useMemo(
    () => form.parentOrderNosText.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean),
    [form.parentOrderNosText]
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (parsedOrders.length === 0) { setError("대표주문번호 최소 1개 필요"); return; }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/delivery-1p", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentOrderNosText: form.parentOrderNosText, status: form.status }),
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
            else if (payload.kind === "done") { setResults(payload.results ?? []); setDone({ okCount: payload.okCount, total: payload.total }); }
            else if (payload.kind === "fatal") setError(payload.error);
          } catch {}
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function onCancel() { abortRef.current?.abort(); }
  function onReset() { setSteps([]); setResults([]); setDone(null); setError(null); }

  const label = form.status === "DELIVERED" ? "배송완료" : "배송중";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 배송상태</legend>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => update("status", "DELIVERED")}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${form.status === "DELIVERED" ? "bg-rose-500 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
          >✅ 배송완료</button>
          <button
            type="button"
            onClick={() => update("status", "DELIVERING")}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${form.status === "DELIVERING" ? "bg-rose-500 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
          >🚚 배송중</button>
        </div>
        <Help>{form.status === "DELIVERED" ? "DELIVERY_COMPLETED 발행 → 배송완료 전환 (후기/반품 버튼 노출 기준)" : "DELIVERY_ING 발행 → 배송중 전환"}</Help>
      </fieldset>

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 대표주문번호 입력</legend>
        <Field label="대표주문번호 (orderCode) — 여러 개 입력 가능 *">
          <textarea
            className="form-input font-mono text-xs"
            rows={5}
            value={form.parentOrderNosText}
            onChange={(e) => update("parentOrderNosText", e.target.value)}
            placeholder="2382716160001&#10;2382616500003&#10;(한 줄에 하나 또는 쉼표/공백으로 구분)"
          />
          <Help>
            {parsedOrders.length > 0
              ? <>인식된 주문: <strong>{parsedOrders.length}건</strong> · {parsedOrders.slice(0, 5).join(", ")}{parsedOrders.length > 5 ? " ..." : ""}</>
              : "주문완료 상태의 대표주문번호. 한 줄에 하나씩 또는 쉼표/공백 구분. 최대 100건."}
          </Help>
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running || parsedOrders.length === 0} className="btn-primary">
          {running ? "처리 중..." : `🚚 ${parsedOrders.length}건 ${label} 발행`}
        </button>
        {running && <button type="button" onClick={onCancel} className="btn-secondary">⛔ 중단</button>}
        {!running && (steps.length > 0 || results.length > 0) && <button type="button" onClick={onReset} className="btn-secondary">결과 지우기</button>}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}

      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">진행</div>
          <div className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {steps.map((s, i) => (
              <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>{s.ok ? "✅" : "❌"} {s.message}</div>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">
            완료: <span className={done.okCount === done.total ? "text-green-600" : "text-amber-600"}>{done.okCount} / {done.total} 발행 성공</span>
            <span className="ml-2 text-xs font-normal text-neutral-500">※ 발행 성공 = Kafka 접수. 컬리몰 반영은 수 초 내 (la-cms/주문상세 확인 권장)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">대표주문번호</th>
                  <th className="p-2 text-left">HTTP</th>
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.parentOrderNo}</td>
                    <td className="p-2 font-mono">{r.status ?? "-"}</td>
                    <td className="p-2">{r.ok ? "✅" : "❌"}</td>
                    <td className="p-2 text-red-600 max-w-[320px] truncate" title={r.error ?? ""}>{r.error ?? ""}</td>
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
