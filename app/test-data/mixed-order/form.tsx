"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STG_OPENAPI_ACCESS_TOKEN, STG_DEFAULT_ADMIN_ID, STG_DEFAULT_ADMIN_PW } from "../_stg-defaults";
import { MIXED_ORDER_3P_TYPES, DELIVERABLE_3P_TYPES } from "@/lib/three-p-types";
import type { ProductType } from "@/lib/test-data-product-3p";

const LS_KEY = "kurly-qa.mixedorder.v2";
const LACMS_EMAIL_KEY = "kurly-qa:lacms:email";

interface MixedStep { type: "phase" | "product"; phase: "PRODUCT" | "ORDER" | "DELIVERED"; label?: string; ok: boolean; message: string; }
interface MixedProduct { group: string; productType?: string; index: number; ok: boolean; partnerProductNo?: string | null; dealProductNo?: number | null; error?: string; }
interface MixedResult {
  products: MixedProduct[];
  order?: { ok: boolean; groupOrderNo?: any; totalPaymentPrice?: number | null; error?: string };
  orderItems?: { dealProductNo: number; quantity: number }[];
  delivered?: boolean; deliveryConfirmed?: boolean; deliveryError?: string; error?: string;
}

interface ThreePRow { productType: ProductType; count: number; }

interface FormState {
  memberNo: string;
  count1p: number;
  threeP: ThreePRow[];
  quantity: number;
  lacmsEmail: string; lacmsPassword: string;
  openapiAccessToken: string; adminId: string; adminPw: string;
  markDelivered3p: boolean;
}

const INITIAL: FormState = {
  memberNo: "",
  count1p: 1,
  threeP: [{ productType: "NORMAL_PARCEL", count: 1 }],
  quantity: 1,
  lacmsEmail: "", lacmsPassword: "",
  openapiAccessToken: STG_OPENAPI_ACCESS_TOKEN, adminId: STG_DEFAULT_ADMIN_ID, adminPw: STG_DEFAULT_ADMIN_PW,
  markDelivered3p: false,
};

const phaseLabel: Record<string, string> = { PRODUCT: "상품", ORDER: "주문", DELIVERED: "배송" };

export default function MixedOrderForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<MixedStep[]>([]);
  const [result, setResult] = useState<MixedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) { const { lacmsPassword, adminPw, ...rest } = JSON.parse(saved); setForm((p) => ({ ...p, ...rest })); }
      const e = localStorage.getItem(LACMS_EMAIL_KEY);
      if (e) setForm((p) => ({ ...p, lacmsEmail: e }));
    } catch {}
  }, []);
  useEffect(() => {
    if (!running) {
      try {
        const { lacmsPassword, adminPw, ...persist } = form;
        localStorage.setItem(LS_KEY, JSON.stringify(persist));
        if (form.lacmsEmail) localStorage.setItem(LACMS_EMAIL_KEY, form.lacmsEmail);
      } catch {}
    }
  }, [form, running]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [steps]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  function updateRow(i: number, patch: Partial<ThreePRow>) {
    setForm((p) => ({ ...p, threeP: p.threeP.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }
  function addRow() {
    setForm((p) => ({ ...p, threeP: [...p.threeP, { productType: "KURLY_PARCEL", count: 1 }] }));
  }
  function removeRow(i: number) {
    setForm((p) => ({ ...p, threeP: p.threeP.filter((_, idx) => idx !== i) }));
  }

  const activeSpecs = useMemo(() => form.threeP.filter((r) => (r.count | 0) > 0), [form.threeP]);
  const total3p = useMemo(() => activeSpecs.reduce((n, r) => n + (r.count | 0), 0), [activeSpecs]);
  const totalProducts = (form.count1p | 0) + total3p;
  const has3p = total3p > 0;
  const deliveryUsable = activeSpecs.length > 0 && activeSpecs.every((r) => DELIVERABLE_3P_TYPES.includes(r.productType));

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.memberNo.trim()) m.push("회원번호");
    if (totalProducts === 0) m.push("상품 개수(합>0)");
    if (!form.lacmsEmail.trim()) m.push("lacms 이메일");
    if (!form.lacmsPassword) m.push("lacms 패스워드");
    if (has3p) {
      if (!form.openapiAccessToken.trim()) m.push("OpenAPI 토큰");
      if (!form.adminId.trim()) m.push("어드민 ID");
      if (!form.adminPw) m.push("어드민 PW");
    }
    return m;
  }, [form, totalProducts, has3p]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length > 0) { setError(`필수값 누락: ${missing.join(", ")}`); return; }
    setRunning(true); setSteps([]); setResult(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/mixed-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberNo: form.memberNo.trim(),
          count1p: form.count1p | 0,
          threeP: activeSpecs.map((r) => ({ productType: r.productType, count: r.count | 0 })),
          quantity: form.quantity | 0 || 1,
          lacmsEmail: form.lacmsEmail.trim(), lacmsPassword: form.lacmsPassword,
          openapiAccessToken: form.openapiAccessToken.trim(), adminId: form.adminId.trim(), adminPw: form.adminPw,
          markDelivered3p: form.markDelivered3p && deliveryUsable,
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
            else if (payload.kind === "done") setResult(payload.result);
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
  function onReset() { setSteps([]); setResult(null); setError(null); }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 회원 + 조합 */}
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 회원 + 상품 조합</legend>
        <Field label="회원번호 (memberNo) — 주문 인증 *">
          <input className="form-input font-mono text-sm" value={form.memberNo} onChange={(e) => update("memberNo", e.target.value)} placeholder="25340148" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="1P 개수">
            <input type="number" min={0} max={10} className="form-input text-center" value={form.count1p} onChange={(e) => update("count1p", Number(e.target.value))} />
          </Field>
          <Field label="상품당 주문 수량">
            <input type="number" min={1} max={100} className="form-input text-center" value={form.quantity} onChange={(e) => update("quantity", Number(e.target.value))} />
          </Field>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">3P 상품 유형별 개수</span>
            <button type="button" onClick={addRow} className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200">+ 유형 추가</button>
          </div>
          <div className="space-y-2">
            {form.threeP.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className="form-input flex-1 text-sm" value={row.productType} onChange={(e) => updateRow(i, { productType: e.target.value as ProductType })}>
                  {MIXED_ORDER_3P_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                </select>
                <input type="number" min={0} max={10} className="form-input w-20 text-center" value={row.count} onChange={(e) => updateRow(i, { count: Number(e.target.value) })} />
                <button type="button" onClick={() => removeRow(i)} disabled={form.threeP.length <= 1} className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-red-500 disabled:opacity-30">✕</button>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">유형은 3P 상품 등록과 동일. 비물류 유형(숙박·항공·티켓)은 주문서 진입이 안 될 수 있어요.</p>
        </div>

        <div className="rounded bg-rose-50 p-2 text-[11px] text-rose-900">
          총 <strong>{totalProducts}</strong>종 (1P {form.count1p | 0} + 3P {total3p}) → <strong>한 주문</strong>으로 묶음
        </div>
      </fieldset>

      {/* 인증 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 인증</legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="📧 La-CMS 이메일 (공통 필수)">
            <input type="email" className="form-input font-mono text-xs" value={form.lacmsEmail} onChange={(e) => update("lacmsEmail", e.target.value)} placeholder="이메일을 입력해주세요" autoComplete="username" />
          </Field>
          <Field label="🔒 La-CMS 패스워드 (공통 필수)">
            <input type="password" className="form-input font-mono text-xs" value={form.lacmsPassword} onChange={(e) => update("lacmsPassword", e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </Field>
        </div>
        {has3p && (
          <div className="space-y-3 rounded-lg border-l-4 border-l-violet-300 bg-violet-50/40 p-3">
            <p className="text-[11px] text-violet-800">3P 포함 — OpenAPI + 어드민 인증 추가 필요</p>
            <Field label="OpenAPI accessToken">
              <input className="form-input font-mono text-[10px]" value={form.openapiAccessToken} onChange={(e) => update("openapiAccessToken", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="어드민 ID">
                <input className="form-input" value={form.adminId} onChange={(e) => update("adminId", e.target.value)} placeholder="admin3" />
              </Field>
              <Field label="어드민 PW">
                <input type="password" readOnly tabIndex={-1} title="STG 고정값 — 수정 불가" className="form-input bg-neutral-100 cursor-not-allowed text-neutral-500" value={form.adminPw} />
              </Field>
            </div>
          </div>
        )}
      </fieldset>

      {/* 배송완료 */}
      <fieldset className="card space-y-2 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">③ 배송완료 (선택)</legend>
        <label className={`flex items-center gap-2 text-sm ${deliveryUsable ? "" : "text-neutral-400"}`}>
          <input type="checkbox" checked={form.markDelivered3p && deliveryUsable} disabled={!deliveryUsable} onChange={(e) => update("markDelivered3p", e.target.checked)} />
          🚚 주문 직후 배송완료까지 자동 처리 (발주확인→발송처리→배송완료)
        </label>
        <p className="text-[11px] text-neutral-500">
          {deliveryUsable
            ? "3P가 전부 일반(택배)일 때 적용됩니다."
            : "⚠ 발송처리는 일반(택배) 배치라, 3P에 일반(택배) 외 유형이 섞이면 비활성화됩니다."}
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running || missing.length > 0} className="btn-primary">
          {running ? "처리 중..." : `🧩 혼합 주문 생성 (${totalProducts}종)`}
        </button>
        {running && <button type="button" onClick={onCancel} className="btn-secondary">⛔ 중단</button>}
        {!running && (steps.length > 0 || result) && <button type="button" onClick={onReset} className="btn-secondary">결과 지우기</button>}
        {missing.length > 0 && <span className="text-[11px] text-amber-600">필수값: {missing.join(", ")}</span>}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}

      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">진행</div>
          <div ref={logRef} className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
            {steps.map((s, i) => (
              <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>
                {s.ok ? "✅" : "❌"} <span className="text-neutral-400">[{phaseLabel[s.phase]}]</span> {s.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className="card space-y-4 p-4">
          <div className="text-sm">
            {result.error ? (
              <span className="text-red-600">⚠ {result.error}</span>
            ) : result.order?.ok ? (
              <span className="text-green-700 font-semibold">✅ 단일 주문 생성 — groupOrderNo <span className="font-mono">{String(result.order.groupOrderNo)}</span> · 상품 {result.orderItems?.length ?? 0}종{result.order.totalPaymentPrice != null ? ` · 결제 ${result.order.totalPaymentPrice}원` : ""}</span>
            ) : (
              <span className="text-amber-600">주문 실패: {result.order?.error ?? "—"}</span>
            )}
            {result.delivered != null && (
              <span className="ml-2 text-xs text-neutral-500">
                · 배송완료 {result.delivered ? (result.deliveryConfirmed === true ? "✅ DB확인" : "✅ 발행") : `❌ ${result.deliveryError ?? ""}`}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="p-2 text-left">유형</th>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">partnerProductNo</th>
                  <th className="p-2 text-left">dealProductNo</th>
                  <th className="p-2 text-left">상태</th>
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {result.products.map((p, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="p-2 font-medium">{p.group}</td>
                    <td className="p-2">{p.index}</td>
                    <td className="p-2 font-mono text-[10px]">{p.partnerProductNo ?? "-"}</td>
                    <td className="p-2 font-mono">{p.dealProductNo ?? "-"}</td>
                    <td className="p-2">{p.ok ? "✅" : "❌"}</td>
                    <td className="p-2 text-red-600 max-w-[280px] truncate" title={p.error ?? ""}>{p.error ?? ""}</td>
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
