/**
 * 테스트 데이터 — 쿠폰 발행(coupon-publishes) N건 생성
 * stg lacms admin gateway. Authorization(JWT) + X-KURLY-CMS-USER 두 헤더 필요.
 */

const STG_BASE = "https://gateway.cloud.stg.kurly.services/admin/marketing-coupon-api";
const COST_SETTLEMENT_CODE_DEFAULT = "VD4549_240726_Cr4gx";  // 사용자 캡쳐 기반 default
const LACMS_OAUTH_URL = "https://gateway.cloud.stg.kurly.services/admin/oauth/token";
const LACMS_OAUTH_BASIC = "Y21zLWJhY2stb2ZmaWNlOmUwODEwYmIxLWY3MjEtNGI2OS05MTAyLWQ4MjMwMjMxNmI4Zg==";
const LACMS_ORIGIN = "https://lacms2.stg.kurlycorp.kr";

export async function lacmsLoginForCoupon(email: string, password: string): Promise<{ token: string | null; error?: string }> {
  try {
    const params = new URLSearchParams({ grant_type: "password", username: email, password });
    const res = await fetch(LACMS_OAUTH_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Authorization": `Basic ${LACMS_OAUTH_BASIC}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "origin": LACMS_ORIGIN,
        "referer": LACMS_ORIGIN + "/",
        "page-url": "/signin",
      },
      body: params,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { token: null, error: `HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    const j = await res.json().catch(() => ({}));
    return { token: j.access_token ?? null, error: j.access_token ? undefined : "응답에 access_token 없음" };
  } catch (err) {
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export type CouponType = "CART" | "PRODUCT" | "FREE_SHIPPING";
export type BenefitType = "PRICE_DISCOUNT" | "PERCENT_DISCOUNT" | "FREE_SHIPPING";
export type IssueType = "ADMIN" | "DOWNLOAD" | "AUTO";

export interface CouponCreateInput {
  jwtToken: string;            // bearer JWT (필수)
  cmsUser?: string;            // X-KURLY-CMS-USER — OAuth 토큰 사용 시 옵션, 수동 JWT 시 필요할 수 있음
  count: number;
  namePrefix: string;
  description?: string;
  couponType: CouponType;
  issueType: IssueType;
  benefitType: BenefitType;
  benefitValue: number;
  maxDiscountPrice?: number;
  validDays?: number;          // 사용 기간 (일) — default 7
  concurrency?: number;
  issueMemberNos?: string[];   // 지정 시: 생성 직후 이 회원들에게 발급(운영자 발급). issueType 은 ADMIN 권장.

  // ── 노출 ──
  exposed?: boolean;           // 발급 목록 노출 여부 → coupon_meta.exposed (default false)
  exposeImageUrl?: string;     // 노출 이미지 경로 → expose_meta.image_url (exposed=true면 필수, 비면 기본 경로)
  exposeKeyword?: string;      // 노출 키워드 → download_condition.keyword (exposed=true면 이 키워드로 다운로드. 비면 자동)

  // ── 사용조건 (coupon_meta.hurdle / coupon_meta.target) ──
  minOrderAmount?: number;     // 최소 주문 금액 → hurdle.price (0/미입력이면 미적용)
  minOrderQty?: number;        // 최소 주문 수량 → hurdle.quantity (default 1)
  onlyApp?: boolean;           // 앱 전용 → hurdle.only_app (default false)
  allowDiscountedProducts?: boolean; // 할인 상품에도 사용 가능 → target.disallow_discounted_products = !이값 (default true=허용)
  // 주문조건 대상 → hurdle_type (전체=ORDERED_PRODUCT / 컬렉션=ALLOWED_COLLECTION / 카테고리=ALLOWED_CATEGORY / 상품=ALLOWED_PRODUCT / 적용대상동일=TARGET_PRODUCT)
  hurdleTarget?: "ALL" | "COLLECTION" | "CATEGORY" | "PRODUCT" | "SAME";
  hurdleCodes?: string[];      // 컬렉션/카테고리/상품 코드 목록 (대상별 allowed_* 에 매핑)

  // ── 발급조건 (download_condition · DOWNLOAD 발급일 때만 적용) ──
  downloadType?: "ACCESS_KEY" | "KEYWORD" | "RANDOM_CODE"; // 발급방법(다운로드 발급 유형). 노출=true면 KEYWORD 강제
  randomCodeQuantity?: number;          // RANDOM_CODE 발급 수량 → random_code_issue_quantity
  memberMaxIssue?: number | null;       // 회원당 발급수 → member_max_issue (default 1, null=무제한)
  allowBizMember?: boolean;             // 사업자(B2B) 회원 허용 → allow_biz_member (default false)
  allowVipTypes?: ("VIP" | "VVIP")[] | null; // VIP 한정 → allow_vip_types (default null=제한없음)
  allowSubscriptionType?: string | null;     // 멤버스 한정 → allow_subscription_type ("KURLY_MEMBERS" | null)
}

export interface CouponCreateResult {
  index: number;
  publishName: string;
  couponName: string;
  ok: boolean;
  status?: number;
  coupon_publish_id?: number | string | null;
  error?: string;
  issued?: boolean;                  // 회원 발급까지 성공
  issuedCount?: number | null;       // target/file 저장된 대상 수
  issueError?: string;               // 발급 단계 실패 사유
  keyword?: string;                  // 노출 쿠폰의 다운로드 키워드 (exposed=true 일 때) — 이걸로 받기 테스트
  activated?: boolean;               // 발급 활성화(대기→활성) 완료 — "활성화" 버튼으로 갱신
}

async function callJson(url: string, body: unknown, headers: Record<string, string>): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json", ...headers },
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

function fmtLocal(d: Date): string {
  // "2026-06-11T08:48:00" 형식 (timezone 표기 없음, lacms 캡쳐와 동일)
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildBody(input: CouponCreateInput, n: number, stamp: string) {
  const couponName = `${input.namePrefix}_${stamp}_${n}`.slice(0, 50);
  const publishName = couponName;
  // 노출(KEYWORD 다운로드) 키워드 — 정책상 공백·특수문자 불가(문서 예시 "키워드"=한글), 한글/영문/숫자만.
  // 사용자 입력 우선(여러 건이면 끝에 번호로 중복 방지), 비우면 쿠폰명 기반 자동 생성.
  const userKw = (input.exposeKeyword ?? "").replace(/[^가-힣A-Za-z0-9]/g, "");
  const total = Math.max(1, Math.min(100, input.count | 0));
  const keyword = userKw
    ? (total > 1 ? `${userKw}${n}`.slice(0, 20) : userKw.slice(0, 20))
    : (couponName.replace(/[^가-힣A-Za-z0-9]/g, "").slice(0, 20) || `QAKW${stamp}${n}`);
  const days = Math.max(1, Math.min(365, input.validDays ?? 7));
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // 발급방법(다운로드 발급 유형) — 노출이면 KEYWORD 강제(노출은 키워드 다운로드만 가능).
  const dlType = input.issueType === "DOWNLOAD"
    ? (input.exposed ? "KEYWORD" : (input.downloadType ?? "ACCESS_KEY"))
    : null;

  // 주문조건 대상 → hurdle_type + allowed_* 매핑.
  const hTarget = input.hurdleTarget ?? "ALL";
  const hCodes = (input.hurdleCodes ?? []).map((c) => String(c).trim()).filter(Boolean);
  const hurdleType =
    hTarget === "COLLECTION" ? "ALLOWED_COLLECTION" :
    hTarget === "CATEGORY" ? "ALLOWED_CATEGORY" :
    hTarget === "PRODUCT" ? "ALLOWED_PRODUCT" :
    hTarget === "SAME" ? "TARGET_PRODUCT" :
    "ORDERED_PRODUCT"; // ALL(전체)
  const hurdle: Record<string, unknown> = {
    hurdle_type: hurdleType,
    quantity: Math.max(1, input.minOrderQty ?? 1),
    // 최소 주문 금액 — 0/미입력이면 필드 생략
    ...(input.minOrderAmount && input.minOrderAmount > 0 ? { price: Math.floor(input.minOrderAmount) } : {}),
    allowed_products: hTarget === "PRODUCT" ? hCodes.map((c) => ({ product_no: c, name: c })) : [],
    allowed_categories: hTarget === "CATEGORY" ? hCodes.map((c) => ({ code: c })) : [],
    allowed_collections: hTarget === "COLLECTION" ? hCodes.map((c) => ({ code: c })) : [],
    allowed_collection_groups: [],
    only_app: input.onlyApp ?? false,
  };

  // FREE_SHIPPING 은 value 없음 — 무료배송 그 자체
  const isFreeShipping = input.couponType === "FREE_SHIPPING";
  const benefit: Record<string, unknown> = isFreeShipping
    ? { benefit_type: "FREE_SHIPPING" }
    : { benefit_type: input.benefitType, value: input.benefitValue };
  if (!isFreeShipping && input.benefitType === "PERCENT_DISCOUNT" && input.maxDiscountPrice) {
    benefit.maximum_discount_price = input.maxDiscountPrice;
  }

  const body: Record<string, unknown> = {
    publish_name: publishName,
    coupon_meta: {
      coupon_type: input.couponType,
      coupon_name: couponName,
      description: input.description || `QA 테스트 쿠폰 ${n}`,
      stackable: false,
      exposed: input.exposed ?? false,    // 발급 목록 노출 여부
      benefit,
      target: {
        site_type: "ALL",
        // PRODUCT 쿠폰은 전체 판매자 (ALL) 만 가능 — KURLY 일 때 422
        sales_owner: input.couponType === "PRODUCT" ? "ALL" : "KURLY",
        target_scope: "ALL",
        is_kurly_only: false,
        allowed_collections: [],
        disallowed_collections: [],
        allowed_collection_groups: [],
        disallowed_collection_groups: [],
        // 사용조건: 할인 상품 사용 가능 여부 (allowDiscountedProducts 기본 true=허용 → disallow false)
        disallow_discounted_products: !(input.allowDiscountedProducts ?? true),
      },
      hurdle,
      effective_period_type: "STATIC",
      effective_period: {
        start_at: fmtLocal(now),
        end_at: fmtLocal(end),
      },
      effective_hour: 24,
    },
    cost_settlement: {
      cost_settlement_types: ["FIRST_PARTNER"],
      reason1: "프로모션",
      reason2: "빅프로모션",
      sharing_ratio: 0,
      cost_settlement_code: COST_SETTLEMENT_CODE_DEFAULT,
      budget_cost: null,
    },
    issue_type: input.issueType,
    publish_period: {
      start_at: fmtLocal(now),
      end_at: fmtLocal(end),
    },
    // 노출(exposed=true)이면 노출 이미지가 필수 — 비어 있으면 API 문서 예시 경로로 기본값.
    expose_meta: { image_url: (input.exposed ? (input.exposeImageUrl?.trim() || "coupon/thumbs/coupon1.png") : (input.exposeImageUrl?.trim() || "")) },
  };

  // 다운로드 발급 쿠폰은 download_condition 필수. 발급방법(dlType)=ACCESS_KEY/KEYWORD/RANDOM_CODE.
  // ⚠️ 노출(exposed)=true면 KEYWORD 강제 + 발급 사용조건은 멤버스/없음만(VIP·사업자 한정 강제 해제).
  if (input.issueType === "DOWNLOAD") {
    const memberMax = input.memberMaxIssue === undefined ? 1 : input.memberMaxIssue;
    const dc: Record<string, unknown> = {
      download_condition_type: dlType,
      member_max_issue: memberMax,
      allow_biz_member: input.exposed ? false : (input.allowBizMember ?? false),
      last_sale_condition: { last_sale_condition_type: "ALL", last_sale_condition_purchase_type: "ALL" },
      allow_vip_types: input.exposed ? null : (input.allowVipTypes ?? null),
      allow_subscription_type: input.allowSubscriptionType ?? null,
      max_budget_cost: null,
    };
    if (dlType === "KEYWORD") dc.keyword = keyword;                                   // 키워드 다운로드
    if (dlType === "RANDOM_CODE") dc.random_code_issue_quantity = Math.max(1, Math.floor(input.randomCodeQuantity ?? 100)); // 난수코드 수량
    body.download_condition = dc;
  }

  // 결과에 노출할 키워드는 실제 KEYWORD 발급일 때만
  const usedKeyword = dlType === "KEYWORD" ? keyword : undefined;
  return { publishName, couponName, keyword: usedKeyword, body };
}

// 공통 인증 헤더 (생성·발급·활성화 동일) — bearer JWT + lacms origin/referer (+옵션 cms-user)
function authHeaders(input: { jwtToken: string; cmsUser?: string }): Record<string, string> {
  const h: Record<string, string> = {
    "authorization": `bearer ${input.jwtToken}`,
    "origin": "https://lacms2.stg.kurlycorp.kr",
    "referer": "https://lacms2.stg.kurlycorp.kr/",
  };
  if (input.cmsUser) h["x-kurly-cms-user"] = input.cmsUser;
  return h;
}

// 발급대상 저장 — 회원번호 CSV(헤더 "회원번호" + 줄당 1개)를 multipart 'file' 로 업로드.
async function saveIssueTargets(input: CouponCreateInput, publishId: number | string, memberNos: string[]): Promise<{ ok: boolean; count?: number | null; error?: string }> {
  try {
    const csv = "회원번호\n" + memberNos.join("\n") + "\n";
    const fd = new FormData();
    fd.append("file", new Blob([csv], { type: "text/csv" }), "targets.csv");
    const res = await fetch(`${STG_BASE}/v3/admin/coupon-publishes/${publishId}/target/file`, {
      method: "POST",
      headers: authHeaders(input),   // Content-Type 은 FormData 가 multipart boundary 로 자동 설정
      body: fd,
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    if (!res.ok || data?.success === false) return { ok: false, error: `target/file HTTP ${res.status}: ${JSON.stringify(data ?? "").slice(0, 300)}` };
    return { ok: true, count: data?.data?.count ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 운영자 발급 — body 없음. 발급대상 저장 후 호출.
async function issuePublish(input: CouponCreateInput, publishId: number | string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${STG_BASE}/v3/admin/coupon-publishes/${publishId}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json", ...authHeaders(input) },
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    if (!res.ok || data?.success === false) return { ok: false, error: `issue HTTP ${res.status}: ${JSON.stringify(data ?? "").slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 발급 활성화 — 대기(STAND_BY) → 활성. body 없음. (쿠폰팩 activate 와 동일 패턴)
//   POST /v3/admin/coupon-publishes/{id}/activate
export async function activatePublish(
  auth: { jwtToken: string; cmsUser?: string },
  publishId: number | string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(`${STG_BASE}/v3/admin/coupon-publishes/${publishId}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json", ...authHeaders(auth) },
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    if (!res.ok || data?.success === false) {
      return { ok: false, status: res.status, error: `활성화 실패 (HTTP ${res.status}): ${JSON.stringify(data ?? "").slice(0, 200)}` };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function createOne(idx: number, input: CouponCreateInput, stamp: string): Promise<CouponCreateResult> {
  const { publishName, couponName, keyword, body } = buildBody(input, idx, stamp);
  const base = { index: idx, publishName, couponName, keyword };
  const res = await callJson(`${STG_BASE}/v3/admin/coupon-publishes`, body, authHeaders(input));
  if (!res.ok || res.data?.success === false) {
    const msg = JSON.stringify(res.data ?? "").slice(0, 400);
    return { ...base, ok: false, status: res.status, error: `생성 실패 (HTTP ${res.status}): ${msg}` };
  }
  const id = res.data?.data?.id ?? res.data?.id ?? null;
  const result: CouponCreateResult = { ...base, ok: true, status: res.status, coupon_publish_id: id };

  // 회원 발급 (옵션) — 생성 성공 + 회원번호 지정 시: 발급대상 저장 → 운영자 발급
  const members = (input.issueMemberNos ?? []).filter(Boolean);
  if (members.length > 0) {
    if (id == null) { result.issueError = "발급 불가: 생성 응답에 publish id 없음"; return result; }
    const t = await saveIssueTargets(input, id, members);
    if (!t.ok) { result.issueError = `발급대상 저장 실패: ${t.error}`; return result; }
    const iss = await issuePublish(input, id);
    if (!iss.ok) { result.issueError = `발급 실패: ${iss.error}`; return result; }
    result.issued = true;
    result.issuedCount = t.count ?? members.length;
  }
  return result;
}

export async function createCouponsBatch(
  input: CouponCreateInput,
  onProgress?: (done: number, total: number, latest: CouponCreateResult) => void
): Promise<CouponCreateResult[]> {
  if (!input.jwtToken?.trim()) throw new Error("JWT 토큰(Authorization) 필수");
  // X-KURLY-CMS-USER 는 옵션 — OAuth 토큰만으로 통과하는지 시험 가능

  const total = Math.max(1, Math.min(100, input.count | 0));
  const concurrency = Math.max(1, Math.min(10, (input.concurrency ?? 5) | 0));
  const stamp = Date.now().toString(36).slice(-4);
  const results: CouponCreateResult[] = new Array(total);
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (true) {
      const myIdx = cursor++;
      if (myIdx >= total) return;
      const r = await createOne(myIdx + 1, input, stamp);
      results[myIdx] = r;
      done++;
      onProgress?.(done, total, r);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
