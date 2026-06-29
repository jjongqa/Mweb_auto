"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.membership-cancel-reserve.v1";

// 라이브 GET /v1/subscriptions/cancel-reason 값(2026-06-18)
const CANCEL_REASONS = [
  { id: 1, reason: "멤버십 혜택을 이용하지 않아서" },
  { id: 2, reason: "멤버십 혜택이 적어서" },
  { id: 3, reason: "멤버십 가입비가 부담되어서" },
  { id: 4, reason: "컬리를 이용하지 않아서" },
  { id: 5, reason: "기타" },
];

interface StepEvent { type: "member"; index: number; ok: boolean; message: string; }
interface Result { index: number; memberNo: number | string; ok: boolean; status?: number; error?: string; }

interface FormState {
  memberNosText: string;
  isCancelReserved: boolean;   // true=해지예약 전환, false=해지예약 취소
  cancelReasonId: number;
  opinion: string;
}

const INITIAL: FormState = {
  memberNosText: "",
  isCancelReserved: true,
  cancelReasonId: 1,
  opinion: "",
};

export default function MembershipCancelReserveForm() {
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

  const parsedMembers = useMemo(
    () => form.memberNosText.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean),
    [form.memberNosText]
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (parsedMembers.length === 0) { setError("회원번호 최소 1개 필요"); return; }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/membership-cancel-reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberNosText: form.memberNosText,
          isCancelReserved: form.isCancelReserved,
          cancelReasonId: form.isCancelReserved ? form.cancelReasonId : null,
          opinion: form.isCancelReserved ? form.opinion : null,
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

  const actionLabel = form.isCancelReserved ? "해지예약 전환" : "해지예약 취소";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 동작</legend>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => update("isCancelReserved", true)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${form.isCancelReserved ? "bg-fuchsia-500 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
          >🚪 해지예약 전환</button>
          <button
            type="button"
            onClick={() => update("isCancelReserved", false)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${!form.isCancelReserved ? "bg-fuchsia-500 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
          >🔁 해지예약 취소</button>
        </div>
        <Help>
          {form.isCancelReserved
            ? "구독 종료일에 해지되도록 예약 (cancelReserved=true). 전제: 이미 멤버스 구독 중인 회원."
            : "이미 걸어둔 해지 예약을 취소하고 구독 유지 (cancelReserved=false)."}
        </Help>
      </fieldset>

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 회원번호 입력</legend>
        <Field label="회원번호 (memberNo) — 여러 개 입력 가능 *">
          <textarea
            className="form-input font-mono text-xs"
            rows={5}
            value={form.memberNosText}
            onChange={(e) => update("memberNosText", e.target.value)}
            placeholder="25339989&#10;25337521&#10;25340585&#10;(한 줄에 하나 또는 쉼표/공백으로 구분)"
          />
          <Help>
            {parsedMembers.length > 0
              ? <>인식된 회원: <strong>{parsedMembers.length}명</strong> · {parsedMembers.slice(0, 5).join(", ")}{parsedMembers.length > 5 ? " ..." : ""}</>
              : "한 줄에 하나씩 또는 쉼표/공백으로 구분. 최대 100명."}
          </Help>
        </Field>
      </fieldset>

      {form.isCancelReserved && (
        <fieldset className="card space-y-4 p-5" disabled={running}>
          <legend className="text-sm font-semibold text-neutral-700">③ 해지 사유 (선택)</legend>
          <Field label="해지 사유 (cancelReasonId)">
            <select className="form-input" value={form.cancelReasonId} onChange={(e) => update("cancelReasonId", Number(e.target.value))}>
              {CANCEL_REASONS.map((r) => (<option key={r.id} value={r.id}>{r.id}. {r.reason}</option>))}
            </select>
          </Field>
          <Field label="기타 의견 (opinion, 선택)">
            <input className="form-input" value={form.opinion} onChange={(e) => update("opinion", e.target.value)} placeholder="(선택) 기타 의견" />
          </Field>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running || parsedMembers.length === 0} className="btn-primary">
          {running ? "처리 중..." : `🚪 ${parsedMembers.length}명 ${actionLabel}`}
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
            완료: <span className={done.okCount === done.total ? "text-green-600" : "text-amber-600"}>{done.okCount} / {done.total} 성공</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">회원번호</th>
                  <th className="p-2 text-left">HTTP</th>
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.memberNo}</td>
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
