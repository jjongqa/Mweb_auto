import { NextRequest } from "next/server";
import { createCouponsBatch, lacmsLoginForCoupon, type CouponCreateInput } from "@/lib/test-data-coupon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CouponBody extends Partial<CouponCreateInput> {
  lacmsEmail?: string;
  lacmsPassword?: string;
  // 폼 전용 표현 (CouponCreateInput 으로 변환) — VIP 한정 select, 멤버스 한정 체크박스
  vipScope?: "ALL" | "VIP_VVIP" | "VIP" | "VVIP";
  membersOnly?: boolean;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as CouponBody;

  // ID/PW 가 들어왔으면 server-side OAuth 로 JWT 자동 발급. 기존 수동 입력값은 fallback.
  let jwtToken = String(body.jwtToken || "").trim();
  let oauthErr: string | null = null;
  console.log(`[coupon] body keys: ${Object.keys(body).join(",")} / email=${!!body.lacmsEmail} / pw=${!!body.lacmsPassword} / oldJwt=${jwtToken ? jwtToken.length : 0}자`);
  if (body.lacmsEmail && body.lacmsPassword) {
    try {
      const oauth = await lacmsLoginForCoupon(String(body.lacmsEmail).trim(), String(body.lacmsPassword));
      console.log(`[coupon] OAuth 결과: token=${oauth.token ? oauth.token.length + "자" : "없음"} / err=${oauth.error ?? "없음"}`);
      if (oauth.token) jwtToken = oauth.token;
      else oauthErr = oauth.error ?? "OAuth 응답에 access_token 없음";
    } catch (err) {
      oauthErr = err instanceof Error ? err.message : String(err);
      console.log(`[coupon] OAuth 예외: ${oauthErr}`);
    }
  }
  console.log(`[coupon] 최종 jwtToken 길이: ${jwtToken.length}자 prefix=${jwtToken.slice(0, 20)} / oauthErr=${oauthErr ?? "없음"}`);

  // 발급 대상 회원번호 — 배열 또는 "구분자" 문자열 모두 허용. 숫자만, 중복 제거, 최대 1000.
  const issueMemberNos: string[] = (() => {
    const raw = (body as { issueMemberNos?: unknown }).issueMemberNos;
    const arr = Array.isArray(raw) ? raw.map(String) : (typeof raw === "string" ? raw.split(/[\s,]+/) : []);
    return [...new Set(arr.map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))].slice(0, 1000);
  })();

  const input: CouponCreateInput = {
    jwtToken,
    cmsUser: String(body.cmsUser || "").trim(),
    count: Math.max(1, Math.min(100, Number(body.count) || 1)),
    namePrefix: String(body.namePrefix || "QA쿠폰").slice(0, 20),
    description: body.description ? String(body.description).slice(0, 200) : undefined,
    couponType: (["CART", "PRODUCT", "FREE_SHIPPING"].includes(String(body.couponType)) ? body.couponType : "CART") as CouponCreateInput["couponType"],
    // 회원 발급(운영자 발급)은 ADMIN 발급 타입에서 동작 → 발급 대상 지정 시 ADMIN 강제
    issueType: (issueMemberNos.length > 0 ? "ADMIN" : (["ADMIN", "DOWNLOAD", "AUTO"].includes(String(body.issueType)) ? body.issueType : "DOWNLOAD")) as CouponCreateInput["issueType"],
    issueMemberNos: issueMemberNos.length > 0 ? issueMemberNos : undefined,
    benefitType: (["PRICE_DISCOUNT", "PERCENT_DISCOUNT", "FREE_SHIPPING"].includes(String(body.benefitType)) ? body.benefitType : "PRICE_DISCOUNT") as CouponCreateInput["benefitType"],
    benefitValue: Math.max(1, Math.min(1000000, Number(body.benefitValue) || 1000)),
    maxDiscountPrice: body.maxDiscountPrice ? Math.max(0, Number(body.maxDiscountPrice)) : undefined,
    validDays: Math.max(1, Math.min(365, Number(body.validDays) || 7)),
    concurrency: Math.max(1, Math.min(10, Number(body.concurrency) || 5)),

    // 노출
    exposed: !!body.exposed,
    exposeImageUrl: body.exposeImageUrl ? String(body.exposeImageUrl).trim() : undefined,
    exposeKeyword: body.exposeKeyword ? String(body.exposeKeyword).replace(/[^가-힣A-Za-z0-9]/g, "").slice(0, 20) : undefined,
    // 사용조건
    minOrderAmount: body.minOrderAmount ? Math.max(0, Math.floor(Number(body.minOrderAmount))) : undefined,
    minOrderQty: Math.max(1, Math.min(999, Number(body.minOrderQty) || 1)),
    onlyApp: !!body.onlyApp,
    allowDiscountedProducts: body.allowDiscountedProducts !== false, // 기본 true(허용)
    // 주문조건 대상
    hurdleTarget: (["ALL", "COLLECTION", "CATEGORY", "PRODUCT", "SAME"].includes(String(body.hurdleTarget)) ? body.hurdleTarget : "ALL") as CouponCreateInput["hurdleTarget"],
    hurdleCodes: (() => {
      const raw = (body as { hurdleCodes?: unknown }).hurdleCodes;
      const arr = Array.isArray(raw) ? raw.map(String) : (typeof raw === "string" ? raw.split(/[\s,]+/) : []);
      return arr.map((s) => s.trim()).filter(Boolean).slice(0, 50);
    })(),
    // 발급방법 (다운로드 발급 유형) — 노출이면 lib에서 KEYWORD 강제
    downloadType: (["ACCESS_KEY", "KEYWORD", "RANDOM_CODE"].includes(String(body.downloadType)) ? body.downloadType : "ACCESS_KEY") as CouponCreateInput["downloadType"],
    randomCodeQuantity: body.randomCodeQuantity ? Math.max(1, Math.min(100000, Math.floor(Number(body.randomCodeQuantity)))) : undefined,
    // 발급조건 (DOWNLOAD 발급일 때만 실제 반영) — 0 이하면 무제한(null)
    memberMaxIssue: (() => { const n = Math.floor(Number(body.memberMaxIssue)); return Number.isFinite(n) && n > 0 ? n : (body.memberMaxIssue === 0 || body.memberMaxIssue === null ? null : 1); })(),
    allowBizMember: !!body.allowBizMember,
    allowVipTypes: (() => {
      const v = String((body as { vipScope?: unknown }).vipScope || "ALL");
      if (v === "VIP_VVIP") return ["VIP", "VVIP"] as ("VIP" | "VVIP")[];
      if (v === "VIP") return ["VIP"] as ("VIP" | "VVIP")[];
      if (v === "VVIP") return ["VVIP"] as ("VIP" | "VVIP")[];
      return null;
    })(),
    allowSubscriptionType: body.membersOnly ? "KURLY_MEMBERS" : null,
  };

  if (oauthErr) return Response.json({ error: `lacms 로그인 실패: ${oauthErr}` }, { status: 400 });
  if (!input.jwtToken) return Response.json({ error: "JWT 토큰 필수 (lacms 이메일/패스워드 또는 수동 입력)" }, { status: 400 });
  // X-KURLY-CMS-USER 는 일단 옵션 — 비어있으면 헤더 생략하고 시도, 401 나면 사용자에게 안내

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send("start", { total: input.count, concurrency: input.concurrency });
        const results = await createCouponsBatch(input, (done, total, latest) => {
          send("progress", { done, total, latest });
        });
        const okCount = results.filter((r) => r.ok).length;
        send("done", { results, okCount, failCount: results.length - okCount });
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
