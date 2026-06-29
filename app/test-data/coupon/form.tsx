"use client";

import { useEffect, useRef, useState } from "react";

type Result = {
  index: number;
  publishName: string;
  couponName: string;
  ok: boolean;
  status?: number;
  coupon_publish_id?: number | string | null;
  error?: string;
  issued?: boolean;
  issuedCount?: number | null;
  issueError?: string;
  keyword?: string;
  activated?: boolean;
};

const JWT_KEY = "kurly-qa:admin-token:jwt";
const CMS_KEY = "kurly-qa:admin-token:cms-user";
const LACMS_EMAIL_KEY = "kurly-qa:lacms:email";

export function CouponCreateForm({
  onPublished,
  onSendToPack,
}: {
  onPublished?: (ids: (number | string)[]) => void;
  onSendToPack?: (ids: (number | string)[]) => void;
} = {}) {
  const [lacmsEmail, setLacmsEmail] = useState("");
  const [lacmsPassword, setLacmsPassword] = useState("");
  const [jwtToken, setJwtToken] = useState("");
  const [cmsUser, setCmsUser] = useState("");
  const [count, setCount] = useState(5);
  const [namePrefix, setNamePrefix] = useState("QA쿠폰");
  const [couponType, setCouponType] = useState<"CART" | "FREE_SHIPPING">("CART");
  const [issueType, setIssueType] = useState<"ADMIN" | "DOWNLOAD">("DOWNLOAD");
  const [benefitType, setBenefitType] = useState<"PRICE_DISCOUNT" | "PERCENT_DISCOUNT">("PRICE_DISCOUNT");
  const [benefitValue, setBenefitValue] = useState(1000);
  const [maxDiscountPrice, setMaxDiscountPrice] = useState(5000);
  const [validDays, setValidDays] = useState(7);
  const [concurrency, setConcurrency] = useState(5);
  const [issueMemberNos, setIssueMemberNos] = useState("");  // 발급 대상 회원번호 (쉼표/줄바꿈 구분)

  // 노출 / 사용조건 / 발급조건 (이예지[프로모션] 요청)
  const [exposed, setExposed] = useState(false);
  const [exposeImageUrl, setExposeImageUrl] = useState("coupon/thumbs/coupon1.png");
  const [exposeKeyword, setExposeKeyword] = useState("");
  const [minOrderAmount, setMinOrderAmount] = useState(0);
  const [minOrderQty, setMinOrderQty] = useState(1);
  const [onlyApp, setOnlyApp] = useState(false);
  const [allowDiscounted, setAllowDiscounted] = useState(true);
  const [memberMaxIssue, setMemberMaxIssue] = useState(1);
  const [allowBizMember, setAllowBizMember] = useState(false);
  const [vipScope, setVipScope] = useState<"ALL" | "VIP_VVIP" | "VIP" | "VVIP">("ALL");
  const [membersOnly, setMembersOnly] = useState(false);
  // 주문조건 대상 + 발급방법
  const [hurdleTarget, setHurdleTarget] = useState<"ALL" | "COLLECTION" | "CATEGORY" | "PRODUCT" | "SAME">("ALL");
  const [hurdleCodes, setHurdleCodes] = useState("");
  const [downloadType, setDownloadType] = useState<"ACCESS_KEY" | "KEYWORD" | "RANDOM_CODE">("ACCESS_KEY");
  const [randomCodeQty, setRandomCodeQty] = useState(100);
  const effDownloadType = exposed ? "KEYWORD" : downloadType; // 노출이면 키워드 강제

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [activating, setActivating] = useState(false);
  const [activateMsg, setActivateMsg] = useState("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      // JWT 는 옛 값이 만료되어 401 일으키니 저장 안 함 — 매번 OAuth 새로 발급
      localStorage.removeItem(JWT_KEY);
      const c = localStorage.getItem(CMS_KEY); if (c) setCmsUser(c);
      const e = localStorage.getItem(LACMS_EMAIL_KEY); if (e) setLacmsEmail(e);
    } catch {}
  }, []);
  function saveTokens() {
    try {
      // JWT 는 저장 안 함 (만료 위험)
      localStorage.setItem(CMS_KEY, cmsUser.trim());
      localStorage.setItem(LACMS_EMAIL_KEY, lacmsEmail.trim());
    } catch {}
  }

  async function submit() {
    setError("");
    const useAutoLogin = lacmsEmail.trim() && lacmsPassword.trim();
    if (!useAutoLogin && !jwtToken.trim()) { setError("lacms 이메일/패스워드 또는 JWT 토큰 입력 필요"); return; }
    saveTokens();
    setResults([]);
    setProgress({ done: 0, total: count });
    setRunning(true);
    setElapsedMs(null);
    const startTs = Date.now();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/test-data/coupon-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lacmsEmail: lacmsEmail.trim() || undefined,
          lacmsPassword: lacmsPassword || undefined,
          jwtToken: jwtToken.trim() || undefined,
          cmsUser: cmsUser.trim(),
          count, namePrefix, couponType, issueType, benefitType, benefitValue,
          maxDiscountPrice: benefitType === "PERCENT_DISCOUNT" ? maxDiscountPrice : undefined,
          validDays, concurrency,
          issueMemberNos: issueMemberNos.trim() || undefined,
          // 노출 / 사용조건 / 발급조건
          exposed,
          exposeImageUrl: exposed ? (exposeImageUrl.trim() || undefined) : undefined,
          exposeKeyword: effDownloadType === "KEYWORD" ? (exposeKeyword.trim() || undefined) : undefined,
          minOrderAmount: minOrderAmount > 0 ? minOrderAmount : undefined,
          minOrderQty,
          onlyApp,
          allowDiscountedProducts: allowDiscounted,
          // 주문조건 대상
          hurdleTarget,
          hurdleCodes: (hurdleTarget === "COLLECTION" || hurdleTarget === "CATEGORY" || hurdleTarget === "PRODUCT") ? hurdleCodes.trim() || undefined : undefined,
          // 발급방법
          downloadType,
          randomCodeQuantity: effDownloadType === "RANDOM_CODE" ? randomCodeQty : undefined,
          memberMaxIssue,
          allowBizMember,
          vipScope,
          membersOnly,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        // 라우트의 실제 사유(lacms 로그인 실패 / JWT 필수 등)를 그대로 노출 — generic 400 대신.
        let msg = `요청 실패: ${res.status} ${res.statusText}`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        setError(msg);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const live: Result[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const lines = chunk.split("\n");
          let type = "message"; let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data = line.slice(5).trim();
          }
          if (!data) continue;
          try {
            const payload = JSON.parse(data);
            if (type === "progress") {
              live[payload.latest.index - 1] = payload.latest;
              setResults([...live]);
              setProgress({ done: payload.done, total: payload.total });
            } else if (type === "done") {
              setResults(payload.results);
              setProgress({ done: payload.results.length, total: payload.results.length });
              setElapsedMs(Date.now() - startTs);
              const ids = (payload.results as Result[])
                .filter((r) => r && r.ok && r.coupon_publish_id != null)
                .map((r) => r.coupon_publish_id as number | string);
              if (ids.length) onPublished?.(ids);
            } else if (type === "error") {
              setError(payload.message || "처리 실패");
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }
  function cancel() { abortRef.current?.abort(); }

  // 생성된 쿠폰들을 일괄 활성화 (대기 → 활성). 인증은 생성과 동일(lacms OAuth or JWT).
  async function activateAll() {
    const ids = results.filter((r) => r && r.ok && r.coupon_publish_id != null).map((r) => r.coupon_publish_id as number | string);
    if (ids.length === 0 || activating) return;
    setActivateMsg("");
    setActivating(true);
    try {
      const res = await fetch("/api/test-data/coupon-publish/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lacmsEmail: lacmsEmail.trim() || undefined,
          lacmsPassword: lacmsPassword || undefined,
          jwtToken: jwtToken.trim() || undefined,
          cmsUser: cmsUser.trim(),
          ids,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setActivateMsg("활성화 실패: " + (data?.error || res.statusText)); return; }
      const okIds = new Set((data.results as { id: number | string; ok: boolean }[]).filter((r) => r.ok).map((r) => String(r.id)));
      setResults((prev) => prev.map((r) => (r.coupon_publish_id != null && okIds.has(String(r.coupon_publish_id)) ? { ...r, activated: true } : r)));
      setActivateMsg(`활성화 ${data.okCount}/${data.results.length} 완료${data.failCount ? ` · 실패 ${data.failCount}건` : ""}`);
    } catch (e) {
      setActivateMsg("활성화 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setActivating(false);
    }
  }

  function downloadCsv() {
    const header = "No,publishName,couponName,keyword,result,status,coupon_publish_id,error";
    const rows = results.map((r) =>
      [r.index, r.publishName, r.couponName, r.keyword ?? "", r.ok ? "OK" : "FAIL", r.status ?? "", r.coupon_publish_id ?? "", (r.error ?? "").replace(/[\r\n,]/g, " ")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    );
    const csv = "﻿" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `coupons_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const okCount = results.filter((r) => r && r.ok).length;
  const failCount = results.filter((r) => r && !r.ok).length;
  const sendableIds = results.filter((r) => r && r.ok && r.coupon_publish_id != null).map((r) => r.coupon_publish_id as number | string);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const issueMemberList = issueMemberNos.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));

  return (
    <div className="space-y-4">
      {/* 인증 — lacms ID/PW 자동 발급 + X-KURLY-CMS-USER (불변값) */}
      <div className="card border-l-4 border-l-amber-400 p-5 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">📧 lacms 이메일</label>
            <input
              type="email"
              value={lacmsEmail}
              onChange={(e) => setLacmsEmail(e.target.value)}
              onBlur={saveTokens}
              placeholder="jongkwan.ahn@kurlycorp.com"
              className="input font-mono text-xs"
              disabled={running}
              autoComplete="username"
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              lacms2.stg.kurlycorp.kr 로그인 계정
              {lacmsEmail && <span className="ml-1 text-emerald-600">✓ 저장됨</span>}
            </p>
          </div>
          <div>
            <label className="label">🔒 패스워드</label>
            <input
              type="password"
              value={lacmsPassword}
              onChange={(e) => setLacmsPassword(e.target.value)}
              placeholder="••••••••"
              className="input font-mono text-xs"
              disabled={running}
              autoComplete="current-password"
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              서버 → OAuth 로그인 후 JWT 자동 발급 (저장 안 됨)
            </p>
          </div>
        </div>
        <details className="rounded border border-neutral-200 bg-neutral-50/50 p-2">
          <summary className="cursor-pointer text-xs font-medium text-neutral-600">고급: JWT 직접 입력 / X-KURLY-CMS-USER (보통 불필요)</summary>
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-[11px] font-medium text-neutral-600">JWT 토큰 (lacms 이메일/패스워드 대신)</label>
              <input
                value={jwtToken}
                onChange={(e) => setJwtToken(e.target.value)}
                onBlur={saveTokens}
                placeholder="eyJhbGciOiJSUzI1NiIs..."
                className="input font-mono text-xs"
                disabled={running}
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                lacms 이메일/패스워드 안 쓰고 JWT 직접 사용. 만료되면 다시 입력 필요.
                {jwtToken && <span className="ml-1 text-emerald-600">✓ 저장됨</span>}
              </p>
            </div>
            <div>
              <label className="text-[11px] font-medium text-neutral-600">X-KURLY-CMS-USER (특수한 경우만)</label>
              <input
                value={cmsUser}
                onChange={(e) => setCmsUser(e.target.value)}
                onBlur={saveTokens}
                placeholder="대부분 필요 없음 — 401 나면 채우기"
                className="input font-mono text-xs"
                disabled={running}
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                OAuth 자동 발급된 JWT 면 이 헤더 불필요. 수동 JWT 사용 + 401 나는 경우만 사용.
                {cmsUser && <span className="ml-1 text-emerald-600">✓ 저장됨</span>}
              </p>
            </div>
          </div>
        </details>
      </div>

      {/* 쿠폰 옵션 */}
      <div className="card p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">생성 개수 *</label>
            <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="input" disabled={running} />
            <p className="mt-0.5 text-[11px] text-neutral-400">1 ~ 100</p>
          </div>
          <div>
            <label className="label">동시 처리</label>
            <input type="number" min={1} max={10} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, Math.min(10, Number(e.target.value) || 5)))} className="input" disabled={running} />
            <p className="mt-0.5 text-[11px] text-neutral-400">1 ~ 10</p>
          </div>
          <div>
            <label className="label">쿠폰 종류</label>
            <select value={couponType} onChange={(e) => setCouponType(e.target.value as typeof couponType)} className="input" disabled={running}>
              <option value="CART">CART (장바구니)</option>
              <option value="FREE_SHIPPING">FREE_SHIPPING (무료배송)</option>
            </select>
            <p className="mt-0.5 text-[11px] text-neutral-400">PRODUCT 는 상품 ID 입력 필요 — 별도 흐름</p>
          </div>
          <div>
            <label className="label">발급 방식</label>
            <select
              value={issueMemberList.length > 0 ? "ADMIN" : issueType}
              onChange={(e) => setIssueType(e.target.value as typeof issueType)}
              className="input"
              disabled={running || issueMemberList.length > 0}
            >
              <option value="DOWNLOAD">DOWNLOAD (다운로드)</option>
              <option value="ADMIN">ADMIN (회원 발급)</option>
            </select>
            <p className="mt-0.5 text-[11px] text-neutral-400">
              {issueMemberList.length > 0
                ? "🔒 발급 대상 입력됨 → ADMIN(운영자 발급)으로 고정"
                : "DOWNLOAD: 회원이 코드로 직접 받음(지급 X) · ADMIN: 운영자가 회원에 직접 발급"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">쿠폰명 prefix</label>
            <input value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} maxLength={20} className="input" disabled={running} placeholder="QA쿠폰" />
            <p className="mt-0.5 text-[11px] text-neutral-400">→ {namePrefix}_XXXX_1, ..._2 ...</p>
          </div>
          {couponType === "FREE_SHIPPING" ? (
            <>
              <div>
                <label className="label">할인 유형</label>
                <input value="무료배송 (FREE_SHIPPING)" disabled className="input bg-neutral-50 text-neutral-500" />
                <p className="mt-0.5 text-[11px] text-neutral-400">배송비 0원 — 값 입력 불필요</p>
              </div>
              <div />
            </>
          ) : (
            <>
              <div>
                <label className="label">할인 유형</label>
                <select
                  value={benefitType}
                  onChange={(e) => {
                    const next = e.target.value as typeof benefitType;
                    setBenefitType(next);
                    if (next === "PERCENT_DISCOUNT" && benefitValue > 100) setBenefitValue(10);
                    if (next === "PRICE_DISCOUNT" && benefitValue <= 100) setBenefitValue(1000);
                  }}
                  className="input"
                  disabled={running}
                >
                  <option value="PRICE_DISCOUNT">정액 (PRICE)</option>
                  <option value="PERCENT_DISCOUNT">정률 (PERCENT %)</option>
                </select>
              </div>
              <div>
                <label className="label">
                  {benefitType === "PRICE_DISCOUNT" ? "할인 금액" : "할인율"}
                </label>
                <input
                  type="number"
                  min={1}
                  max={benefitType === "PERCENT_DISCOUNT" ? 100 : undefined}
                  value={benefitValue}
                  onChange={(e) => {
                    const max = benefitType === "PERCENT_DISCOUNT" ? 100 : 1000000;
                    setBenefitValue(Math.max(1, Math.min(max, Number(e.target.value) || 1)));
                  }}
                  className="input"
                  disabled={running}
                  placeholder={benefitType === "PRICE_DISCOUNT" ? "1000" : "10"}
                />
                <p className="mt-0.5 text-[11px] text-neutral-400">
                  {benefitType === "PRICE_DISCOUNT" ? "원" : "% (1~100)"}
                </p>
              </div>
            </>
          )}
          <div>
            <label className="label">유효 기간 (일)</label>
            <input type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(Math.max(1, Math.min(365, Number(e.target.value) || 7)))} className="input" disabled={running} />
            <p className="mt-0.5 text-[11px] text-neutral-400">발행/사용 기간 모두 N일</p>
          </div>
          {couponType !== "FREE_SHIPPING" && benefitType === "PERCENT_DISCOUNT" && (
            <div>
              <label className="label">최대 할인금액</label>
              <input type="number" min={0} value={maxDiscountPrice} onChange={(e) => setMaxDiscountPrice(Math.max(0, Number(e.target.value) || 0))} className="input" disabled={running} />
              <p className="mt-0.5 text-[11px] text-neutral-400">원 (정률만)</p>
            </div>
          )}
        </div>

        {/* 발급 · 사용 조건 / 노출 — 이예지[프로모션] 요청 */}
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-neutral-700">🎛 발급 · 사용 조건 / 노출</span>
            <span className="text-[11px] text-neutral-400">선택 — 비우면 기본값(조건 없음·비노출)</span>
          </div>

          {/* 노출 여부 */}
          <div>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={exposed} onChange={(e) => setExposed(e.target.checked)} disabled={running} className="h-4 w-4 rounded border-neutral-300 text-sky-600" />
              발급 목록에 <strong>노출</strong>
              <span className="text-[11px] text-neutral-400">(다운로드 가능 쿠폰 목록 등에 표시. 끄면 숨김)</span>
            </label>
            {exposed && (
              <div className="mt-2 pl-6 space-y-2">
                <div>
                  <label className="label">노출 이미지 경로 *</label>
                  <input value={exposeImageUrl} onChange={(e) => setExposeImageUrl(e.target.value)} className="input font-mono text-xs" disabled={running} placeholder="coupon/thumbs/coupon1.png" />
                  <p className="mt-0.5 text-[11px] text-neutral-400">노출 켜면 <strong>이미지 필수</strong>(없으면 API 400). QA용은 기본 예시 경로 그대로 둬도 됩니다.</p>
                </div>
                <p className="text-[11px] text-sky-700">ℹ️ 노출 쿠폰은 <strong>DOWNLOAD 발급 + 키워드</strong>로만 동작 — 발급방법이 <strong>키워드로 자동 고정</strong>됩니다(키워드는 아래 발급조건에서 입력). 발급 사용조건은 <strong>멤버스 한정/없음</strong>만 가능(VIP·사업자 한정 미적용).</p>
              </div>
            )}
          </div>

          {/* 사용조건 */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400">사용조건 — 쿠폰 사용 시</p>
            {/* 주문조건 대상 */}
            <div className="mb-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="text-sm text-neutral-700">주문조건 대상</label>
                <select value={hurdleTarget} onChange={(e) => setHurdleTarget(e.target.value as typeof hurdleTarget)} className="input max-w-[220px]" disabled={running}>
                  <option value="ALL">전체</option>
                  <option value="COLLECTION">컬렉션</option>
                  <option value="CATEGORY">카테고리</option>
                  <option value="PRODUCT">상품</option>
                  <option value="SAME">적용대상 동일</option>
                </select>
                {(hurdleTarget === "COLLECTION" || hurdleTarget === "CATEGORY" || hurdleTarget === "PRODUCT") && (
                  <input
                    value={hurdleCodes}
                    onChange={(e) => setHurdleCodes(e.target.value)}
                    className="input flex-1 font-mono text-xs min-w-[200px]"
                    disabled={running}
                    placeholder={hurdleTarget === "COLLECTION" ? "컬렉션 코드 (쉼표 구분) 예: beautyfesta01" : hurdleTarget === "CATEGORY" ? "카테고리 코드 (쉼표 구분) 예: 370" : "상품 코드 product_no (쉼표 구분)"}
                  />
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-neutral-400">
                전체=주문 전체 / 컬렉션·카테고리·상품=해당 코드 한정(코드 입력) / 적용대상 동일=쿠폰 적용대상과 동일.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <label className="label">최소 주문금액</label>
                <input
                  type="number"
                  min={0}
                  value={minOrderAmount === 0 ? "" : minOrderAmount}
                  onChange={(e) => { const v = e.target.value; setMinOrderAmount(v === "" ? 0 : Math.max(0, Math.floor(Number(v) || 0))); }}
                  className="input"
                  disabled={running}
                  placeholder="0"
                />
                <p className="mt-0.5 text-[11px] text-neutral-400">원 (0 = 제한없음)</p>
              </div>
              <div>
                <label className="label">최소 주문수량</label>
                <input type="number" min={1} max={999} value={minOrderQty} onChange={(e) => setMinOrderQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))} className="input" disabled={running} />
                <p className="mt-0.5 text-[11px] text-neutral-400">개 이상</p>
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
                <input type="checkbox" checked={onlyApp} onChange={(e) => setOnlyApp(e.target.checked)} disabled={running} className="h-4 w-4 rounded border-neutral-300 text-sky-600" />
                앱 전용
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
                <input type="checkbox" checked={allowDiscounted} onChange={(e) => setAllowDiscounted(e.target.checked)} disabled={running} className="h-4 w-4 rounded border-neutral-300 text-sky-600" />
                할인상품에도 사용
              </label>
            </div>
          </div>

          {/* 발급조건 — DOWNLOAD 발급일 때 (노출이면 개방형 다운로드로 발급) */}
          {issueMemberList.length === 0 && issueType === "DOWNLOAD" ? (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400">발급조건 — 다운로드 받을 때</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <label className="label">발급방법</label>
                  <select value={effDownloadType} onChange={(e) => setDownloadType(e.target.value as typeof downloadType)} className="input" disabled={running || exposed}>
                    <option value="ACCESS_KEY">엑세스키</option>
                    <option value="KEYWORD">키워드</option>
                    <option value="RANDOM_CODE">난수코드</option>
                  </select>
                  <p className="mt-0.5 text-[11px] text-neutral-400">{exposed ? "노출 → 키워드 고정" : "다운로드 발급 유형"}</p>
                </div>
                {effDownloadType === "KEYWORD" && (
                  <div>
                    <label className="label">키워드 *</label>
                    <input
                      value={exposeKeyword}
                      onChange={(e) => setExposeKeyword(e.target.value)}
                      onBlur={(e) => setExposeKeyword(e.target.value.replace(/[^가-힣A-Za-z0-9]/g, ""))}
                      className="input font-mono text-xs"
                      disabled={running}
                      placeholder="예: 여름특가 (비우면 자동)"
                    />
                    <p className="mt-0.5 text-[11px] text-neutral-400">이 키워드로 받기 · 한글·영문·숫자만{count > 1 ? " · 여러건=끝에 번호" : ""}</p>
                  </div>
                )}
                {effDownloadType === "RANDOM_CODE" && (
                  <div>
                    <label className="label">난수코드 수량</label>
                    <input type="number" min={1} max={100000} value={randomCodeQty} onChange={(e) => setRandomCodeQty(Math.max(1, Math.min(100000, Number(e.target.value) || 1)))} className="input" disabled={running} />
                    <p className="mt-0.5 text-[11px] text-neutral-400">생성할 코드 개수</p>
                  </div>
                )}
                <div>
                  <label className="label">회원당 발급수</label>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={memberMaxIssue === 0 ? "" : memberMaxIssue}
                    onChange={(e) => { const v = e.target.value; setMemberMaxIssue(v === "" ? 0 : Math.max(0, Math.min(999, Math.floor(Number(v) || 0)))); }}
                    className="input"
                    disabled={running}
                    placeholder="0"
                  />
                  <p className="mt-0.5 text-[11px] text-neutral-400">장 (0 = 무제한)</p>
                </div>
                {!exposed && (
                  <div>
                    <label className="label">VIP 한정</label>
                    <select value={vipScope} onChange={(e) => setVipScope(e.target.value as typeof vipScope)} className="input" disabled={running}>
                      <option value="ALL">제한 없음</option>
                      <option value="VIP_VVIP">VIP · VVIP</option>
                      <option value="VIP">VIP만</option>
                      <option value="VVIP">VVIP만</option>
                    </select>
                  </div>
                )}
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
                  <input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} disabled={running} className="h-4 w-4 rounded border-neutral-300 text-sky-600" />
                  멤버스 한정
                </label>
                {!exposed && (
                  <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
                    <input type="checkbox" checked={allowBizMember} onChange={(e) => setAllowBizMember(e.target.checked)} disabled={running} className="h-4 w-4 rounded border-neutral-300 text-sky-600" />
                    사업자 회원 허용
                  </label>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-neutral-400">
              ℹ️ 발급조건(회원당 발급수·VIP/멤버스 한정 등)은 <strong>DOWNLOAD 발급</strong>일 때만 적용됩니다.{" "}
              {issueMemberList.length > 0 ? "발급 대상이 지정돼 ADMIN(운영자 발급)으로 동작합니다." : "발급 방식을 DOWNLOAD 로 두세요."}
            </p>
          )}
        </div>

        <div className="rounded-md border border-kurly-200 bg-kurly-50/40 p-3">
          <label className="label">🎯 발급 대상 회원번호 (선택)</label>
          <textarea
            value={issueMemberNos}
            onChange={(e) => setIssueMemberNos(e.target.value)}
            disabled={running}
            rows={2}
            className="input font-mono text-xs"
            placeholder="예: 25340400, 25340401  (쉼표/줄바꿈 구분, 비우면 발급 안 함)"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            입력하면 쿠폰 생성 후 <strong>그 회원들에게 즉시 발급</strong>(운영자 발급)됩니다 — 그 회원이 바로 보유 → 주문에서 쿠폰 적용 테스트 가능.
            {issueMemberList.length > 0
              ? <span className="ml-1 text-kurly-700">→ {issueMemberList.length}명에게 발급 · 발급 시 <strong>ADMIN 타입</strong>으로 자동 생성</span>
              : <span className="ml-1 text-neutral-400">→ 비움: 쿠폰만 생성</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 pt-2">
          {!running ? (
            <button onClick={submit} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
              🎟️ {count}건 생성{issueMemberList.length > 0 ? ` + ${issueMemberList.length}명 발급` : ""} 시작
            </button>
          ) : (
            <button onClick={cancel} className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100">
              ⏹ 중단
            </button>
          )}
          {sendableIds.length > 0 && !running && (
            <button
              onClick={activateAll}
              disabled={activating}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              title="생성된 쿠폰을 활성화(대기→활성). 활성화해야 다운로드/사용 가능."
            >
              {activating ? "⚡ 활성화 중…" : `⚡ ${sendableIds.length}개 활성화 (대기→활성)`}
            </button>
          )}
          {results.length > 0 && !running && (
            <button onClick={downloadCsv} className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
              📥 CSV 다운로드
            </button>
          )}
          {onSendToPack && sendableIds.length > 0 && !running && (
            <button
              onClick={() => onSendToPack(sendableIds)}
              className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
              title="발행 성공한 쿠폰들의 publish_id를 쿠폰팩 탭으로 넘겨 자동 입력"
            >
              🎁 발행 {sendableIds.length}개 쿠폰팩으로 묶기 →
            </button>
          )}
        </div>
        {error && <div className="rounded border-l-4 border-rose-400 bg-rose-50 p-2 text-xs text-rose-800">⚠ {error}</div>}
        {activateMsg && <div className="rounded border-l-4 border-emerald-400 bg-emerald-50 p-2 text-xs text-emerald-800">⚡ {activateMsg}</div>}
      </div>

      {(running || results.length > 0) && (
        <div className="card p-5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500">진행률</span>
            <span className="font-mono">
              {progress.done} / {progress.total} ({pct}%){elapsedMs !== null && ` · ${(elapsedMs / 1000).toFixed(1)}초`}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md border border-neutral-200 py-2"><div className="text-neutral-500">완료</div><div className="mt-0.5 font-semibold">{progress.done}</div></div>
            <div className="rounded-md border border-neutral-200 py-2"><div className="text-neutral-500">성공</div><div className="mt-0.5 font-semibold text-emerald-600">{okCount}</div></div>
            <div className="rounded-md border border-neutral-200 py-2"><div className="text-neutral-500">실패</div><div className="mt-0.5 font-semibold text-rose-600">{failCount}</div></div>
          </div>

          {results.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-left text-[10px] uppercase text-neutral-500">
                  <tr>
                    <th className="px-2 py-1.5 w-12">No</th>
                    <th className="px-2 py-1.5">publishName</th>
                    <th className="px-2 py-1.5">couponName</th>
                    <th className="px-2 py-1.5">키워드</th>
                    <th className="px-2 py-1.5">result</th>
                    <th className="px-2 py-1.5">publish_id</th>
                    <th className="px-2 py-1.5">발급상태</th>
                    <th className="px-2 py-1.5">발급</th>
                    <th className="px-2 py-1.5">error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {results.filter(Boolean).map((r) => (
                    <tr key={r.index} className={r.ok ? "" : "bg-rose-50"}>
                      <td className="px-2 py-1.5 font-mono">{r.index}</td>
                      <td className="px-2 py-1.5 font-mono">{r.publishName}</td>
                      <td className="px-2 py-1.5 font-mono">{r.couponName}</td>
                      <td className="px-2 py-1.5 font-mono text-sky-700">{r.keyword ?? "-"}</td>
                      <td className="px-2 py-1.5">
                        {r.ok
                          ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OK</span>
                          : <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">FAIL</span>}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-neutral-700">{r.coupon_publish_id ?? "-"}</td>
                      <td className="px-2 py-1.5">
                        {!r.ok || r.coupon_publish_id == null ? <span className="text-neutral-300">-</span>
                          : r.activated ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">활성</span>
                          : <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">대기</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {issueMemberList.length === 0 ? <span className="text-neutral-300">-</span>
                          : r.issued ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">발급 {r.issuedCount ?? ""}</span>
                          : r.issueError ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700" title={r.issueError}>발급실패</span>
                          : <span className="text-neutral-300">-</span>}
                      </td>
                      <td className="px-2 py-1.5 text-rose-700 max-w-[300px] truncate" title={r.error ?? r.issueError ?? ""}>{r.error ?? r.issueError ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
