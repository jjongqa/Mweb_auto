import { NextRequest } from "next/server";
import { applyDiscounts, lacmsLoginForCoupon, fmtDiscountDateTime, buildCmsUserHeader, cmsUserFromJwt, type DiscountApplyInput, type DiscountType, type DiscountKind } from "@/lib/test-data-discount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseList(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw.map(String) : (typeof raw === "string" ? raw.split(/[\s,]+/) : []);
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  // lacms OAuth (쿠폰과 동일)
  const email = String(body.lacmsEmail || "").trim();
  let jwtToken = String(body.jwtToken || "").trim();
  let oauthErr: string | null = null;
  if (email && body.lacmsPassword) {
    const o = await lacmsLoginForCoupon(email, String(body.lacmsPassword));
    if (o.token) jwtToken = o.token; else oauthErr = o.error ?? "OAuth 응답에 access_token 없음";
  }
  if (oauthErr) return Response.json({ error: `lacms 로그인 실패: ${oauthErr}` }, { status: 400 });
  if (!jwtToken) return Response.json({ error: "JWT 필요 (lacms 이메일/패스워드 또는 JWT 직접 입력)" }, { status: 400 });

  // x-kurly-cms-user — 할인 API 필수 헤더.
  // 우선순위: 수동 입력 > JWT 클레임 기반 자동 생성(id/name/mno) > 이메일 폴백.
  const cmsManual = String(body.cmsUser || "").trim();
  const cmsUser = cmsManual || cmsUserFromJwt(jwtToken) || (email ? buildCmsUserHeader(email) : undefined);

  const dealProductNos = parseList(body.dealProductNos).filter((s) => /^\d+$/.test(s));
  const centerCodes = parseList(body.centerCodes);
  if (dealProductNos.length === 0) return Response.json({ error: "dealProductNo 1개 이상 필요 (숫자)" }, { status: 400 });
  if (centerCodes.length === 0) return Response.json({ error: "clusterCenterCode 1개 이상 필요" }, { status: 400 });

  const discountType: DiscountType = body.discountType === "AMOUNT" ? "AMOUNT" : "PERCENTAGE";
  const discountValue = Math.max(1, Number(body.discountValue) || 0);
  const discountKind: DiscountKind = body.discountKind === "SINGLE_BUNDLE" ? "SINGLE_BUNDLE" : "STANDARD";
  const days = Math.max(1, Math.min(365, Number(body.validDays) || 30));

  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  end.setHours(23, 59, 59, 0);

  const input: DiscountApplyInput = {
    jwtToken,
    cmsUser,
    dealProductNos,
    centerCodes,
    discountType,
    discountValue,
    conditionQuantity: Math.max(1, Number(body.conditionQuantity) || 1),
    startDateTime: fmtDiscountDateTime(start),
    endDateTime: fmtDiscountDateTime(end),
    discountKind,
    reason1: body.reason1 ? String(body.reason1) : undefined,
    reason2: body.reason2 ? String(body.reason2) : undefined,
    isAffordable: !!body.isAffordable,
  };

  try {
    const result = await applyDiscounts(input);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
