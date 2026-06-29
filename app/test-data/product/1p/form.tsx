"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.product1p.v1";
const LACMS_EMAIL_KEY = "kurly-qa:lacms:email";

type StorageType = "AMBIENT_TEMPERATURE" | "COLD" | "FROZEN" | "ETC";

interface StepEvent { type: "step" | "product"; step?: string; productIndex?: number; ok: boolean; message: string; }
interface Result { index: number; masterCode?: string | null; contentsNo?: any; stockOk?: boolean; error?: string; }

interface FormState {
  lacmsEmail: string;
  lacmsPassword: string;
  count: number;
  namePrefix: string;
  basePrice: number;
  storageType: StorageType;
  stockQuantity: number;
  doMaster: boolean;
  doContents: boolean;
  doStock: boolean;
  doDisplay: boolean;
}

const INITIAL: FormState = {
  lacmsEmail: "",
  lacmsPassword: "",
  count: 1,
  namePrefix: "QA자동화상품",
  basePrice: 5000,
  storageType: "AMBIENT_TEMPERATURE",
  stockQuantity: 10000,
  doMaster: true,
  doContents: true,
  doStock: true,
  doDisplay: true,
};

export default function Product1pForm() {
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
        const parsed = JSON.parse(saved);
        const { lacmsPassword, ...rest } = parsed;
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

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.lacmsEmail.trim()) m.push("lacms 이메일");
    if (!form.lacmsPassword) m.push("패스워드");
    return m;
  }, [form]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length > 0) {
      setError(`다음 항목 누락: ${missing.join(", ")}`);
      return;
    }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/product-1p", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
            if (payload.kind === "progress") {
              setSteps((prev) => [...prev, payload.event as StepEvent]);
            } else if (payload.kind === "done") {
              setResults(payload.results ?? []);
              setDone({ okCount: payload.okCount, total: payload.total });
            } else if (payload.kind === "fatal") {
              setError(payload.error);
            }
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

  function downloadCsv() {
    const header = "No,masterProductCode,contentsProductNo,stock,error";
    const rows = results.map((r) =>
      [r.index, r.masterCode ?? "", r.contentsNo ?? "", r.stockOk === true ? "OK" : r.stockOk === false ? "FAIL" : "", (r.error ?? "").replace(/[\r\n,]/g, " ")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    );
    const csv = "﻿" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products_1p_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 인증 */}
      <fieldset className="card border-l-4 border-l-emerald-400 space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① lacms 인증</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="📧 lacms 이메일">
            <input
              type="email"
              className="form-input font-mono text-xs"
              value={form.lacmsEmail}
              onChange={(e) => update("lacmsEmail", e.target.value)}
              placeholder="이메일을 입력해주세요"
              autoComplete="username"
            />
          </Field>
          <Field label="🔒 패스워드">
            <input
              type="password"
              className="form-input font-mono text-xs"
              value={form.lacmsPassword}
              onChange={(e) => update("lacmsPassword", e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
            <Help>저장 안 됨 — 매번 입력</Help>
          </Field>
        </div>
      </fieldset>

      {/* 옵션 */}
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 상품 옵션</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="생성 개수">
            <input
              type="number" min={1} max={50}
              className="form-input"
              value={form.count}
              onChange={(e) => update("count", Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
            <Help>1~50</Help>
          </Field>
          <Field label="기본 가격(원)">
            <input
              type="number" min={100} step={100}
              className="form-input"
              value={form.basePrice}
              onChange={(e) => update("basePrice", Math.max(100, Number(e.target.value) || 5000))}
            />
          </Field>
          <Field label="재고 수량">
            <input
              type="number" min={0} step={100}
              className="form-input"
              value={form.stockQuantity}
              onChange={(e) => update("stockQuantity", Math.max(0, Number(e.target.value) || 0))}
            />
            <Help>9개 센터 동일</Help>
          </Field>
          <Field label="보관 유형">
            <select
              className="form-input"
              value={form.storageType}
              onChange={(e) => update("storageType", e.target.value as StorageType)}
            >
              <option value="AMBIENT_TEMPERATURE">상온</option>
              <option value="COLD">냉장</option>
              <option value="FROZEN">냉동</option>
              <option value="ETC">기타</option>
            </select>
          </Field>
        </div>
        <Field label="상품명 prefix">
          <input
            className="form-input"
            value={form.namePrefix}
            onChange={(e) => update("namePrefix", e.target.value)}
            placeholder="QA자동화상품"
          />
          <Help>{`→ ${form.namePrefix}_마스터001, ${form.namePrefix}_콘텐츠001, ${form.namePrefix}_딜001`}</Help>
        </Field>
      </fieldset>

      {/* 단계 ON/OFF */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">③ 실행 단계</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.doMaster} onChange={(e) => update("doMaster", e.target.checked)} />
            <span>마스터 상품 생성</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.doContents} onChange={(e) => update("doContents", e.target.checked)} />
            <span>콘텐츠 상품 생성</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.doStock} onChange={(e) => update("doStock", e.target.checked)} />
            <span>재고 세팅 (9개 센터)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.doDisplay} onChange={(e) => update("doDisplay", e.target.checked)} />
            <span>La-CMS 전시 일괄 (isShow=true)</span>
          </label>
        </div>
        <Help>마스터 → 콘텐츠 → 재고 → 전시 순서로 실행. 마스터 OFF 면 이하 단계 스킵.</Help>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">
          {running ? "처리 중..." : `🚀 ${form.count}건 생성 시작`}
        </button>
        {running && <button type="button" onClick={onCancel} className="btn-secondary">⛔ 중단</button>}
        {!running && (steps.length > 0 || results.length > 0) && (
          <button type="button" onClick={onReset} className="btn-secondary">결과 지우기</button>
        )}
        {missing.length > 0 && !running && (
          <span className="text-xs text-amber-700">⚠ 누락: {missing.join(", ")}</span>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>
      )}

      {/* 진행 단계 */}
      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">진행 단계</div>
          <div className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {steps.map((s, i) => (
              <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>
                {s.ok ? "✅" : "❌"} {s.type === "product" ? `[#${s.productIndex}]` : `[${s.step}]`} {s.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 결과 */}
      {done && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-neutral-700">
              완료: <span className={done.okCount === done.total ? "text-green-600" : "text-amber-600"}>{done.okCount} / {done.total} 성공</span>
            </div>
            {results.length > 0 && (
              <button type="button" onClick={downloadCsv} className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50">📥 CSV 다운로드</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">masterProductCode</th>
                  <th className="p-2 text-left">contentsProductNo</th>
                  <th className="p-2 text-left">재고</th>
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-t border-neutral-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2 font-mono">{r.masterCode ?? "-"}</td>
                    <td className="p-2 font-mono">{r.contentsNo ?? "-"}</td>
                    <td className="p-2">{r.stockOk === true ? "✅" : r.stockOk === false ? "❌" : "-"}</td>
                    <td className="p-2 text-red-600 max-w-[400px] truncate" title={r.error ?? ""}>{r.error ?? ""}</td>
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
