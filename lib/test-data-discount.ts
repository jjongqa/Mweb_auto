/**
 * 테스트 데이터 — 상품(딜) 할인 적용 (discount admin API)
 * POST https://gateway.cloud.stg.kurly.services/discount/v1/admin/discounts/bulk
 *   body: { commandList: [{ clusterCenterCode, benefit{discountType,discountValue,product{dealProductNo},conditionQuantity},
 *                           discountPeriod{startDateTime,endDateTime}, discountReason{reason1,reason2}, meta{isAffordable}, discountKind }] }
 * 인증: lacms OAuth bearer JWT (쿠폰과 동일 SSO). 할인은 (dealProductNo × clusterCenterCode) 단위.
 */

import { lacmsLoginForCoupon } from "./test-data-coupon";

export { lacmsLoginForCoupon };  // 라우트에서 재사용

const STG_DISCOUNT_URL = "https://gateway.cloud.stg.kurly.services/discount/v1/admin/discounts/bulk";

export type DiscountType = "PERCENTAGE" | "AMOUNT";
export type DiscountKind = "STANDARD" | "SINGLE_BUNDLE";

export interface DiscountApplyInput {
  jwtToken: string;
  cmsUser?: string;
  dealProductNos: (number | string)[];
  centerCodes: string[];
  discountType: DiscountType;
  discountValue: number;
  conditionQuantity?: number;     // default 1
  startDateTime: string;          // "yyyy-MM-dd HH:mm:ss"
  endDateTime: string;
  discountKind?: DiscountKind;    // default STANDARD
  reason1?: string;               // default "프로모션"
  reason2?: string;               // default "일일특가"
  isAffordable?: boolean;         // default false
}

export interface DiscountApplyResult {
  ok: boolean;
  status: number;
  total: number;          // commandList 길이 (deal × center)
  successCount: number;
  failCount: number;
  fails: unknown[];       // failList 상세
  message?: string;
  raw: unknown;
}

export function fmtDiscountDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function base64UrlToJson(seg: string): any {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf-8"));
}

/**
 * x-kurly-cms-user 헤더 값 생성 — 할인 API 필수 헤더.
 * 형식: base64( "{mno}:{email}:{name}" ) — JSON 아님(콜론 구분 문자열).
 * (검증: 할인 docs 예시 "MTp0ZXN0QGt1cmx5Y29ycC5jb20..." 디코드 = "1:test@kurlycorp.com:{name}".)
 * 값은 모두 로그인 JWT 클레임에 있음(mno, id=이메일, name) → 어느 운영자든 로그인만 하면 자동 생성.
 */
export function cmsUserFromJwt(jwt: string): string | undefined {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return undefined;
    const c = base64UrlToJson(parts[1]);
    if (c?.id == null && c?.mno == null) return undefined;
    return Buffer.from(`${c.mno ?? ""}:${c.id ?? ""}:${c.name ?? ""}`, "utf-8").toString("base64");
  } catch {
    return undefined;
  }
}

/** 폴백: JWT 디코드 실패 시 이메일만으로 최소 형식 생성 (mno/name 비어있음). */
export function buildCmsUserHeader(email: string, name?: string, mno?: string | number): string {
  const local = email.includes("@") ? email.split("@")[0] : email;
  return Buffer.from(`${mno ?? ""}:${email}:${name || local}`, "utf-8").toString("base64");
}

export async function applyDiscounts(input: DiscountApplyInput): Promise<DiscountApplyResult> {
  const deals = input.dealProductNos.map((d) => Number(d)).filter((n) => Number.isFinite(n) && n > 0);
  const centers = input.centerCodes.map((c) => c.trim()).filter(Boolean);
  if (deals.length === 0) throw new Error("dealProductNo 1개 이상 필요");
  if (centers.length === 0) throw new Error("clusterCenterCode 1개 이상 필요");

  const commandList = [];
  for (const center of centers) {
    for (const dp of deals) {
      commandList.push({
        clusterCenterCode: center,
        benefit: {
          discountType: input.discountType,
          discountValue: input.discountValue,
          product: { dealProductNo: dp },
          conditionQuantity: input.conditionQuantity ?? 1,
        },
        discountPeriod: { startDateTime: input.startDateTime, endDateTime: input.endDateTime },
        discountReason: { reason1: input.reason1 || "프로모션", reason2: input.reason2 || "일일특가" },
        meta: { isAffordable: !!input.isAffordable },
        discountKind: input.discountKind || "STANDARD",
      });
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json",
    "authorization": `bearer ${input.jwtToken}`,
    "origin": "https://lacms2.stg.kurlycorp.kr",
    "referer": "https://lacms2.stg.kurlycorp.kr/",
  };
  if (input.cmsUser) headers["x-kurly-cms-user"] = input.cmsUser;

  let status = 0;
  let data: any = null;
  try {
    const res = await fetch(STG_DISCOUNT_URL, { method: "POST", headers, body: JSON.stringify({ commandList }) });
    status = res.status;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
  } catch (err) {
    return { ok: false, status: 0, total: commandList.length, successCount: 0, failCount: commandList.length, fails: [], message: err instanceof Error ? err.message : String(err), raw: null };
  }

  const d = (data && typeof data === "object" ? data.data : null) ?? {};
  const failList: unknown[] = Array.isArray(d.failList) ? d.failList : [];
  const successList: unknown[] = Array.isArray(d.successList) ? d.successList : [];
  // 207 Multi-Status(부분성공) 포함. success 판정: HTTP ok + success!==false + 실패목록 없음
  const httpOk = status >= 200 && status < 300;
  const successCount = successList.length || (httpOk && data?.success !== false && failList.length === 0 ? commandList.length : commandList.length - failList.length);
  const ok = httpOk && data?.success !== false && failList.length === 0;
  const message = data?.message ?? data?.error?.message ?? undefined;
  return { ok, status, total: commandList.length, successCount: Math.max(0, successCount), failCount: failList.length, fails: failList, message, raw: data };
}
