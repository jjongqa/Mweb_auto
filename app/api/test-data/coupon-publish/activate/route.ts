import { NextRequest } from "next/server";
import { activatePublish, lacmsLoginForCoupon } from "@/lib/test-data-coupon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 생성된 쿠폰 발행들을 일괄 활성화(대기 → 활성). 생성 라우트와 동일하게 lacms OAuth 또는 JWT 직접 사용.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    lacmsEmail?: string; lacmsPassword?: string; jwtToken?: string; cmsUser?: string;
    ids?: (number | string)[];
  };

  let jwtToken = String(body.jwtToken || "").trim();
  let oauthErr: string | null = null;
  if (body.lacmsEmail && body.lacmsPassword) {
    try {
      const oauth = await lacmsLoginForCoupon(String(body.lacmsEmail).trim(), String(body.lacmsPassword));
      if (oauth.token) jwtToken = oauth.token;
      else oauthErr = oauth.error ?? "OAuth 응답에 access_token 없음";
    } catch (err) {
      oauthErr = err instanceof Error ? err.message : String(err);
    }
  }
  if (oauthErr) return Response.json({ error: `lacms 로그인 실패: ${oauthErr}` }, { status: 400 });
  if (!jwtToken) return Response.json({ error: "JWT 토큰 필수 (lacms 이메일/패스워드 또는 수동 입력)" }, { status: 400 });

  const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x) => x !== null && x !== undefined && x !== "");
  if (ids.length === 0) return Response.json({ error: "활성화할 발행 ID가 없습니다" }, { status: 400 });

  const auth = { jwtToken, cmsUser: String(body.cmsUser || "").trim() };
  const results: { id: number | string; ok: boolean; status: number; error?: string }[] = [];
  // 동시 5개씩
  const concurrency = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const r = await activatePublish(auth, id);
      results.push({ id, ...r });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));

  const okCount = results.filter((r) => r.ok).length;
  return Response.json({ results, okCount, failCount: results.length - okCount });
}
