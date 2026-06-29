"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// STG 토큰/admin id 는 _stg-defaults 한 곳에서 관리 (order 폼과 공유, drift 방지)
import { STG_OPENAPI_ACCESS_TOKEN as STG_DEFAULT_ACCESS_TOKEN, STG_DEFAULT_ADMIN_ID, STG_DEFAULT_ADMIN_PW } from "@/app/test-data/_stg-defaults";

const LS_KEY = "kurly-qa.product3p.v1";
const DEFAULT_OPENAPI_BASE = "https://third-party-external-api.stg.kurly.com";
const DEFAULT_ADMIN_HOST = "https://third-party-partner-gateway.stg.kurly.com";
const DEFAULT_CMS_HOST = "https://gateway.cloud.stg.kurly.services";

type ProductType = "NORMAL_PARCEL" | "KURLY_PARCEL" | "KURLY_PARCEL_LIQUOR" | "INSTALLATION_DELIVERY" | "GOURMET_DELIVERY" | "QUICK_DELIVERY" | "ACCOMMODATION" | "AIRLINE_TICKET" | "ONLINE_TICKET" | "SELF_PICKUP_WINE";

interface StepEvent { type: "step" | "product" | "phase"; step?: string; productIndex?: number; ok: boolean; message: string; }
interface ProductResult { index: number; productId?: any; partnerProductNo?: string | null; reviewApprovalId?: any; approved: boolean; actualDivisionType?: string | null; actualDeliveryType?: string | null; error?: string; }

interface FormState {
  openapiBase: string;
  adminHost: string;
  cmsHost: string;
  accessToken: string;
  adminId: string;
  adminPw: string;
  cmsUsername: string;
  cmsPassword: string;
  productType: ProductType;
  count: number;
  includeLacms: boolean;
  doStock: boolean;
  doDisplay: boolean;
}

const INITIAL: FormState = {
  openapiBase: DEFAULT_OPENAPI_BASE,
  adminHost: DEFAULT_ADMIN_HOST,
  cmsHost: DEFAULT_CMS_HOST,
  accessToken: STG_DEFAULT_ACCESS_TOKEN,
  adminId: STG_DEFAULT_ADMIN_ID,
  adminPw: STG_DEFAULT_ADMIN_PW,
  cmsUsername: "",
  cmsPassword: "",
  productType: "NORMAL_PARCEL",
  count: 1,
  includeLacms: true,
  doStock: true,
  doDisplay: true,
};

export default function Product3pForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [results, setResults] = useState<ProductResult[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number; lacmsOk: boolean; lacmsError?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stepsRef = useRef<HTMLDivElement>(null);

  // 새 step 추가 시 자동 스크롤 (account form 과 동일 패턴)
  useEffect(() => {
    if (stepsRef.current) stepsRef.current.scrollTop = stepsRef.current.scrollHeight;
  }, [steps]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (!saved) return;
      // 저장된 옛 adminPw(빈 값 등)는 무시 — 번들 고정 기본값 STG_DEFAULT_ADMIN_PW 유지
      const { adminPw: _pw, ...parsed } = JSON.parse(saved);
      setForm((prev) => ({ ...prev, ...parsed }));
    } catch {}
  }, []);

  useEffect(() => {
    if (!running) {
      // adminPw 는 번들 고정 기본값(STG_DEFAULT_ADMIN_PW) — localStorage 에 저장 안 함
      // (과거 빈 값/구버전이 기본값을 덮어쓰지 않게)
      try { const { adminPw: _pw, ...persist } = form; localStorage.setItem(LS_KEY, JSON.stringify(persist)); } catch {}
    }
  }, [form, running]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.accessToken.trim()) m.push("OpenAPI access_token");
    if (!form.adminId.trim()) m.push("어드민 ID");
    if (!form.adminPw.trim()) m.push("어드민 PW");
    if (form.includeLacms) {
      if (!form.cmsUsername.trim()) m.push("La-CMS Username");
      if (!form.cmsPassword.trim()) m.push("La-CMS Password");
    }
    return m;
  }, [form]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length > 0) {
      setError(`다음 항목이 비어 있습니다: ${missing.join(", ")}`);
      return;
    }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/product-3p", {
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
              const ev: StepEvent = payload.event;
              setSteps((prev) => [...prev, ev]);
            } else if (payload.kind === "done") {
              setResults(payload.results ?? []);
              setDone({ okCount: payload.okCount, total: payload.total, lacmsOk: payload.lacmsOk, lacmsError: payload.lacmsError });
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

  function onCancel() {
    abortRef.current?.abort();
  }

  function onReset() {
    setSteps([]); setResults([]); setDone(null); setError(null);
  }

  function downloadCsv() {
    const header = "No,partnerProductNo,reviewApprovalId,actualDivisionType,actualDeliveryType,approved,error";
    const rows = results.map((r) =>
      [r.index, r.partnerProductNo ?? "", r.reviewApprovalId ?? "", r.actualDivisionType ?? "", r.actualDeliveryType ?? "", r.approved ? "OK" : "FAIL", (r.error ?? "").replace(/[\r\n,]/g, " ")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    );
    const csv = "﻿" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products_3p_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 옵션 */}
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 등록 옵션</legend>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="상품 유형">
            <select className="form-input" value={form.productType} onChange={(e) => update("productType", e.target.value as ProductType)}>
              <option value="NORMAL_PARCEL">일반(택배)</option>
              <option value="KURLY_PARCEL">컬리배송(샛별)</option>
              <option value="KURLY_PARCEL_LIQUOR">컬리배송(주류)</option>
              <option value="INSTALLATION_DELIVERY">설치배송</option>
              <option value="GOURMET_DELIVERY">미식딜리버리</option>
              <option value="QUICK_DELIVERY">퀵배송</option>
              <option value="ACCOMMODATION">숙박</option>
              <option value="AIRLINE_TICKET">항공권</option>
              <option value="ONLINE_TICKET">온라인 티켓</option>
              <option value="SELF_PICKUP_WINE">셀프픽업 (와인)</option>
            </select>
            <Help>택배: 출고지+반품지+배송사 / 설치·미식·퀵: 출고지+반품지 / 그 외: 사전조회 없음</Help>
          </Field>
          <Field label="생성 개수">
            <input
              type="number"
              className="form-input"
              min={1}
              max={50}
              value={form.count}
              onChange={(e) => update("count", Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
            <Help>1~50건 (단계별 의존성으로 직렬 처리)</Help>
          </Field>
          <Field label="예상 소요">
            <div className="form-input bg-neutral-50 text-neutral-700">
              ≈ {Math.round(form.count * (form.productType === "KURLY_PARCEL" ? 15 : 18))}초
            </div>
            <Help>1건당 평균 15~18초 (폴링 포함)</Help>
          </Field>
        </div>
      </fieldset>

      {/* 인증 */}
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 인증 정보</legend>

        <div className="space-y-3">
          <Field label="OpenAPI access_token (Bearer)">
            <input
              className="form-input font-mono text-xs"
              value={form.accessToken}
              onChange={(e) => update("accessToken", e.target.value)}
              placeholder="d350caad..."
            />
            <Help>stg PARTNER access_token. (기본값 = stg 캡쳐값)</Help>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="어드민 ID">
            <input className="form-input" value={form.adminId} onChange={(e) => update("adminId", e.target.value)} placeholder="admin3" />
          </Field>
          <Field label="어드민 PW">
            <input type="password" readOnly tabIndex={-1} title="STG 고정값 — 수정 불가" className="form-input bg-neutral-100 cursor-not-allowed text-neutral-500" value={form.adminPw} />
          </Field>
        </div>

        <details className="rounded border border-neutral-200 bg-neutral-50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-neutral-700">호스트 변경 (기본값 stg)</summary>
          <div className="mt-3 space-y-2">
            <Field label="OpenAPI Base">
              <input className="form-input font-mono text-xs" value={form.openapiBase} onChange={(e) => update("openapiBase", e.target.value)} />
            </Field>
            <Field label="어드민 Host">
              <input className="form-input font-mono text-xs" value={form.adminHost} onChange={(e) => update("adminHost", e.target.value)} />
            </Field>
            <Field label="La-CMS Host">
              <input className="form-input font-mono text-xs" value={form.cmsHost} onChange={(e) => update("cmsHost", e.target.value)} />
            </Field>
          </div>
        </details>
      </fieldset>

      {/* La-CMS */}
      <fieldset className="card space-y-4 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">③ La-CMS 전시/재고 (선택)</legend>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.includeLacms} onChange={(e) => update("includeLacms", e.target.checked)} />
          <span>La-CMS 단계 포함 (마지막에 1회 일괄 처리)</span>
        </label>

        {form.includeLacms && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="La-CMS Username">
                <input className="form-input" value={form.cmsUsername} onChange={(e) => update("cmsUsername", e.target.value)} placeholder="이메일을 입력해주세요" />
              </Field>
              <Field label="La-CMS Password">
                <input type="password" className="form-input" value={form.cmsPassword} onChange={(e) => update("cmsPassword", e.target.value)} placeholder="•••••••" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.doStock} onChange={(e) => update("doStock", e.target.checked)} />
                <span>재고 일괄 (quantity=100)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.doDisplay} onChange={(e) => update("doDisplay", e.target.checked)} />
                <span>전시 일괄 (isShow=true)</span>
              </label>
            </div>
            <Help>재고 → 전시 순서 (재고 0이면 전시 반영 안됨)</Help>
          </>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">
          {running ? "처리 중..." : `🚀 ${form.count}건 등록 시작`}
        </button>
        {running && (
          <button type="button" onClick={onCancel} className="btn-secondary">⛔ 중단</button>
        )}
        {!running && (steps.length > 0 || results.length > 0) && (
          <button type="button" onClick={onReset} className="btn-secondary">결과 지우기</button>
        )}
        {missing.length > 0 && !running && (
          <span className="text-xs text-amber-700">
            ⚠ 누락: {missing.join(", ")}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>
      )}

      {/* 진행 단계 */}
      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">진행 단계</div>
          <div ref={stepsRef} className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
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
              {form.includeLacms && (
                <span className="ml-3 text-xs text-neutral-500">
                  · La-CMS {done.lacmsOk ? "✅" : `❌ ${done.lacmsError ?? ""}`}
                </span>
              )}
            </div>
            {results.length > 0 && (
              <button type="button" onClick={downloadCsv} className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50">📥 CSV 다운로드</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">partnerProductNo</th><th className="p-2 text-left">reviewApprovalId</th><th className="p-2 text-left">실제 유형</th><th className="p-2 text-left">상태</th><th className="p-2 text-left">오류</th></tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const mismatch = r.actualDivisionType && r.actualDivisionType !== form.productType;
                  return (
                    <tr key={r.index} className="border-t border-neutral-100">
                      <td className="p-2">{r.index}</td>
                      <td className="p-2 font-mono">{r.partnerProductNo ?? "-"}</td>
                      <td className="p-2 font-mono">{r.reviewApprovalId ?? "-"}</td>
                      <td className={`p-2 font-mono text-[11px] ${mismatch ? "text-amber-700" : ""}`}>
                        {r.actualDivisionType ?? "-"}
                        {mismatch && <span className="ml-1 text-amber-700">⚠</span>}
                      </td>
                      <td className="p-2">{r.approved ? "✅ 승인" : "❌"}</td>
                      <td className="p-2 text-red-600">{r.error ?? ""}</td>
                    </tr>
                  );
                })}
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
