import { NextRequest } from "next/server";
import { lacmsLoginForCoupon } from "@/lib/test-data-coupon";
import { createCouponPack, type CouponPackInput, type PackIssueType } from "@/lib/test-data-coupon-pack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/test-data/coupon-pack — 쿠폰팩 생성 + 발급 풀체인 (SSE)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, any>;

  // lacms 이메일/PW → server-side OAuth (없으면 수동 jwtToken fallback)
  let jwtToken = String(body.jwtToken || "").trim();
  let oauthErr: string | null = null;
  if (body.lacmsEmail && body.lacmsPassword) {
    try {
      const oauth = await lacmsLoginForCoupon(String(body.lacmsEmail).trim(), String(body.lacmsPassword));
      if (oauth.token) jwtToken = oauth.token;
      else oauthErr = oauth.error ?? "OAuth 응답에 access_token 없음";
    } catch (err) { oauthErr = err instanceof Error ? err.message : String(err); }
  }
  if (oauthErr) return Response.json({ error: `lacms 로그인 실패: ${oauthErr}` }, { status: 400 });
  if (!jwtToken) return Response.json({ error: "JWT 토큰 필수 (lacms 이메일/패스워드 또는 수동 입력)" }, { status: 400 });

  // 묶을 쿠폰 발행 ID들 — 배열 또는 "구분자" 문자열, 양수 정수만
  const couponPublishIds: number[] = (() => {
    const raw = body.couponPublishIds;
    const arr = Array.isArray(raw) ? raw.map(String) : (typeof raw === "string" ? raw.split(/[\s,]+/) : []);
    return [...new Set(arr.map((s: string) => s.trim()).filter((s: string) => /^\d+$/.test(s)).map(Number))];
  })();
  if (couponPublishIds.length === 0) {
    return Response.json({ error: "묶을 쿠폰 발행 ID(coupon_publish_ids)를 1개 이상 입력하세요" }, { status: 400 });
  }

  const issueMemberNos: string[] = (() => {
    const raw = body.issueMemberNos;
    const arr = Array.isArray(raw) ? raw.map(String) : (typeof raw === "string" ? raw.split(/[\s,]+/) : []);
    return [...new Set(arr.map((s: string) => s.trim()).filter((s: string) => /^\d+$/.test(s)))].slice(0, 1000);
  })();

  const input: CouponPackInput = {
    jwtToken,
    cmsUser: String(body.cmsUser || "").trim() || undefined,
    name: String(body.name || "QA쿠폰팩").slice(0, 50),
    couponPublishIds,
    issueType: (["ADMIN", "DOWNLOAD"].includes(String(body.issueType)) ? body.issueType : "ADMIN") as PackIssueType,
    validDays: Math.max(1, Math.min(365, Number(body.validDays) || 7)),
    bundleUse: !!body.bundleUse,
    issueMemberNos: issueMemberNos.length > 0 ? issueMemberNos : undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        send("start", { name: input.name, issueType: input.issueType, count: input.couponPublishIds.length });
        const result = await createCouponPack(input, (msg, ok) => send("progress", { msg, ok }));
        send("done", { result });
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
