/**
 * 테스트 데이터 — 프로모션 확정 (쫑카 연동 명세 기반)
 *
 * 흐름:
 *   1. lacms OAuth 로그인 → JWT
 *   2. STEP 1: GET /v1/promotions (90일 창 스캔) → promotionId
 *   3. STEP 2: PUT /v1/promotions/confirm → 확정
 */

const STG_BASE = "https://gateway.cloud.stg.kurly.services/admin/partner-promotion";
const LIST_URL = `${STG_BASE}/v1/promotions`;
const CONFIRM_URL = `${STG_BASE}/v1/promotions/confirm`;

// lacms OAuth login
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

function buildPromotionUserHeader(email: string, name: string, groupType: string): string {
  const claims = { email, name, groupType };
  // Node Buffer 사용 (server-side)
  return Buffer.from(JSON.stringify(claims), "utf-8").toString("base64");
}

function fmtDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface PromotionConfirmInput {
  lacmsEmail: string;
  lacmsPassword: string;
  promotionUserName: string;       // promotion-user 헤더의 name (default 이메일 local part)
  promotionUserGroupType: string;  // default "Marketing_ALL"
  promotionCodes: string[];        // 여러 개 동시 가능
}

export interface PromotionConfirmResult {
  index: number;
  code: string;
  promotionId?: number | null;
  promotionTitle?: string | null;
  reviewStatus?: string | null;
  confirmed: boolean;
  searchedWindows?: number;        // 스캔한 90일 창 개수
  error?: string;
}

export interface PromotionProgressEvent {
  type: "step" | "product";
  step?: "OAUTH" | "SEARCH" | "CONFIRM";
  productIndex?: number;
  ok: boolean;
  message: string;
}

// 90일 창을 단계적으로 확장 (최근 → 과거 → 미래)
function searchWindows(): { start: Date; end: Date }[] {
  const now = new Date();
  const windows: { start: Date; end: Date }[] = [];
  // 1. 오늘 기준 -60 ~ +30 (최근)
  windows.push({
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30, 23, 59, 59),
  });
  // 2. -150 ~ -60 (조금 더 과거)
  windows.push({
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 150),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60),
  });
  // 3. -240 ~ -150
  windows.push({
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 240),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 150),
  });
  // 4. +30 ~ +120 (미래)
  windows.push({
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 120, 23, 59, 59),
  });
  return windows;
}

async function findPromotionId(token: string, promotionUser: string, code: string): Promise<{ id: number | null; title?: string; status?: string; windowsTried: number; error?: string }> {
  const windows = searchWindows();
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const params = new URLSearchParams({
      periodSearchType: "PROMOTION_START_DATE",
      searchStartAt: fmtDateTime(w.start),
      searchEndAt: fmtDateTime(w.end),
      keywordSearchType: "PROMOTION_CODE",
      keywordSearchText: code,
      reviewStatusSearchType: "ALL",
      eventSearchType: "ALL",
      applierSearchType: "ALL_SUPPLIERS_1P",
      siteSearchTypes: "ALL_SITE",
      approvalProcessSearchType: "ALL",
      onsiteMarketerEmails: "",
      targetProductMerchandiserIds: "",
      sortType: "RECENT_MODIFIED_AT_DESCENDING",
      page: "0",
      size: "100",
    });
    const res = await fetch(`${LIST_URL}?${params}`, {
      method: "GET",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Authorization": `Bearer ${token}`,
        "promotion-user": promotionUser,
        "origin": "https://lacms2.stg.kurlycorp.kr",
        "referer": "https://lacms2.stg.kurlycorp.kr/",
      },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { id: null, windowsTried: i + 1, error: `검색 HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    const j = await res.json().catch(() => ({}));
    const content: any[] = j?.data?.content ?? [];
    const match = content.find((p) => p.promotionCode === code);
    if (match) {
      return {
        id: match.id,
        title: match.title,
        status: match.reviewStatus?.code,
        windowsTried: i + 1,
      };
    }
  }
  return { id: null, windowsTried: windows.length, error: "90일 창 4개 (-240 ~ +120) 모두 스캔했지만 못 찾음" };
}

async function confirmPromotions(token: string, promotionUser: string, promotionIds: number[]): Promise<{ ok: boolean; confirmedIds?: number[]; error?: string }> {
  const res = await fetch(CONFIRM_URL, {
    method: "PUT",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Authorization": `Bearer ${token}`,
      "promotion-user": promotionUser,
      "Content-Type": "application/json",
      "origin": "https://lacms2.stg.kurlycorp.kr",
      "referer": "https://lacms2.stg.kurlycorp.kr/",
    },
    body: JSON.stringify({ promotionIds }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, error: `확정 HTTP ${res.status}: ${t.slice(0, 200)}` };
  }
  const j = await res.json().catch(() => ({}));
  if (j?.code !== "0000") {
    return { ok: false, error: `code=${j?.code} message=${j?.message}` };
  }
  return { ok: true, confirmedIds: j?.data?.promotionIds ?? [] };
}

export async function confirmPromotionsBatch(
  input: PromotionConfirmInput,
  onProgress?: (e: PromotionProgressEvent) => void
): Promise<{ results: PromotionConfirmResult[]; oauthError?: string }> {
  const emit = (e: PromotionProgressEvent) => onProgress?.(e);

  // STEP 0: OAuth 로그인
  emit({ type: "step", step: "OAUTH", ok: true, message: "lacms OAuth 로그인" });
  const oauth = await lacmsLogin(input.lacmsEmail, input.lacmsPassword);
  if (!oauth.token) {
    emit({ type: "step", step: "OAUTH", ok: false, message: oauth.error ?? "OAuth 실패" });
    return { results: [], oauthError: oauth.error };
  }
  const token = oauth.token;
  const promotionUser = buildPromotionUserHeader(input.lacmsEmail, input.promotionUserName, input.promotionUserGroupType);
  emit({ type: "step", step: "OAUTH", ok: true, message: `OAuth 통과 + promotion-user 헤더 생성` });

  const results: PromotionConfirmResult[] = [];
  for (let i = 0; i < input.promotionCodes.length; i++) {
    const idx = i + 1;
    const code = input.promotionCodes[i].trim();
    const result: PromotionConfirmResult = { index: idx, code, confirmed: false };
    if (!code) {
      result.error = "빈 코드";
      emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] 빈 코드 스킵` });
      results.push(result); continue;
    }

    // STEP 1: id 조회
    emit({ type: "product", step: "SEARCH", productIndex: idx, ok: true, message: `[#${idx}] ${code}: id 조회 중...` });
    const found = await findPromotionId(token, promotionUser, code);
    result.searchedWindows = found.windowsTried;
    if (!found.id) {
      result.error = found.error ?? "id 조회 실패";
      emit({ type: "product", step: "SEARCH", productIndex: idx, ok: false, message: `[#${idx}] ${code}: ${result.error}` });
      results.push(result); continue;
    }
    result.promotionId = found.id;
    result.promotionTitle = found.title;
    result.reviewStatus = found.status;
    emit({ type: "product", step: "SEARCH", productIndex: idx, ok: true, message: `[#${idx}] ${code}: id=${found.id} (${found.title ?? "?"}, ${found.status ?? "?"})` });

    // STEP 2: 확정
    const conf = await confirmPromotions(token, promotionUser, [found.id]);
    if (!conf.ok) {
      result.error = conf.error;
      emit({ type: "product", step: "CONFIRM", productIndex: idx, ok: false, message: `[#${idx}] ${code}: ${result.error}` });
      results.push(result); continue;
    }
    result.confirmed = true;
    emit({ type: "product", step: "CONFIRM", productIndex: idx, ok: true, message: `[#${idx}] ${code}: 확정 완료 (id=${found.id})` });
    results.push(result);
  }

  return { results };
}
