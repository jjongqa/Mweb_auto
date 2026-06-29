/**
 * 테스트 데이터 — 멤버스 강제 구독
 * POST /membership-internal/v1/admin/subscriptions/tickets/vip/subscribe
 *
 * 인증 불필요 (stg internal). 기존 회원에게 멤버스 구독 처리.
 */

const STG_URL = "https://gateway.cloud.stg.kurly.services/membership-internal/v1/admin/subscriptions/tickets/vip/subscribe";
const STG_UNSUBSCRIBE_URL = (memberNo: number | string) =>
  `https://gateway.cloud.stg.kurly.services/admin/member-membership/v1/cms/members/${memberNo}/subscriptions`;

// lacms OAuth login (쿠폰과 동일한 endpoint — 재사용)
const LACMS_OAUTH_URL = "https://gateway.cloud.stg.kurly.services/admin/oauth/token";
const LACMS_OAUTH_BASIC = "Y21zLWJhY2stb2ZmaWNlOmUwODEwYmIxLWY3MjEtNGI2OS05MTAyLWQ4MjMwMjMxNmI4Zg==";

async function lacmsLogin(email: string, password: string): Promise<{ token: string | null; error?: string }> {
  try {
    const params = new URLSearchParams({ grant_type: "password", username: email, password });
    const res = await fetch(LACMS_OAUTH_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Authorization": `Basic ${LACMS_OAUTH_BASIC}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "origin": "https://lacms2.stg.kurlycorp.kr",
        "referer": "https://lacms2.stg.kurlycorp.kr/",
      },
      body: params,
    });
    if (!res.ok) return { token: null, error: `OAuth HTTP ${res.status}` };
    const j = await res.json().catch(() => ({}));
    return { token: j.access_token ?? null, error: j.access_token ? undefined : "OAuth 응답에 access_token 없음" };
  } catch (err) {
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface MembershipSubscribeInput {
  memberNos: (number | string)[];  // 여러 회원 동시 처리
  productCd?: string;               // default "KM0001"
  ticketMetaId?: number;            // default 3 (1개월 무료이용권)
  benefitOptionId?: number;         // default 1
  registeredAt?: string;            // ISO without timezone (default 이번 달 1일)
  expiredAt?: string;               // ISO without timezone (default 이번 달 말일)
}

export interface MembershipSubscribeResult {
  index: number;
  memberNo: number | string;
  ok: boolean;
  status?: number;
  ticketId?: string | number | null;
  ticketName?: string | null;
  ticketStatus?: string | null;
  startSubscriptionDate?: string | null;
  nextSettlementDate?: string | null;
  error?: string;
}

export type MembershipStep = "SUBSCRIBE";
export interface MembershipProgressEvent {
  type: "product";
  productIndex: number;
  ok: boolean;
  message: string;
}

// ticketMetaId → 구독 개월 수 (기간 자동 계산용)
// 1: VVIP 6개월 / 2: VIP 6개월 / 3: 1개월 / 4: 2개월 / 5: 3개월 / 6: 4개월 / 7: 5개월
const TICKET_MONTHS: Record<number, number> = { 1: 6, 2: 6, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5 };

// 이번 달 1일 ~ N개월 후 말일 (timezone 없음)
function monthRange(months: number): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m + 1)}-01T00:00:00`;
  // m + months 의 다음 달 0일 = months 만큼 진행한 달의 말일
  const endDate = new Date(y, m + months, 0);
  const end = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T23:59:59`;
  return { start, end };
}

async function callOne(memberNo: number, body: any): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(STG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ ...body, memberNo }),
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: err instanceof Error ? err.message : String(err) };
  }
}

// ============== 해지 ==============

export interface MembershipUnsubscribeInput {
  memberNos: (number | string)[];
  lacmsEmail: string;
  lacmsPassword: string;
}

export interface MembershipUnsubscribeResult {
  index: number;
  memberNo: number | string;
  ok: boolean;
  status?: number;
  error?: string;
}

export async function unsubscribeMembershipBatch(
  input: MembershipUnsubscribeInput,
  onProgress?: (e: MembershipProgressEvent) => void
): Promise<{ results: MembershipUnsubscribeResult[]; oauthError?: string }> {
  const emit = (e: MembershipProgressEvent) => onProgress?.(e);

  // OAuth 로그인 1회 (모든 회원 공유)
  const oauth = await lacmsLogin(input.lacmsEmail, input.lacmsPassword);
  if (!oauth.token) {
    return { results: [], oauthError: oauth.error ?? "OAuth 토큰 발급 실패" };
  }
  const token = oauth.token;

  const results: MembershipUnsubscribeResult[] = [];
  for (let i = 0; i < input.memberNos.length; i++) {
    const idx = i + 1;
    const memberNoRaw = input.memberNos[i];
    const memberNo = Number(memberNoRaw);
    if (!memberNo || isNaN(memberNo)) {
      const r: MembershipUnsubscribeResult = { index: idx, memberNo: memberNoRaw, ok: false, error: "유효하지 않은 회원번호" };
      emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] ${memberNoRaw}: 유효하지 않은 회원번호` });
      results.push(r); continue;
    }

    try {
      const res = await fetch(STG_UNSUBSCRIBE_URL(memberNo), {
        method: "DELETE",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Authorization": `bearer ${token}`,
          "Origin": "https://lacms2.stg.kurlycorp.kr",
          "Referer": "https://lacms2.stg.kurlycorp.kr/",
        },
      });
      const result: MembershipUnsubscribeResult = { index: idx, memberNo, ok: res.ok, status: res.status };
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        result.error = `HTTP ${res.status}: ${t.slice(0, 200)}`;
        emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] ${memberNo}: ${result.error}` });
      } else {
        emit({ type: "product", productIndex: idx, ok: true, message: `[#${idx}] ${memberNo}: 해지 완료` });
      }
      results.push(result);
    } catch (err) {
      const result: MembershipUnsubscribeResult = {
        index: idx, memberNo, ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] ${memberNo}: ${result.error}` });
      results.push(result);
    }
  }

  return { results };
}

// ============== 구독 ==============

export async function subscribeMembershipBatch(
  input: MembershipSubscribeInput,
  onProgress?: (e: MembershipProgressEvent) => void
): Promise<MembershipSubscribeResult[]> {
  const emit = (e: MembershipProgressEvent) => onProgress?.(e);
  const ticketMetaId = input.ticketMetaId ?? 3;
  const months = TICKET_MONTHS[ticketMetaId] ?? 1;
  const range = monthRange(months);
  const baseBody = {
    productCd: input.productCd ?? "KM0001",
    ticketMetaId,
    registeredAt: input.registeredAt ?? range.start,
    expiredAt: input.expiredAt ?? range.end,
    benefitOptionId: input.benefitOptionId ?? 1,
  };

  const results: MembershipSubscribeResult[] = [];
  for (let i = 0; i < input.memberNos.length; i++) {
    const idx = i + 1;
    const memberNoRaw = input.memberNos[i];
    const memberNo = Number(memberNoRaw);
    if (!memberNo || isNaN(memberNo)) {
      const r: MembershipSubscribeResult = { index: idx, memberNo: memberNoRaw, ok: false, error: "유효하지 않은 회원번호" };
      emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] ${memberNoRaw}: 유효하지 않은 회원번호` });
      results.push(r); continue;
    }

    const r = await callOne(memberNo, baseBody);
    const result: MembershipSubscribeResult = { index: idx, memberNo, ok: false, status: r.status };
    if (!r.ok) {
      const msg = r.data?.message ?? JSON.stringify(r.data).slice(0, 200);
      result.error = `HTTP ${r.status}: ${msg}`;
      emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] ${memberNo}: ${result.error}` });
      results.push(result); continue;
    }
    result.ok = true;
    result.ticketId = r.data?.ticket?.id ?? null;
    result.ticketName = r.data?.ticket?.name ?? null;
    result.ticketStatus = r.data?.ticket?.status ?? null;
    result.startSubscriptionDate = r.data?.startSubscriptionDate ?? null;
    result.nextSettlementDate = r.data?.nextSettlementDate ?? null;
    emit({
      type: "product",
      productIndex: idx,
      ok: true,
      message: `[#${idx}] ${memberNo}: 구독 완료 (${r.data?.ticket?.name ?? "?"}, ticketId=${r.data?.ticket?.id ?? "?"})`,
    });
    results.push(result);
  }

  return results;
}
