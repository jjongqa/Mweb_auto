"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.membership.v1";
const LACMS_EMAIL_KEY = "kurly-qa:lacms:email";

interface StepEvent { type: "product"; productIndex: number; ok: boolean; message: string; }
interface Result {
  index: number; memberNo: number | string; ok: boolean; status?: number;
  ticketId?: any; ticketName?: string; ticketStatus?: string;
  startSubscriptionDate?: string; nextSettlementDate?: string;
  error?: string;
}

type Mode = "subscribe" | "unsubscribe";

interface FormState {
  memberNosText: string;
  productCd: string;
  ticketMetaId: number;
  benefitOptionId: number;
  lacmsEmail: string;
  lacmsPassword: string;
}

const INITIAL: FormState = {
  memberNosText: "",
  productCd: "KM0001",
  ticketMetaId: 3,
  benefitOptionId: 1,
  lacmsEmail: "",
  lacmsPassword: "",
};

export default function MembershipForm() {
  const [mode, setMode] = useState<Mode>("subscribe");
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

  const parsedMembers = useMemo(() => {
    return form.memberNosText.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
  }, [form.memberNosText]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running || parsedMembers.length === 0) {
      if (parsedMembers.length === 0) setError("회원번호 최소 1개 필요");
      return;
    }
    if (mode === "unsubscribe" && (!form.lacmsEmail.trim() || !form.lacmsPassword)) {
      setError("해지: lacms 이메일/패스워드 필요");
      return;
    }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const url = mode === "subscribe" ? "/api/test-data/membership" : "/api/test-data/membership/unsubscribe";
    const body = mode === "subscribe"
      ? {
          memberNosText: form.memberNosText,
          productCd: form.productCd,
          ticketMetaId: form.ticketMetaId,
          benefitOptionId: form.benefitOptionId,
        }
      : {
          memberNosText: form.memberNosText,
          lacmsEmail: form.lacmsEmail.trim(),
          lacmsPassword: form.lacmsPassword,
        };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      {/* 모드 탭 */}
      <div className="card p-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setMode("subscribe"); setSteps([]); setResults([]); setDone(null); setError(null); }}
            disabled={running}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${mode === "subscribe" ? "bg-fuchsia-500 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
          >
            🎫 강제 구독
          </button>
          <button
            type="button"
            onClick={() => { setMode("unsubscribe"); setSteps([]); setResults([]); setDone(null); setError(null); }}
            disabled={running}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${mode === "unsubscribe" ? "bg-rose-500 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
          >
            ✂️ 강제 해지
          </button>
        </div>
      </div>

      {/* 해지 모드 — lacms 인증 */}
      {mode === "unsubscribe" && (
        <fieldset className="card border-l-4 border-l-rose-400 space-y-3 p-5" disabled={running}>
          <legend className="text-sm font-semibold text-neutral-700">⑴ lacms 인증 (해지 API 가 admin JWT 요구)</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="📧 lacms 이메일">
              <input type="email" className="form-input font-mono text-xs" value={form.lacmsEmail} onChange={(e) => update("lacmsEmail", e.target.value)} placeholder="이메일을 입력해주세요" autoComplete="username" />
            </Field>
            <Field label="🔒 패스워드">
              <input type="password" className="form-input font-mono text-xs" value={form.lacmsPassword} onChange={(e) => update("lacmsPassword", e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            </Field>
          </div>
        </fieldset>
      )}

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 회원번호 입력</legend>
        <Field label="회원번호 (memberNo) — 여러 개 입력 가능 *">
          <textarea
            className="form-input font-mono text-xs"
            rows={5}
            value={form.memberNosText}
            onChange={(e) => update("memberNosText", e.target.value)}
            placeholder="25339850&#10;25339851&#10;25339852&#10;(한 줄에 하나 또는 쉼표/공백으로 구분)"
          />
          <Help>
            {parsedMembers.length > 0
              ? <>인식된 회원: <strong>{parsedMembers.length}명</strong> · {parsedMembers.slice(0, 5).join(", ")}{parsedMembers.length > 5 ? " ..." : ""}</>
              : "한 줄에 하나씩 또는 쉼표/공백으로 구분. 최대 100명."}
          </Help>
        </Field>
      </fieldset>

      {mode === "subscribe" && (
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 구독 옵션</legend>
        <Field label="멤버스 이용권 종류 (ticketMetaId)">
          <select className="form-input" value={form.ticketMetaId} onChange={(e) => update("ticketMetaId", Number(e.target.value))}>
            <option value={1}>1. VVIP 6개월 무료이용권</option>
            <option value={2}>2. VIP 6개월 무료이용권</option>
            <option value={3}>3. 1개월 무료이용권</option>
            <option value={4}>4. 2개월 무료이용권</option>
            <option value={5}>5. 3개월 무료이용권</option>
            <option value={6}>6. 4개월 무료이용권</option>
            <option value={7}>7. 5개월 무료이용권</option>
          </select>
          <Help>선택한 개월 수에 맞춰 등록/만료일 자동 계산</Help>
        </Field>
      </fieldset>
      )}

      {mode === "subscribe" && (
      <div className="rounded bg-amber-50 p-2 text-[11px] text-amber-900">
        📅 등록일/만료일 = <strong>이번 달 1일 00:00:00 ~ {(() => { const m = ({1:6,2:6,3:1,4:2,5:3,6:4,7:5} as any)[form.ticketMetaId] ?? 1; return `${m}개월 후 말일 23:59:59`; })()}</strong> 자동 계산
      </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running || parsedMembers.length === 0} className="btn-primary">
          {running ? "처리 중..." : mode === "subscribe" ? `🎫 ${parsedMembers.length}명 구독 시작` : `✂️ ${parsedMembers.length}명 해지 시작`}
        </button>
        {running && <button type="button" onClick={onCancel} className="btn-secondary">⛔ 중단</button>}
        {!running && (steps.length > 0 || results.length > 0) && (
          <button type="button" onClick={onReset} className="btn-secondary">결과 지우기</button>
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
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">회원번호</th>
                  {mode === "subscribe" && <th className="p-2 text-left">ticketId</th>}
                  {mode === "subscribe" && <th className="p-2 text-left">티켓명</th>}
                  {mode === "subscribe" && <th className="p-2 text-left">다음 정산일</th>}
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.memberNo}</td>
                    {mode === "subscribe" && <td className="p-2 font-mono">{r.ticketId ?? "-"}</td>}
                    {mode === "subscribe" && <td className="p-2 text-[11px]">{r.ticketName ?? "-"}</td>}
                    {mode === "subscribe" && <td className="p-2 font-mono text-[10px]">{r.nextSettlementDate?.slice(0, 10) ?? "-"}</td>}
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
