/**
 * 테스트 데이터 — 회원 계정 생성
 * 컬리 stg member-main API 3단계 (send-auth → verify → join) 직접 호출.
 * dev gateway 의 stg mock 정책: mobileNumber=01011111111 / authCode=111111 고정, 같은 번호로 N건 가입 가능.
 */

const STG_BASE = "https://gateway.cloud.stg.kurly.services/member-main";
const STG_MEMBERSHIP_BASE = "https://gateway.cloud.stg.kurly.services/membership-internal";
const STG_MOBILE = "01011111111";
const STG_AUTH_CODE = "111111";

export interface AccountCreateInput {
  count: number;              // 생성 개수
  idPrefix: string;           // memberId / email local part (예: kurlytest)
  namePrefix: string;         // name 패턴 (예: 테스트유저)
  emailDomain: string;        // 이메일 도메인 (예: kurlytest.com)
  password: string;           // 비번 공통
  joinInflowType?: string;    // PC_WEB / MOBILE_WEB / ANDROID / IOS
  concurrency?: number;       // 동시 호출 수 (default 10)
  subscribeMembership?: boolean;  // 가입 후 멤버스 무료이용권 자동 구독
}

export interface AccountCreateResult {
  index: number;
  memberId: string;
  email: string;
  password: string;
  name: string;
  ok: boolean;
  status?: number;
  user_id?: string | number | null;
  error?: string;
  membershipOk?: boolean;
  membershipError?: string;
  membershipTicketId?: string | number | null;
}

interface OneAccountSpec {
  memberId: string;
  password: string;
  name: string;
  email: string;
  mobileNumber: string;
  joinInflowType: string;
}

// v1.7 mobileNumber 별 직렬 처리 — stg mock 인증 상태가 동시 호출 시 race 라서.
const mobileLock = new Map<string, Promise<unknown>>();
function withMobileLock<T>(mobileNumber: string, fn: () => Promise<T>): Promise<T> {
  const prev = mobileLock.get(mobileNumber) ?? Promise.resolve();
  const next = prev.then(fn, fn);  // 이전 에러 무관하게 다음 실행
  mobileLock.set(mobileNumber, next.catch(() => {}));
  return next as Promise<T>;
}

async function callJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    });
    const status = res.status;
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    return { ok: res.ok, status, data };
  } catch (err) {
    return { ok: false, status: 0, data: err instanceof Error ? err.message : String(err) };
  }
}

async function createOne(idx: number, spec: OneAccountSpec, maxAttempts = 3, subscribe: boolean = false): Promise<AccountCreateResult> {
  // mobileNumber 별 lock — 같은 번호 호출은 순차로만
  const result = await withMobileLock(spec.mobileNumber, () => createOneInner(idx, spec, maxAttempts));
  if (result.ok && subscribe && result.user_id != null) {
    const sub = await subscribeFreeMembership(result.user_id);
    result.membershipOk = sub.ok;
    result.membershipTicketId = sub.ticketId ?? null;
    if (!sub.ok) result.membershipError = sub.error;
  }
  return result;
}

async function createOneInner(idx: number, spec: OneAccountSpec, maxAttempts: number): Promise<AccountCreateResult> {
  const base = {
    index: idx,
    memberId: spec.memberId,
    email: spec.email,
    password: spec.password,
    name: spec.name,
  };
  let lastError = "";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 1. SMS 인증 발송
    const send = await callJson(`${STG_BASE}/v1/member/sign-up/send/auth-code`, { mobileNumber: spec.mobileNumber });
    if (send.status >= 500) {
      lastError = `send-auth-code 실패: ${JSON.stringify(send.data).slice(0, 200)}`;
      lastStatus = send.status;
      await sleep(200 * attempt);
      continue;
    }
    // 2. 인증번호 검증
    const verify = await callJson(`${STG_BASE}/v1/member/sign-up/verify/auth-code`, {
      mobileNumber: spec.mobileNumber,
      authCode: STG_AUTH_CODE,
    });
    if (verify.status >= 400) {
      lastError = `verify-auth-code 실패 (시도 ${attempt}/${maxAttempts}): ${JSON.stringify(verify.data).slice(0, 200)}`;
      lastStatus = verify.status;
      await sleep(300 * attempt);
      continue;
    }
    // 3. 실제 가입
    const join = await callJson(`${STG_BASE}/v1/member/join`, {
    memberId: spec.memberId,
    password: spec.password,
    name: spec.name,
    email: spec.email,
    mobileNumber: spec.mobileNumber,
    // fixed defaults
    numberAddress: "서울 강남구 역삼동 647-14",
    roadAddress: "서울 강남구 테헤란로 133 (한국타이어빌딩)",
    subAddress: "15층",
    zoneCode: "06133",
    zipCode: "135502",
    baseAddressType: "ROAD_ADDRESS",
    gender: "MALE",
    birthDay: "0101",
    birthYear: "2000",
    joinInflowType: spec.joinInflowType,
    inflowType: "MOBILE_SHOP",
    joinProvider: "KURLY",
    isAgreeRequiredTermsCondition: true,
    isAgreeRequiredTermsOfPrivacy: true,
    isAgreeOptionalTermsOfPrivacy: true,
    isAgreeOptionalTermsOfSms: true,
    isAgreeOptionalTermsOfMailing: true,
    isAgreeOptionTermsOfMktConsent: true,
    referralCode: null,
    referralChannel: null,
  });
    // HTTP 4xx/5xx 또는 응답 body 의 success:false 둘 다 실패 처리
    const httpFailed = !join.ok;
    const bodySuccess = join.data?.success;  // true / false / undefined
    const bodyFailed = bodySuccess === false;
    if (httpFailed || bodyFailed) {
      const msg = JSON.stringify(join.data ?? "").slice(0, 300);
      const retryable = /휴대폰 인증|인증.*완료|auth|verify/i.test(msg);
      lastError = `join 실패 (시도 ${attempt}/${maxAttempts}, HTTP ${join.status}): ${msg}`;
      lastStatus = join.status;
      if (retryable && attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }
      return { ...base, ok: false, status: join.status, error: lastError };
    }
    // 성공 — memberNo 추출 (응답 패턴: {success:true, data:{memberNo, ...}})
    const userId =
      join.data?.data?.memberNo ??
      join.data?.memberNo ??
      join.data?.data?.memberId ??
      join.data?.memberId ??
      join.data?.userId ??
      join.data?.id ??
      null;
    return { ...base, ok: true, status: join.status, user_id: userId };
  }
  return { ...base, ok: false, status: lastStatus, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 이번 달 1일 00:00:00 ~ 말일 23:59:59 (timezone 표기 없는 format — Postman 캡쳐 동일)
function thisMonthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m + 1)}-01T00:00:00`;
  const endDay = new Date(y, m + 1, 0).getDate();
  const end = `${y}-${pad(m + 1)}-${pad(endDay)}T23:59:59`;
  return { start, end };
}

// 멤버스 무료이용권 강제 구독 (인증 불필요 — stg internal API)
async function subscribeFreeMembership(memberNo: number | string): Promise<{ ok: boolean; status: number; ticketId?: any; error?: string }> {
  const { start, end } = thisMonthRange();
  const body = {
    memberNo: typeof memberNo === "string" ? Number(memberNo) : memberNo,
    productCd: "KM0001",
    ticketMetaId: 3,
    registeredAt: start,
    expiredAt: end,
    benefitOptionId: 1,
  };
  const r = await callJson(`${STG_MEMBERSHIP_BASE}/v1/admin/subscriptions/tickets/vip/subscribe`, body);
  if (!r.ok) {
    return { ok: false, status: r.status, error: `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` };
  }
  return { ok: true, status: r.status, ticketId: r.data?.ticket?.id ?? null };
}

// 병렬 실행 (worker pool 패턴)
export async function createAccountsBatch(
  input: AccountCreateInput,
  onProgress?: (done: number, total: number, latest: AccountCreateResult) => void
): Promise<AccountCreateResult[]> {
  const total = Math.max(1, Math.min(500, input.count | 0));
  const concurrency = Math.max(1, Math.min(20, (input.concurrency ?? 10) | 0));
  const results: AccountCreateResult[] = new Array(total);
  let done = 0;

  const specs: OneAccountSpec[] = [];
  // memberId 길이 제한 — 컬리 정책 추정 ≤ 12자. prefix 짧게 + stamp 3자 + N
  // 예: "kurly" (5) + "abc" (3) + "100" (3) = 11자 ✓
  const stamp = Date.now().toString(36).slice(-3);
  for (let i = 0; i < total; i++) {
    const n = i + 1;
    const memberId = `${input.idPrefix}${stamp}${n}`.slice(0, 12);
    specs.push({
      memberId,
      password: input.password || "TestPwd1234!",
      name: `${input.namePrefix}${n}`,
      email: `${input.idPrefix}${stamp}${n}@${input.emailDomain}`,
      mobileNumber: STG_MOBILE,
      joinInflowType: input.joinInflowType || "MOBILE_WEB",
    });
  }

  // worker pool
  let cursor = 0;
  const subscribe = !!input.subscribeMembership;
  async function worker() {
    while (true) {
      const myIdx = cursor++;
      if (myIdx >= total) return;
      const r = await createOne(myIdx + 1, specs[myIdx], 3, subscribe);
      results[myIdx] = r;
      done++;
      onProgress?.(done, total, r);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
