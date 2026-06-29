"use client";

import { useEffect, useState } from "react";

const LACMS_EMAIL_KEY = "kurly-qa:lacms:email";
const CMS_KEY = "kurly-qa:admin-token:cms-user";

interface DiscountResult {
  ok: boolean;
  status: number;
  total: number;
  successCount: number;
  failCount: number;
  fails: unknown[];
  message?: string;
  raw?: unknown;
}

export function DiscountForm() {
  const [lacmsEmail, setLacmsEmail] = useState("");
  const [lacmsPassword, setLacmsPassword] = useState("");
  const [cmsUser, setCmsUser] = useState("");
  const [dealProductNos, setDealProductNos] = useState("");
  const [centerCodes, setCenterCodes] = useState("CC02");
  const [discountType, setDiscountType] = useState<"PERCENTAGE" | "AMOUNT">("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState(10);
  const [conditionQuantity, setConditionQuantity] = useState(1);
  const [validDays, setValidDays] = useState(30);
  const [discountKind, setDiscountKind] = useState<"STANDARD" | "SINGLE_BUNDLE">("STANDARD");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DiscountResult | null>(null);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    try {
      const e = localStorage.getItem(LACMS_EMAIL_KEY); if (e) setLacmsEmail(e);
      const c = localStorage.getItem(CMS_KEY); if (c) setCmsUser(c);
    } catch {}
  }, []);

  const dealList = dealProductNos.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  const centerList = centerCodes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const minQty = discountKind === "SINGLE_BUNDLE" ? 2 : 1;  // 번들은 묶음이라 2개 이상

  async function submit() {
    setError(""); setResult(null);
    if (!lacmsEmail.trim() || !lacmsPassword) { setError("lacms 이메일/패스워드를 입력하세요"); return; }
    if (dealList.length === 0) { setError("dealProductNo를 1개 이상 입력하세요 (숫자)"); return; }
    if (centerList.length === 0) { setError("센터코드를 1개 이상 입력하세요"); return; }
    if (!discountValue || discountValue <= 0) { setError("할인값을 입력하세요"); return; }
    setRunning(true);
    try {
      localStorage.setItem(LACMS_EMAIL_KEY, lacmsEmail.trim());
      if (cmsUser.trim()) localStorage.setItem(CMS_KEY, cmsUser.trim());
      const res = await fetch("/api/test-data/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lacmsEmail: lacmsEmail.trim(), lacmsPassword, cmsUser: cmsUser.trim() || undefined,
          dealProductNos, centerCodes, discountType, discountValue, conditionQuantity, validDays, discountKind,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || `HTTP ${res.status}`); return; }
      setResult(data as DiscountResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 인증 */}
      <div className="card border-l-4 border-l-amber-400 space-y-3 p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="📧 lacms 이메일">
            <input type="email" className="input font-mono text-xs" value={lacmsEmail} onChange={(e) => setLacmsEmail(e.target.value)} placeholder="jongkwan.ahn@kurlycorp.com" disabled={running} autoComplete="username" />
          </Field>
          <Field label="🔒 패스워드">
            <input type="password" className="input font-mono text-xs" value={lacmsPassword} onChange={(e) => setLacmsPassword(e.target.value)} placeholder="••••••••" disabled={running} autoComplete="current-password" />
            <Help>서버에서 OAuth 로그인 → JWT 자동 발급 (저장 안 됨)</Help>
          </Field>
        </div>
        <details className="rounded border border-neutral-200 bg-neutral-50/50 p-2">
          <summary className="cursor-pointer text-xs font-medium text-neutral-600">고급: X-KURLY-CMS-USER (자동 생성됨 · 보통 비워두세요)</summary>
          <input className="input mt-2 font-mono text-xs" value={cmsUser} onChange={(e) => setCmsUser(e.target.value)} placeholder="비워두면 lacms 이메일로 자동 생성" disabled={running} />
          <p className="mt-1 text-[11px] text-neutral-500">할인 API 필수 헤더라 자동으로 만들어 보냅니다. 그래도 401(cms user 누락)이 나면, 브라우저 lacms 네트워크 탭의 실제 <code>X-KURLY-CMS-USER</code> 값을 그대로 붙여넣으세요.</p>
        </details>
      </div>

      {/* 할인 설정 */}
      <div className="card space-y-3 p-5">
        <Field label="dealProductNo (할인 적용할 딜상품) *">
          <textarea className="input font-mono text-xs" rows={2} value={dealProductNos} onChange={(e) => setDealProductNos(e.target.value)} placeholder="예: 1000739624, 1000739625  (쉼표/줄바꿈 구분)" disabled={running} />
          <Help>상품 생성 결과나 goods 페이지의 딜코드. {dealList.length > 0 && <span className="text-kurly-700">{dealList.length}개 인식</span>}</Help>
        </Field>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="할인 유형">
            <select className="input" value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)} disabled={running}>
              <option value="PERCENTAGE">정률 (%)</option>
              <option value="AMOUNT">정액 (원)</option>
            </select>
          </Field>
          <Field label={discountType === "PERCENTAGE" ? "할인율(%)" : "할인금액(원)"}>
            <input type="number" min={1} max={discountType === "PERCENTAGE" ? 100 : undefined} className="input" value={discountValue}
              onChange={(e) => { const max = discountType === "PERCENTAGE" ? 100 : 100_000_000; setDiscountValue(Math.max(1, Math.min(max, Number(e.target.value) || 1))); }} disabled={running} />
          </Field>
          <Field label="조건 수량 (이상)">
            <input type="number" min={minQty} className="input" value={conditionQuantity} onChange={(e) => setConditionQuantity(Math.max(minQty, Number(e.target.value) || minQty))} disabled={running} />
            <Help>{discountKind === "SINGLE_BUNDLE" ? "번들은 묶음 할인이라 2개 이상 필수" : "N개 이상 구매 시 적용"}</Help>
          </Field>
          <Field label="할인 종류">
            <select className="input" value={discountKind} onChange={(e) => {
              const v = e.target.value as typeof discountKind;
              setDiscountKind(v);
              if (v === "SINGLE_BUNDLE" && conditionQuantity < 2) setConditionQuantity(2);
            }} disabled={running}>
              <option value="STANDARD">STANDARD (일반)</option>
              <option value="SINGLE_BUNDLE">SINGLE_BUNDLE (번들)</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Field label="센터코드 (clusterCenterCode) *">
              <input className="input font-mono" value={centerCodes} onChange={(e) => setCenterCodes(e.target.value)} placeholder="CC02" disabled={running} />
              <Help>할인은 센터별. 회원 기본배송지 센터(예 CC02)에 걸어야 그 회원 주문에 보임. {centerList.length > 1 && <span className="text-kurly-700">{centerList.length}개 센터</span>}</Help>
            </Field>
          </div>
          <Field label="기간 (일)">
            <input type="number" min={1} max={365} className="input" value={validDays} onChange={(e) => setValidDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))} disabled={running} />
            <Help>오늘부터 N일</Help>
          </Field>
        </div>

        <div className="rounded bg-emerald-50 p-2 text-[11px] text-emerald-800">
          🏷️ {dealList.length}개 딜 × {centerList.length}개 센터 = <strong>{dealList.length * centerList.length}건</strong> 할인 등록 예정
          ({discountType === "PERCENTAGE" ? `${discountValue}% 할인` : `${discountValue.toLocaleString()}원 할인`}, {conditionQuantity}개 이상)
        </div>

        <div className="flex items-center gap-2 pt-1">
          {!running ? (
            <button onClick={submit} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">🏷️ 할인 적용</button>
          ) : (
            <button disabled className="rounded-md bg-neutral-300 px-4 py-2 text-sm font-medium text-white">적용 중...</button>
          )}
        </div>
        {error && <div className="rounded border-l-4 border-rose-400 bg-rose-50 p-2 text-xs text-rose-800">⚠ {error}</div>}
      </div>

      {result && (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              {result.ok ? <span className="text-emerald-600">✅ 적용 완료</span> : <span className="text-amber-600">⚠ 일부/전체 실패</span>}
              <span className="ml-2 text-neutral-600">성공 {result.successCount} / {result.total} · 실패 {result.failCount}</span>
              <span className="ml-2 text-[11px] text-neutral-400">HTTP {result.status}</span>
            </div>
            <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-xs text-kurly-500 underline">{showRaw ? "raw 숨김" : "raw 보기"}</button>
          </div>
          {result.message && <div className="mt-1 text-xs text-neutral-600">{result.message}</div>}
          {result.failCount > 0 && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-rose-950 p-2 text-[10px] text-rose-200">{JSON.stringify(result.fails, null, 2)}</pre>
          )}
          {showRaw && (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-900 p-2 text-[10px] text-emerald-200">{JSON.stringify(result.raw, null, 2)}</pre>
          )}
          {result.ok && (
            <p className="mt-2 text-[11px] text-emerald-700">이제 그 회원(센터 일치)으로 주문하면 할인가가 적용돼요.</p>
          )}
        </div>
      )}
    </div>
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
