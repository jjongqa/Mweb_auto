"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.vip.v1";

interface StepEvent { type: "member"; index: number; ok: boolean; message: string; }
interface Result {
  index: number; memberNo: number | string; ok: boolean;
  action?: "inserted" | "updated"; id?: number | null; error?: string;
}

type Tier = "VIP" | "VVIP";

interface FormState {
  memberNosText: string;
  tier: Tier;
  startedAt: string;   // YYYY-MM-DD
  expiredAt: string;   // YYYY-MM-DD
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function endOfYearStr(): string {
  return `${new Date().getFullYear()}-12-31`;
}

const INITIAL: FormState = {
  memberNosText: "",
  tier: "VVIP",
  startedAt: todayStr(),
  expiredAt: endOfYearStr(),
};

export default function VipForm() {
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
      if (saved) setForm((p) => ({ ...p, ...JSON.parse(saved) }));
    } catch {}
  }, []);
  useEffect(() => {
    if (!running) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch {}
    }
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
    if (!form.startedAt || !form.expiredAt) { setError("시작일/만료일 필요"); return; }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/vip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberNosText: form.memberNosText,
          tier: form.tier,
          startedAt: form.startedAt,
          expiredAt: form.expiredAt,
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
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 회원번호 입력</legend>
        <Field label="회원번호 (member_no) — 여러 개 입력 가능 *">
          <textarea
            className="form-input font-mono text-xs"
            rows={5}
            value={form.memberNosText}
            onChange={(e) => update("memberNosText", e.target.value)}
            placeholder="25340148&#10;25340149&#10;25340150&#10;(한 줄에 하나 또는 쉼표/공백으로 구분)"
          />
          <Help>
            {parsedMembers.length > 0
              ? <>인식된 회원: <strong>{parsedMembers.length}명</strong> · {parsedMembers.slice(0, 5).join(", ")}{parsedMembers.length > 5 ? " ..." : ""}</>
              : "한 줄에 하나씩 또는 쉼표/공백으로 구분. 최대 100명."}
          </Help>
        </Field>
      </fieldset>

      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 등급 / 유효기간</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="등급 (name)">
            <select className="form-input" value={form.tier} onChange={(e) => update("tier", e.target.value as Tier)}>
              <option value="VVIP">VVIP</option>
              <option value="VIP">VIP</option>
            </select>
          </Field>
          <Field label="시작일 (started_at)">
            <input type="date" className="form-input font-mono text-xs" value={form.startedAt} onChange={(e) => update("startedAt", e.target.value)} />
            <Help>00:00:00 으로 적용</Help>
          </Field>
          <Field label="만료일 (expired_at)">
            <input type="date" className="form-input font-mono text-xs" value={form.expiredAt} onChange={(e) => update("expiredAt", e.target.value)} />
            <Help>23:59:59 으로 적용</Help>
          </Field>
        </div>
        <div className="rounded bg-amber-50 p-2 text-[11px] text-amber-900">
          ⚠️ 같은 회원번호가 이미 있으면 <strong>기존 행을 갱신</strong>합니다 (중복 추가 안 함).
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running || parsedMembers.length === 0} className="btn-primary">
          {running ? "처리 중..." : `👑 ${parsedMembers.length}명 ${form.tier} 세팅`}
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
                  <th className="p-2 text-left">처리</th>
                  <th className="p-2 text-left">id</th>
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.memberNo}</td>
                    <td className="p-2 text-[11px]">{r.action === "updated" ? "갱신" : r.action === "inserted" ? "추가" : "-"}</td>
                    <td className="p-2 font-mono">{r.id ?? "-"}</td>
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
