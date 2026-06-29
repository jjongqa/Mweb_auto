"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.promotion.v1";
const LACMS_EMAIL_KEY = "kurly-qa:lacms:email";

interface StepEvent { type: "step" | "product"; step?: string; productIndex?: number; ok: boolean; message: string; }
interface Result {
  index: number; code: string;
  promotionId?: number | null; promotionTitle?: string;
  reviewStatus?: string; confirmed: boolean;
  searchedWindows?: number; error?: string;
}

interface FormState {
  lacmsEmail: string;
  lacmsPassword: string;
  promotionUserName: string;
  promotionUserGroupType: string;
  codesText: string;
}

const INITIAL: FormState = {
  lacmsEmail: "",
  lacmsPassword: "",
  promotionUserName: "",
  promotionUserGroupType: "Marketing_ALL",
  codesText: "",
};

export default function PromotionForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const { lacmsPassword, ...rest } = JSON.parse(saved);
        setForm((p) => ({ ...p, ...rest }));
      }
      const e = localStorage.getItem(LACMS_EMAIL_KEY);
      if (e) setForm((p) => ({ ...p, lacmsEmail: e }));
    } catch {}
  }, []);
  useEffect(() => {
    if (!running) {
      try {
        const { lacmsPassword, ...persist } = form;
        localStorage.setItem(LS_KEY, JSON.stringify(persist));
        if (form.lacmsEmail) localStorage.setItem(LACMS_EMAIL_KEY, form.lacmsEmail);
      } catch {}
    }
  }, [form, running]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const parsedCodes = useMemo(() => {
    return form.codesText.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
  }, [form.codesText]);

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.lacmsEmail.trim()) m.push("lacms 이메일");
    if (!form.lacmsPassword) m.push("lacms 패스워드");
    if (parsedCodes.length === 0) m.push("프로모션 코드");
    return m;
  }, [form, parsedCodes]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length > 0) {
      setError(`누락: ${missing.join(", ")}`);
      return;
    }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/promotion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lacmsEmail: form.lacmsEmail.trim(),
          lacmsPassword: form.lacmsPassword,
          promotionUserName: form.promotionUserName,
          promotionUserGroupType: form.promotionUserGroupType,
          codesText: form.codesText,
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
            else if (payload.kind === "done") {
              setResults(payload.results ?? []);
              setDone({ okCount: payload.okCount, total: payload.total });
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
      <fieldset className="card border-l-4 border-l-cyan-400 space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① lacms 인증</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="📧 lacms 이메일">
            <input type="email" className="form-input font-mono text-xs" value={form.lacmsEmail} onChange={(e) => update("lacmsEmail", e.target.value)} placeholder="qa_om_l4@kurlycorp.com" autoComplete="username" />
          </Field>
          <Field label="🔒 패스워드">
            <input type="password" className="form-input font-mono text-xs" value={form.lacmsPassword} onChange={(e) => update("lacmsPassword", e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </Field>
        </div>
        <details className="rounded border border-neutral-200 bg-neutral-50/50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-neutral-700">⚙️ promotion-user 헤더 옵션 (고급)</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="이름 (name)">
              <input className="form-input" value={form.promotionUserName} onChange={(e) => update("promotionUserName", e.target.value)} placeholder="비우면 이메일 local part 사용" />
            </Field>
            <Field label="그룹 타입 (groupType)">
              <input className="form-input font-mono" value={form.promotionUserGroupType} onChange={(e) => update("promotionUserGroupType", e.target.value)} />
              <Help>확정은 Marketing_ALL 권한 필요</Help>
            </Field>
          </div>
        </details>
      </fieldset>

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 프로모션 코드 입력</legend>
        <Field label="프로모션 코드 (여러 개 입력 가능) *">
          <textarea
            className="form-input font-mono text-xs"
            rows={4}
            value={form.codesText}
            onChange={(e) => update("codesText", e.target.value)}
            placeholder="B5LTR&#10;ABC123&#10;XYZ789&#10;(한 줄에 하나 또는 쉼표/공백 구분, 최대 50개)"
          />
          <Help>
            {parsedCodes.length > 0
              ? <>인식된 코드: <strong>{parsedCodes.length}개</strong> · {parsedCodes.slice(0, 5).join(", ")}{parsedCodes.length > 5 ? " ..." : ""}</>
              : "한 줄에 하나씩 또는 쉼표/공백으로 구분"}
          </Help>
        </Field>
      </fieldset>

      <div className="rounded bg-cyan-50 p-2 text-[11px] text-cyan-900">
        🔄 흐름: <strong>OAuth 로그인 → 코드별 90일 창 4개 스캔(최근→과거→미래) → promotionId 추출 → PUT confirm</strong>
        <br />
        ⏱ 확정 후 +5분 → 공급사 판촉합의서 날인 가능
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running || missing.length > 0} className="btn-primary">
          {running ? "처리 중..." : `✅ ${parsedCodes.length}건 확정 시작`}
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
              <div key={i} className={s.ok ? (s.type === "step" ? "font-semibold text-cyan-700" : "text-neutral-700") : "text-red-600"}>
                {s.ok ? "✅" : "❌"} {s.type === "step" ? `[${s.step}]` : ""} {s.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">
            완료: <span className={done.okCount === done.total ? "text-green-600" : "text-amber-600"}>{done.okCount} / {done.total} 확정 성공</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">코드</th>
                  <th className="p-2 text-left">promotionId</th>
                  <th className="p-2 text-left">제목</th>
                  <th className="p-2 text-left">검토상태</th>
                  <th className="p-2 text-left">확정</th>
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.code}</td>
                    <td className="p-2 font-mono">{r.promotionId ?? "-"}</td>
                    <td className="p-2 text-[11px]">{r.promotionTitle ?? "-"}</td>
                    <td className="p-2 font-mono text-[10px]">{r.reviewStatus ?? "-"}</td>
                    <td className="p-2">{r.confirmed ? "✅" : "❌"}</td>
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
