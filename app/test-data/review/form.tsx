"use client";

import { useEffect, useRef, useState } from "react";

const LS_KEY = "kurly-qa.review.v1";

interface StepEvent { type: "phase" | "review"; index?: number; ok: boolean; message: string; }
interface Result { index: number; orderNo: number | string; dealProductNo: number | string; productName?: string | null; ok: boolean; status?: number; error?: string; }

interface FormState {
  memberNo: string;
  contents: string;
  maxCount: number;       // 0 = 작성 가능 전체
  passStatus: "NONE" | "ALL" | "FORBIDDEN";
}

const INITIAL: FormState = {
  memberNo: "",
  contents: "",
  maxCount: 0,
  passStatus: "NONE",
};

export default function ReviewForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number; writableTotal: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { const saved = localStorage.getItem(LS_KEY); if (saved) setForm((p) => ({ ...p, ...JSON.parse(saved) })); } catch {}
  }, []);
  useEffect(() => {
    if (!running) { try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {} }
  }, [form, running]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (!form.memberNo.trim()) { setError("회원번호 필요"); return; }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberNo: form.memberNo.trim(),
          contents: form.contents.trim() || undefined,
          maxCount: form.maxCount,
          passStatus: form.passStatus,
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
            else if (payload.kind === "done") {
              setResults(payload.results ?? []);
              setDone({ okCount: payload.okCount, total: payload.total, writableTotal: payload.writableTotal });
              if (payload.error) setError(payload.error);
            } else if (payload.kind === "fatal") setError(payload.error);
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

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 회원번호</legend>
        <Field label="🆔 회원번호 (memberNo) — 필수">
          <input type="text" inputMode="numeric" className="form-input font-mono" value={form.memberNo} onChange={(e) => update("memberNo", e.target.value.trim())} placeholder="예: 25340400" />
          <Help>이 회원의 <strong>배송완료된 주문</strong> 중 작성 가능한 후기를 조회해 작성합니다.</Help>
        </Field>
      </fieldset>

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 후기 옵션</legend>
        <Field label="후기 내용 (비우면 기본 문구 자동·회전)">
          <textarea className="form-input" rows={3} value={form.contents} onChange={(e) => update("contents", e.target.value)} placeholder="(비우면 기본 후기 문구를 항목마다 회전 적용 — 10자 이상)" />
          <Help>입력해도 항목마다 <strong>(주문 ······)</strong> 꼬리표가 붙습니다 — 후기는 동일 내용이면 422로 막혀서 자동으로 유니크하게 만들어요.</Help>
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="작성 개수 (0 = 작성 가능 전체)">
            <input type="number" min={0} max={100} className="form-input" value={form.maxCount} onChange={(e) => update("maxCount", Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
            <Help>최대 100. 0이면 작성 가능한 후기를 전부 작성.</Help>
          </Field>
          <Field label="검증 (passStatus)">
            <select className="form-input" value={form.passStatus} onChange={(e) => update("passStatus", e.target.value as FormState["passStatus"])}>
              <option value="NONE">NONE (검증 안 함 — 테스트용 권장)</option>
              <option value="FORBIDDEN">FORBIDDEN (금칙어만)</option>
              <option value="ALL">ALL (금칙어 + 무의미)</option>
            </select>
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running || !form.memberNo.trim()} className="btn-primary">
          {running ? "처리 중..." : "⭐ 후기 작성"}
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
              <div key={i} className={s.ok ? (s.type === "phase" ? "font-semibold text-amber-700" : "text-neutral-700") : "text-red-600"}>{s.ok ? "✅" : "❌"} {s.message}</div>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">
            완료: <span className={done.okCount === done.total && done.total > 0 ? "text-green-600" : "text-amber-600"}>{done.okCount} / {done.total} 작성 성공</span>
            <span className="ml-2 text-xs font-normal text-neutral-500">(작성 가능 {done.writableTotal}건)</span>
            {done.writableTotal === 0 && <span className="ml-2 text-xs text-amber-600">※ 작성 가능한 후기 없음 — 배송완료된 주문이 있는지 확인</span>}
          </div>
          {results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="p-2 text-left">#</th>
                    <th className="p-2 text-left">주문번호</th>
                    <th className="p-2 text-left">딜번호</th>
                    <th className="p-2 text-left">상품명</th>
                    <th className="p-2 text-left">상태</th>
                    <th className="p-2 text-left">오류</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.index} className="border-t border-neutral-100">
                      <td className="p-2">{r.index}</td>
                      <td className="p-2 font-mono">{r.orderNo}</td>
                      <td className="p-2 font-mono">{r.dealProductNo}</td>
                      <td className="p-2 text-[11px]">{r.productName ?? "-"}</td>
                      <td className="p-2">{r.ok ? "✅" : "❌"}</td>
                      <td className="p-2 text-red-600 max-w-[300px] truncate" title={r.error ?? ""}>{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
