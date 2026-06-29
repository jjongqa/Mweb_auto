"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.point.v1";

interface StepEvent { type: "product"; productIndex: number; ok: boolean; message: string; }
interface Result { index: number; ok: boolean; status?: number; seq?: any; charge?: number; regDateTime?: string; expireDateTime?: string; error?: string; }

type PayType = "POINT" | "CASH";

interface FormState {
  memberNumber: string;
  point: number;
  count: number;
  expireDays: number;       // 오늘부터 N일 후
  memo: string;
  detail: string;
  actionMemberNumber: number;
  // 컬리캐시
  cashAmount: number;
  redeemCode: string;
  redeemCodeType: string;
}

const INITIAL: FormState = {
  memberNumber: "",
  point: 1000000,
  count: 1,
  expireDays: 365,
  memo: "테스트지급",
  detail: "QA 자동지급",
  actionMemberNumber: 7671779,
  cashAmount: 10000,
  redeemCode: "",
  redeemCodeType: "B2B",
};

export default function PointForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [payType, setPayType] = useState<PayType>("POINT");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number; totalCharge: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setForm((p) => ({ ...p, ...JSON.parse(saved) }));
    } catch {}
  }, []);
  useEffect(() => {
    if (!running) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {}
    }
  }, [form, running]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.memberNumber.trim()) m.push("회원번호");
    if (payType === "POINT") {
      if (!form.point || form.point <= 0) m.push("적립금 금액");
    } else {
      if (!form.cashAmount || form.cashAmount <= 0) m.push("컬리캐시 금액");
    }
    return m;
  }, [form, payType]);

  const computedExpire = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + Math.max(1, form.expireDays));
    d.setHours(23, 59, 59, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:59+09:00`;
  }, [form.expireDays]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running || missing.length > 0) {
      if (missing.length > 0) setError(`누락: ${missing.join(", ")}`);
      return;
    }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const endpoint = payType === "CASH" ? "/api/test-data/cash-publish" : "/api/test-data/point";
      const reqBody = payType === "CASH"
        ? {
            memberNo: form.memberNumber.trim(),
            amount: form.cashAmount,
            count: form.count,
            redeemCode: form.redeemCode.trim() || undefined,
            redeemCodeType: form.redeemCodeType.trim() || "B2B",
          }
        : {
            memberNumber: form.memberNumber.trim(),
            point: form.point,
            count: form.count,
            expireDateTime: computedExpire,
            memo: form.memo,
            detail: form.detail,
            actionMemberNumber: form.actionMemberNumber,
          };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
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
            else if (payload.kind === "done") {
              setResults(payload.results ?? []);
              setDone({ okCount: payload.okCount, total: payload.total, totalCharge: payload.totalCharge });
            } else if (payload.kind === "fatal") setError(payload.error);
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
  function onReset() { setSteps([]); setResults([]); setDone(null); setError(null); }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 지급 유형 토글 */}
      <div className="flex gap-2">
        {([["POINT", "💰 적립금"], ["CASH", "🪙 컬리캐시"]] as [PayType, string][]).map(([t, label]) => (
          <button
            key={t} type="button" disabled={running} onClick={() => setPayType(t)}
            className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-semibold transition disabled:opacity-50 ${payType === t ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"}`}
          >{label}</button>
        ))}
      </div>

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 지급 정보</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="회원번호 *">
            <input type="text" className="form-input font-mono" value={form.memberNumber} onChange={(e) => update("memberNumber", e.target.value.trim())} placeholder="25336312" />
            <Help>{payType === "CASH" ? "컬리캐시" : "적립금"} 받을 회원</Help>
          </Field>
          {payType === "POINT" ? (
            <>
              <Field label="적립금 금액(원) *">
                <input type="number" min={1} step={1000} className="form-input" value={form.point} onChange={(e) => update("point", Math.max(1, Number(e.target.value) || 0))} />
                <Help>{form.point.toLocaleString()}원</Help>
              </Field>
              <Field label="지급 건수">
                <input type="number" min={1} max={100} className="form-input" value={form.count} onChange={(e) => update("count", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
                <Help>같은 회원에게 N번 반복</Help>
              </Field>
              <Field label="유효 기간 (일)">
                <input type="number" min={1} max={3650} className="form-input" value={form.expireDays} onChange={(e) => update("expireDays", Math.max(1, Number(e.target.value) || 365))} />
                <Help>만료일: {computedExpire.slice(0, 10)}</Help>
              </Field>
            </>
          ) : (
            <>
              <Field label="컬리캐시 금액(원) *">
                <input type="number" min={1000} step={1000} className="form-input" value={form.cashAmount} onChange={(e) => update("cashAmount", Math.max(1, Number(e.target.value) || 0))} />
                <Help>{form.cashAmount.toLocaleString()}원 · 최소 1,000원 단위</Help>
              </Field>
              <Field label="지급 건수">
                <input type="number" min={1} max={100} className="form-input" value={form.count} onChange={(e) => update("count", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
                <Help>같은 회원에게 N번 반복</Help>
              </Field>
              <Field label="redeemCodeType">
                <input className="form-input font-mono" value={form.redeemCodeType} onChange={(e) => update("redeemCodeType", e.target.value.trim())} placeholder="B2B" />
                <Help>기본 B2B</Help>
              </Field>
            </>
          )}
        </div>
        {payType === "CASH" && (
          <Field label="redeemCode 접두어 (선택)">
            <input className="form-input font-mono" value={form.redeemCode} onChange={(e) => update("redeemCode", e.target.value.trim())} placeholder="qa" />
            <Help>redeemCode는 1회용 멱등키 → 호출마다 <strong>고유값 자동 생성</strong>(예: {(form.redeemCode || "qa")}_xxx1). 비우면 "qa". 같은 회원 반복 지급도 중복 없이 됨.</Help>
          </Field>
        )}
        {payType === "CASH" && (
          <div className="rounded border-l-4 border-amber-400 bg-amber-50 p-2 text-[11px] text-amber-900">
            ⚠ <strong>컬리페이 가입 회원만 지급 가능</strong>합니다. 미가입 회원은 <code>잘못된 회원입니다</code> 오류가 납니다 — 컬리페이 가입 여부를 먼저 확인하세요.
          </div>
        )}
      </fieldset>

      {payType === "POINT" && (
        <fieldset className="card space-y-3 p-5" disabled={running}>
          <legend className="text-sm font-semibold text-neutral-700">② 부가 정보 (선택)</legend>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="memo"><input className="form-input" value={form.memo} onChange={(e) => update("memo", e.target.value)} placeholder="테스트지급" /></Field>
            <Field label="detail"><input className="form-input" value={form.detail} onChange={(e) => update("detail", e.target.value)} placeholder="QA 자동지급" /></Field>
            <Field label="지급자 회원번호 (actionMemberNumber)"><input type="number" className="form-input font-mono" value={form.actionMemberNumber} onChange={(e) => update("actionMemberNumber", Number(e.target.value) || 7671779)} /></Field>
          </div>
        </fieldset>
      )}

      <div className="rounded bg-emerald-50 p-2 text-[11px] text-emerald-800">
        {payType === "CASH"
          ? <>🪙 1회당 {form.cashAmount.toLocaleString()}원 × {form.count}건 = <code className="font-bold">{(form.cashAmount * form.count).toLocaleString()}원</code> 컬리캐시 지급 예정</>
          : <>💰 1회당 {form.point.toLocaleString()}원 × {form.count}건 = <code className="font-bold">{(form.point * form.count).toLocaleString()}원</code> 적립금 지급 예정</>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">
          {running ? "처리 중..." : `${payType === "CASH" ? "🪙 컬리캐시" : "💰 적립금"} ${form.count}건 지급 시작`}
        </button>
        {running && <button type="button" onClick={onCancel} className="btn-secondary">⛔ 중단</button>}
        {!running && (steps.length > 0 || results.length > 0) && (
          <button type="button" onClick={onReset} className="btn-secondary">결과 지우기</button>
        )}
        {missing.length > 0 && !running && (
          <span className="text-xs text-amber-700">⚠ 누락: {missing.join(", ")}</span>
        )}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}

      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">진행</div>
          <div className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {steps.map((s, i) => (
              <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>
                {s.ok ? "✅" : "❌"} {s.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">
            완료: <span className={done.okCount === done.total ? "text-green-600" : "text-amber-600"}>{done.okCount} / {done.total} 성공</span>
            {done.totalCharge > 0 && <span className="ml-3 text-neutral-600">· 총 지급: {done.totalCharge.toLocaleString()}원</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">seq</th>
                  <th className="p-2 text-left">지급 금액</th>
                  <th className="p-2 text-left">만료일</th>
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.seq ?? "-"}</td>
                    <td className="p-2 font-mono">{r.charge?.toLocaleString() ?? "-"}</td>
                    <td className="p-2 font-mono text-[11px]">{r.expireDateTime?.slice(0, 10) ?? "-"}</td>
                    <td className="p-2">{r.ok ? "✅" : "❌"}</td>
                    <td className="p-2 text-red-600 max-w-[300px] truncate" title={r.error ?? ""}>{r.error ?? ""}</td>
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
