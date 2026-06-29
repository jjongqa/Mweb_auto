"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STG_OPENAPI_ACCESS_TOKEN, STG_DEFAULT_ADMIN_ID, STG_DEFAULT_ADMIN_PW } from "@/app/test-data/_stg-defaults";

const LS_KEY = "kurly-qa.fullscenario.v1";
const LACMS_EMAIL_KEY = "kurly-qa:lacms:email";

type Flavor = "1P" | "3P";
type ProductType3p = "NORMAL_PARCEL" | "KURLY_PARCEL" | "INSTALLATION_DELIVERY";  // 자주 쓰는 3종만 노출 (필요 시 확장)

interface StepEvent { type: "phase" | "product" | "step"; phase?: string; step?: string; productIndex?: number; ok: boolean; message: string; }
interface Result {
  index: number; orderSeq?: number; productOk: boolean;
  masterCode?: string | null; contentsNo?: any; partnerProductNo?: string | null;
  dealProductNo?: any; contentsRawData?: any; productError?: string;
  orderOk?: boolean; groupOrderNo?: any; paymentToken?: any; orderRawResponse?: any; orderError?: string;
  delivered?: boolean; deliveryConfirmed?: boolean; deliveryError?: string;
}

interface FormState {
  flavor: Flavor;
  // 주문 인증 — 게이트웨이 X-KURLY-MEMBER-NO (쿠키리스). 기본 배송지 자동 조회.
  memberNo: string;
  // 1P
  lacmsEmail: string;
  lacmsPassword: string;
  basePrice: number;
  stockQuantity: number;
  // 3P
  openapiAccessToken: string;
  adminId: string;
  adminPw: string;
  productType3p: ProductType3p;
  markDelivered: boolean;   // 주문 직후 배송완료까지 자동 처리 (1P/3P 공통)
  // 공통
  count: number;
  namePrefix: string;
  // 주문
  paymentGatewayId: string;
  usingFreePoint: number;
  quantity: number;
  ordersPerProduct: number;   // 같은 상품 N회 주문
  receiverName: string;
  receiverPhoneNumber: string;
  address: string;
  addressDetail: string;
  zipCode: string;
  memo: string;
}

const INITIAL: FormState = {
  flavor: "1P",
  memberNo: "",
  lacmsEmail: "",
  lacmsPassword: "",
  basePrice: 5000,
  stockQuantity: 10000,
  openapiAccessToken: STG_OPENAPI_ACCESS_TOKEN,
  adminId: STG_DEFAULT_ADMIN_ID,
  adminPw: STG_DEFAULT_ADMIN_PW,
  productType3p: "NORMAL_PARCEL",
  markDelivered: false,
  count: 1,
  namePrefix: "QA풀체인",
  paymentGatewayId: "kurly",
  usingFreePoint: 0,
  quantity: 1,
  ordersPerProduct: 1,
  // 아래 배송지/수령자는 비워두면 회원 기본배송지에서 자동 조회 (센터코드 포함). 직접 입력 시 덮어씀.
  receiverName: "",
  receiverPhoneNumber: "",
  address: "",
  addressDetail: "",
  zipCode: "",
  memo: "",
};

export default function FullScenarioForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState<{ productOk: number; orderOk: number; deliveredOk?: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const { lacmsPassword, adminPw, ...rest } = JSON.parse(saved);
        setForm((p) => ({ ...p, ...rest }));
      }
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

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!form.memberNo.trim()) m.push("회원번호(memberNo)");
    if (form.flavor === "1P") {
      if (!form.lacmsEmail.trim()) m.push("lacms 이메일");
      if (!form.lacmsPassword) m.push("lacms 패스워드");
    } else {
      if (!form.openapiAccessToken.trim()) m.push("OpenAPI 토큰");
      if (!form.adminId.trim()) m.push("어드민 ID");
      if (!form.adminPw) m.push("어드민 PW");
      // 3P 도 lacms 필수 — 전시/재고 단계가 안 돌면 dealProductNo 매핑 안 됨
      if (!form.lacmsEmail.trim()) m.push("lacms 이메일 (3P 전시/재고용)");
      if (!form.lacmsPassword) m.push("lacms 패스워드 (3P 전시/재고용)");
    }
    return m;
  }, [form]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (missing.length > 0) {
      setError(`누락: ${missing.join(", ")}`);
      return;
    }
    setRunning(true); setSteps([]); setResults([]); setDone(null); setError(null);
    const workingForm = form;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/full-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workingForm),
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
              setDone({ productOk: payload.productOkCount, orderOk: payload.orderOkCount, deliveredOk: payload.deliveredOkCount, total: payload.total });
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

  const multiOrder = results.some((r) => (r.orderSeq ?? 1) > 1);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 상품 종류 선택 */}
      <fieldset className="card p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">① 상품 종류</legend>
        <div className="mt-2 flex gap-3">
          <label className={`flex-1 rounded-lg border-2 p-4 cursor-pointer ${form.flavor === "1P" ? "border-emerald-400 bg-emerald-50" : "border-neutral-200"}`}>
            <input type="radio" name="flavor" value="1P" checked={form.flavor === "1P"} onChange={() => update("flavor", "1P")} className="mr-2" />
            <span className="font-semibold">🏬 1P (Kurly 직매입)</span>
            <p className="mt-1 text-[11px] text-neutral-500">PMS 마스터 → 콘텐츠 → 재고 (2~3초/건)</p>
          </label>
          <label className={`flex-1 rounded-lg border-2 p-4 cursor-pointer ${form.flavor === "3P" ? "border-violet-400 bg-violet-50" : "border-neutral-200"}`}>
            <input type="radio" name="flavor" value="3P" checked={form.flavor === "3P"} onChange={() => update("flavor", "3P")} className="mr-2" />
            <span className="font-semibold">🤝 3P (파트너)</span>
            <p className="mt-1 text-[11px] text-neutral-500">12단계 체인 + 어드민 승인 + La-CMS (15~20초/건)</p>
          </label>
        </div>
      </fieldset>

      {/* 인증 */}
      <fieldset className="card border-l-4 border-l-emerald-400 space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">② 인증</legend>
        {form.flavor === "1P" ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="📧 lacms 이메일">
                <input type="email" className="form-input font-mono text-xs" value={form.lacmsEmail} onChange={(e) => update("lacmsEmail", e.target.value)} placeholder="이메일을 입력해주세요" />
              </Field>
              <Field label="🔒 lacms 패스워드">
                <input type="password" className="form-input font-mono text-xs" value={form.lacmsPassword} onChange={(e) => update("lacmsPassword", e.target.value)} placeholder="••••••••" />
              </Field>
            </div>
            <label className="flex items-start gap-2 rounded-lg border-2 border-emerald-200 bg-emerald-50/60 p-3 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={form.markDelivered} onChange={(e) => update("markDelivered", e.target.checked)} />
              <span className="text-xs text-emerald-900">
                <strong>🚚 주문 후 배송완료까지 자동 처리 (주문완료 → 배송완료)</strong>
                <span className="mt-0.5 block text-[11px] text-emerald-700 leading-relaxed">
                  주문 성공 → Kafka(MSG-OMS-KURLY-BOX-TRACKING) 배송완료 발행. 1P는 발주확인·발송처리 없이 대표주문번호로 바로 완료.
                </span>
              </span>
            </label>
          </>
        ) : (
          <>
            <Field label="OpenAPI access_token">
              <input className="form-input font-mono text-xs" value={form.openapiAccessToken} onChange={(e) => update("openapiAccessToken", e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="어드민 ID">
                <input className="form-input" value={form.adminId} onChange={(e) => update("adminId", e.target.value)} placeholder="admin3" />
              </Field>
              <Field label="어드민 PW">
                <input type="password" readOnly tabIndex={-1} title="STG 고정값 — 수정 불가" className="form-input bg-neutral-100 cursor-not-allowed text-neutral-500" value={form.adminPw} />
              </Field>
            </div>
            {/* 3P 도 lacms 인증 필요 — 재고/전시 단계가 안 돌면 상품이 "전시대기" 상태로 남아 dealProductNo 매핑이 안 됨 → 주문 단계 실패 */}
            <div className="rounded border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-900">
              ⚠ 3P 도 La-CMS 재고/전시까지 가야 deal product 매핑이 생성됩니다. lacms 이메일/패스워드 입력 안 하면 전시대기 상태로 남아 주문 단계가 실패해요.
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="📧 lacms 이메일">
                <input type="email" className="form-input font-mono text-xs" value={form.lacmsEmail} onChange={(e) => update("lacmsEmail", e.target.value)} placeholder="이메일을 입력해주세요" />
              </Field>
              <Field label="🔒 lacms 패스워드">
                <input type="password" className="form-input font-mono text-xs" value={form.lacmsPassword} onChange={(e) => update("lacmsPassword", e.target.value)} placeholder="••••••••" />
              </Field>
            </div>
            <Field label="3P 유형">
              <select className="form-input" value={form.productType3p} onChange={(e) => update("productType3p", e.target.value as ProductType3p)}>
                <option value="NORMAL_PARCEL">일반(택배)</option>
                <option value="KURLY_PARCEL">컬리배송</option>
                <option value="INSTALLATION_DELIVERY">설치배송</option>
              </select>
            </Field>
            <label className="flex items-start gap-2 rounded-lg border-2 border-violet-200 bg-violet-50/60 p-3 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={form.markDelivered} onChange={(e) => update("markDelivered", e.target.checked)} />
              <span className="text-xs text-violet-900">
                <strong>🚚 주문 후 배송완료까지 자동 처리 (발주확인→발송처리→배송완료)</strong>
                <span className="mt-0.5 block text-[11px] text-violet-700 leading-relaxed">
                  주문 성공 → 발주확인(배송준비중) → 발송처리(운송장 자동, 배송중) → 배송완료. OpenAPI 토큰으로 처리.
                  <strong> 일반(택배) 유형만</strong> 발송처리 가능 · 주문완료 직후 전파에 수십초 걸려 대기할 수 있음
                </span>
              </span>
            </label>
          </>
        )}
      </fieldset>

      {/* 주문 인증 — 회원번호 하나 (쿠키리스) */}
      <fieldset className="card border-l-4 border-l-rose-400 space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">③ 주문 회원번호 (memberNo)</legend>
        <div className="rounded bg-emerald-50 p-2 text-[11px] text-emerald-900">
          ✅ 회원번호만 입력하면 됩니다. <strong>기본 배송지·센터코드는 자동 조회</strong>되고, 적립금으로 결제합니다.
          쿠키 복사·로그인 불필요 (내부 게이트웨이 <code>X-KURLY-MEMBER-NO</code> 인증).
        </div>
        <Field label="🆔 회원번호 — 필수">
          <input type="text" inputMode="numeric" className="form-input font-mono" value={form.memberNo} onChange={(e) => update("memberNo", e.target.value.trim())} placeholder="예: 25340400" />
          <Help>이 회원으로 주문이 생성됩니다. 적립금이 결제예정금액(상품+배송)보다 충분해야 통과.</Help>
        </Field>
      </fieldset>

      {/* 상품 옵션 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">④ 상품 옵션</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="생성 개수">
            <input type="number" min={1} max={20} className="form-input" value={form.count} onChange={(e) => update("count", Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
          </Field>
          {form.flavor === "1P" && (
            <>
              <Field label="기본 가격(원)">
                <input type="number" min={100} step={100} className="form-input" value={form.basePrice} onChange={(e) => update("basePrice", Math.max(100, Number(e.target.value) || 5000))} />
              </Field>
              <Field label="재고 수량">
                <input type="number" min={0} step={100} className="form-input" value={form.stockQuantity} onChange={(e) => update("stockQuantity", Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            </>
          )}
        </div>
        <Field label="상품명 prefix">
          <input className="form-input" value={form.namePrefix} onChange={(e) => update("namePrefix", e.target.value)} />
        </Field>
      </fieldset>

      {/* 주문 옵션 */}
      <fieldset className="card space-y-3 p-5" disabled={running}>
        <legend className="text-sm font-semibold text-neutral-700">⑤ 주문 결제 + 배송지</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="결제 수단 (paymentGatewayId)">
            <input className="form-input font-mono" value={form.paymentGatewayId} onChange={(e) => update("paymentGatewayId", e.target.value)} placeholder="kurly" />
            <Help>기본 "kurly" (적립금 결제)</Help>
          </Field>
          <Field label="수량 (주문당)">
            <input type="number" min={1} max={100} className="form-input" value={form.quantity} onChange={(e) => update("quantity", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="주문 횟수 (상품당)">
            <input type="number" min={1} max={50} className="form-input" value={form.ordersPerProduct} onChange={(e) => update("ordersPerProduct", Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
            <Help>같은 상품을 N회 주문 (1~50). 총 주문 = 상품수 × N</Help>
          </Field>
        </div>
        <div className="rounded bg-emerald-50 p-2 text-[11px] text-emerald-800">
          💰 <strong>적립금 자동 전액 결제</strong> — 주문서 결제예정금액(상품+배송)을 적립금으로 전액 결제합니다. 회원 적립금이 충분해야 통과.
          <br />📍 <strong>배송지·센터코드는 회원 기본배송지에서 자동 조회</strong> — 따로 설정 안 해도 됩니다.
        </div>
        <details className="rounded border border-neutral-200 bg-neutral-50/50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-neutral-700">배송지 직접 지정 (비우면 회원 기본배송지 자동)</summary>
          <p className="mb-2 text-[11px] text-neutral-500">전부 선택 — 비우면 회원 기본배송지(주소·우편번호·수령자·센터코드)를 자동 사용합니다. 다른 곳으로 보낼 때만 입력.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="수령자명"><input className="form-input" value={form.receiverName} onChange={(e) => update("receiverName", e.target.value)} placeholder="(비우면 자동)" /></Field>
            <Field label="핸드폰"><input className="form-input font-mono" value={form.receiverPhoneNumber} onChange={(e) => update("receiverPhoneNumber", e.target.value)} placeholder="(비우면 자동)" /></Field>
            <Field label="우편번호"><input className="form-input font-mono" value={form.zipCode} onChange={(e) => update("zipCode", e.target.value)} placeholder="(비우면 자동)" /></Field>
            <div className="md:col-span-2">
              <Field label="주소"><input className="form-input" value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="(비우면 회원 기본배송지)" /></Field>
            </div>
            <Field label="상세주소"><input className="form-input" value={form.addressDetail} onChange={(e) => update("addressDetail", e.target.value)} placeholder="(비우면 자동)" /></Field>
            <div className="md:col-span-3">
              <Field label="배송 메모"><input className="form-input" value={form.memo} onChange={(e) => update("memo", e.target.value)} placeholder="(선택)" /></Field>
            </div>
          </div>
        </details>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={running} className="btn-primary">
          {running ? "처리 중..." : `🚀 ${form.flavor} 상품 ${form.count}건${form.ordersPerProduct > 1 ? ` × 주문 ${form.ordersPerProduct}회` : ""} → 풀체인`}
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
          <div className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs">
            {steps.map((s, i) => (
              <div key={i} className={s.ok ? (s.type === "phase" ? "font-semibold text-violet-700" : "text-neutral-700") : "text-red-600"}>
                {s.ok ? "✅" : "❌"} {s.type === "phase" ? `[PHASE: ${s.phase}]` : `[#${s.productIndex} / ${s.phase}]`} {s.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-neutral-700">
              상품: <span className="text-violet-600">{done.productOk}</span> / 주문: <span className="text-rose-600">{done.orderOk}</span>
              {form.markDelivered && <> / 배송완료: <span className="text-cyan-600">{done.deliveredOk ?? 0}</span></>}
              {" "}/ 총 <span className="text-neutral-700">{done.total}</span>건
            </div>
            <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-xs text-kurly-500 underline">
              {showRaw ? "raw 숨김" : "raw 응답 보기 (디버깅)"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">상품</th>
                  <th className="p-2 text-left">dealProductNo</th>
                  <th className="p-2 text-left">주문</th>
                  <th className="p-2 text-left">groupOrderNo</th>
                  {form.markDelivered && <th className="p-2 text-left">배송완료</th>}
                  <th className="p-2 text-left">오류</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.index}-${r.orderSeq ?? 1}`} className="border-t border-neutral-100">
                    <td className="p-2">{multiOrder ? `${r.index}-${r.orderSeq ?? 1}` : r.index}</td>
                    <td className="p-2 font-mono text-[11px]">
                      {r.productOk
                        ? (r.masterCode ?? r.partnerProductNo ?? "?")
                        : <span className="text-red-600">FAIL</span>}
                    </td>
                    <td className="p-2 font-mono">{r.dealProductNo ?? <span className="text-amber-600">추출X</span>}</td>
                    <td className="p-2">{r.orderOk === true ? "✅" : r.orderOk === false ? "❌" : "-"}</td>
                    <td className="p-2 font-mono">{r.groupOrderNo ?? "-"}</td>
                    {form.markDelivered && (
                      <td className="p-2" title={r.deliveryConfirmed === false ? "발행 OK · DB 반영 지연 가능(la-cms 확인)" : r.deliveryConfirmed === true ? "DB 배송완료 반영 확인" : ""}>
                        {r.delivered === true
                          ? (r.deliveryConfirmed === true ? "✅ 확인" : r.deliveryConfirmed === false ? "✅ 발행" : "✅")
                          : r.orderOk ? (r.deliveryError ? "❌" : "-") : "-"}
                      </td>
                    )}
                    <td className="p-2 text-red-600 max-w-[300px] truncate" title={r.productError ?? r.orderError ?? r.deliveryError ?? ""}>
                      {r.productError || r.orderError || r.deliveryError || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showRaw && (
            <div className="mt-3 space-y-2">
              {results.slice(0, 1).map((r) => (
                <div key={r.index} className="space-y-2">
                  {r.contentsRawData && (
                    <details open className="rounded bg-neutral-900 p-3">
                      <summary className="cursor-pointer text-xs text-emerald-300">#{r.index} 콘텐츠 생성 응답</summary>
                      <pre className="mt-2 max-h-64 overflow-auto text-[10px] text-emerald-200">
                        {JSON.stringify(r.contentsRawData, null, 2)}
                      </pre>
                    </details>
                  )}
                  {r.orderRawResponse && (
                    <details open className="rounded bg-rose-950 p-3">
                      <summary className="cursor-pointer text-xs text-rose-300">#{r.index} 주문/cart 응답 (실패 진단용)</summary>
                      <pre className="mt-2 max-h-80 overflow-auto text-[10px] text-rose-200">
                        {JSON.stringify(r.orderRawResponse, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 초보자 가이드 */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-600 leading-relaxed">
        <div className="mb-1.5 font-semibold text-neutral-700">💡 처음이세요? 이렇게 쓰면 돼요</div>
        <ol className="ml-4 list-decimal space-y-0.5">
          <li><strong>① 상품 종류</strong> — 1P(컬리 직매입) / 3P(파트너) 선택</li>
          <li><strong>③ 회원번호</strong> — 주문할 회원 번호 입력 (적립금이 결제금액보다 많아야 통과)</li>
          <li><strong>🚀 버튼</strong> — 상품 생성부터 주문까지 자동으로 쭉 진행</li>
        </ol>
        <div className="mt-2 border-t border-neutral-200 pt-2">
          <strong className="text-neutral-700">수량 vs 주문 횟수, 뭐가 달라요?</strong>
          <br />· <strong>수량 (주문당)</strong> = 한 주문에 담는 개수 <span className="text-neutral-400">(예: 한 번에 3개 담기)</span>
          <br />· <strong>주문 횟수 (상품당)</strong> = 결제(주문서)를 몇 번 하는지 <span className="text-neutral-400">(예: 따로 3건 주문)</span>
          <br /><span className="text-neutral-500">→ 주문 <strong>건수</strong>가 여러 개 필요하면 “주문 횟수”를, 한 주문에 <strong>여러 개</strong> 담고 싶으면 “수량”을 올리세요.</span>
        </div>
        <div className="mt-2 border-t border-neutral-200 pt-2 text-neutral-500">
          ☑ <strong className="text-neutral-700">주문 후 배송완료까지 자동 처리</strong>를 켜면 주문 → 배송완료 상태까지 만들어줘요. (배송완료여야 <strong>후기 작성</strong>이 가능)
        </div>
      </div>
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
