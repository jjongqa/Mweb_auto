/**
 * 테스트 데이터 — 1P (Kurly 직매입) 상품 생성
 * Python pms_master_product.py 의 TypeScript 포팅.
 *
 * 4단계 흐름:
 *   1. OAuth 로그인 (lacms ID/PW → access_token)
 *   2. 마스터 상품 생성 (POST /admin/pms/v1/product/masters)
 *   3. 콘텐츠 상품 생성 (POST /admin/pms/v1/product/contents)
 *   4. 재고 세팅 (PUT /admin/vsms/v2/stock/manage/set-n) — 9개 센터
 */

const STG_BASE = "https://gateway.cloud.stg.kurly.services";
const TOKEN_URL = `${STG_BASE}/admin/oauth/token`;
const MASTER_URL = `${STG_BASE}/admin/pms/v1/product/masters`;
const CONTENTS_URL = `${STG_BASE}/admin/pms/v1/product/contents`;
const STOCK_URL = `${STG_BASE}/admin/vsms/v2/stock/manage/set-n`;
const DISPLAY_LIST_URL = `${STG_BASE}/admin/dsms/v1/display/list`;
const DISPLAY_BULK_URL = `${STG_BASE}/admin/dsms/v1/display/contents/bulk`;

const CLIENT_ID = "cms-back-office";
const CLIENT_SECRET = "e0810bb1-f721-4b69-9102-d82302316b8f";
const DEFAULT_CENTERS = ["CC01", "CC02", "CC03", "CC04", "IC", "MC01", "MC02", "MC03", "MC04"];
const DEFAULT_THUMBNAIL = "https://product-image-stg.kurly.com/product/image/5010cd69-8b78-4aa7-baca-8b155fb50585.jpg";
const KURLY_SELLER_ID = 1;   // 1P 직매입 sellerId

export type StorageType = "AMBIENT_TEMPERATURE" | "COLD" | "FROZEN" | "ETC";

export interface Product1pInput {
  // 인증
  lacmsEmail: string;
  lacmsPassword: string;
  // 옵션
  count: number;
  namePrefix: string;
  basePrice: number;
  storageType: StorageType;
  stockQuantity: number;
  doMaster: boolean;
  doContents: boolean;
  doStock: boolean;
  doDisplay: boolean;  // La-CMS 전시 일괄
}

export interface Product1pResult {
  index: number;
  masterCode?: string | null;
  contentsNo?: string | number | null;
  dealProductNo?: string | number | null;  // 주문 시 필요
  contentsRawData?: any;  // dealProductNo 추출 못했을 때 디버깅용
  stockOk?: boolean;
  error?: string;
}

export type Step1p = "OAUTH" | "MASTER" | "CONTENTS" | "STOCK" | "DISPLAY";

export interface Progress1pEvent {
  type: "step" | "product";
  step?: Step1p;
  productIndex?: number;
  ok: boolean;
  message: string;
}

// ============== HTTP helper ==============

async function call(
  method: "POST" | "PUT" | "GET",
  url: string,
  headers: Record<string, string>,
  body?: any
): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      if (body instanceof URLSearchParams) {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        if (!("Content-Type" in headers) && !("content-type" in headers)) {
          headers["Content-Type"] = "application/json;charset=UTF-8";
        }
      }
    }
    const res = await fetch(url, init);
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: err instanceof Error ? err.message : String(err) };
  }
}

// ============== STEP 1: OAuth ==============

async function oauthLogin(email: string, password: string): Promise<{ token: string | null; error?: string }> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const params = new URLSearchParams({ grant_type: "password", username: email, password });
  const r = await call("POST", TOKEN_URL, {
    "Authorization": `Basic ${basic}`,
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  }, params);
  if (!r.ok) return { token: null, error: `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` };
  return { token: r.data?.access_token ?? null, error: r.data?.access_token ? undefined : "응답에 access_token 없음" };
}

// ============== STEP 2: Master ==============

function buildMasterBody(name: string, basePrice: number, storageType: StorageType) {
  return {
    masterProductName: name,
    categoryIds: [2, 3, 37, 228],  // 가구/인테리어
    taxType: "TAX",
    productCondition: "NEW",
    basePrice,
    fulfillmentId: 1,
    isAdult: false,
    isUse: true,
    isDeliveryProduct: true,
    sellerId: 1,
    storageType,
    mdNo: 256,
    supplyInfo: { supplierId: 1, price: 0 },
    productNotice: {
      templateId: "624e770f8d62d962dc3df41a",
      isFreeTemplate: false,
      noticeItems: [
        { type: "PN00", seq: 0, title: "제품명", description: "상품설명 및 상품이미지 참조" },
        { type: "PN01", seq: 1, title: "식품의 유형", description: "상품설명 및 상품이미지 참조" },
        { type: "PN02", seq: 2, title: "생산자 및 소재지", description: "상품설명 및 상품이미지 참조" },
        { type: "PN03", seq: 3, title: "제조연월일, 소비기한 또는 품질유지기한", description: "상품설명 및 상품이미지 참조" },
        { type: "PN04", seq: 4, title: "포장단위별 내용물의 용량(중량), 수량", description: "상품설명 및 상품이미지 참조" },
        { type: "PN05", seq: 5, title: "원재료명 및 함량", description: "상품설명 및 상품이미지 참조" },
        { type: "PN06", seq: 6, title: "영양성분", description: "상품설명 및 상품이미지 참조" },
        { type: "PN07", seq: 7, title: "유전자변형식품에 해당하는 경우의 표시", description: "상품설명 및 상품이미지 참조" },
        { type: "PN08", seq: 8, title: "소비자 안전을 위한 주의사항", description: "상품설명 및 상품이미지 참조" },
        { type: "PN09", seq: 9, title: "수입식품 문구", description: "상품설명 및 상품이미지 참조" },
        { type: "PN10", seq: 10, title: "소비자 상담 관련 전화번호", description: "상품설명 및 상품이미지 참조" },
      ],
    },
    measurement: { totalQuantityValue: 100, quantityUnit: "ml", isManual: true },
    thumbnails: {
      thumbnailImages: [DEFAULT_THUMBNAIL],
      shareImage: null,
      dealOptionImage: null,
    },
  };
}

async function createMaster(token: string, name: string, basePrice: number, storageType: StorageType): Promise<{ code: string | null; error?: string }> {
  const r = await call("POST", MASTER_URL, {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
  }, buildMasterBody(name, basePrice, storageType));
  if (!r.ok || r.data?.success === false) {
    const msg = r.data?.message ?? JSON.stringify(r.data).slice(0, 200);
    const detail = r.data?.data && typeof r.data.data === "object"
      ? " / " + Object.entries(r.data.data).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "";
    return { code: null, error: `HTTP ${r.status}: ${msg}${detail}` };
  }
  return { code: r.data?.data?.masterProductCode ?? null };
}

// ============== STEP 3: Contents ==============

function buildDeal(dealName: string, masterCode: string, seq: number) {
  return {
    dealProductName: dealName,
    masterProductCode: masterCode,
    seq,
    isExcludeRepresent: false,
    isExcludePurchasePerformance: false,
    purchaseQuantityPolicy: { buyUnit: 1, min: 1, max: null },
    isGiftable: false,
    isStockUsed: true,
    deliveryTypes: ["DAWN"],
    deliveryPrice: { costType: "PAY" },
    isExposeProductNotice: true,
    operatingRule: "CC",
    isUse: true,
    isUseDateBasedStock: false,
    saleLimit: { isUse: false, isUpsert: true },
    purchaseLimit: { isUse: false },
    isExposeOpenMarket: false,
  };
}

async function createContents(token: string, masterCode: string, contentsName: string, dealName: string): Promise<{ no: any | null; dealNo?: any; rawData?: any; error?: string }> {
  const body = {
    contentsProductName: contentsName,
    dealProducts: [buildDeal(dealName, masterCode, 1)],
    siteAttributes: ["MARKET"],
    purchasePolicy: { min: 1, max: null },
    openMarketExposeLevel: "CONTENTS",
    contentsProductNotice: { type: "REFER" },
    operatingRule: "CC",
    isUse: true,
    normalOrderTypePolicy: "DEFAULT",
    isSearchEnabled: true,
    isExposeProductList: true,
    isExposeNaverMart: false,
    isExposeAppliedCouponPrice: true,
    contentsThumbnailSyncType: "AUTO",
    isUseDealOptionImage: false,
  };
  const r = await call("POST", CONTENTS_URL, {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
  }, body);
  if (!r.ok || r.data?.success === false) {
    const msg = r.data?.message ?? JSON.stringify(r.data).slice(0, 200);
    return { no: null, error: `HTTP ${r.status}: ${msg}` };
  }
  const data = r.data?.data ?? {};
  // dealProductNo 추출 — 여러 경로 시도
  const deals = data.dealProducts ?? data.dealProductList ?? data.deals ?? [];
  const firstDeal = Array.isArray(deals) ? deals[0] : null;
  const dealNo =
    firstDeal?.dealProductNo ?? firstDeal?.dealProductId ?? firstDeal?.no ?? firstDeal?.id ??
    data.dealProductNo ?? null;
  return { no: data.contentsProductNo ?? null, dealNo, rawData: data };
}

// ============== STEP 4: Stock ==============

async function setStock(token: string, masterCode: string, quantity: number): Promise<{ ok: boolean; error?: string }> {
  const body = {
    changeQuantityCommands: DEFAULT_CENTERS.map((code) => ({
      stockProduct: { productCode: masterCode, centerCode: code },
      quantity: String(quantity),
    })),
  };
  const r = await call("PUT", STOCK_URL, {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
  }, body);
  if (!r.ok || r.data?.success === false) {
    const msg = r.data?.message ?? JSON.stringify(r.data).slice(0, 200);
    return { ok: false, error: `HTTP ${r.status}: ${msg}` };
  }
  return { ok: true };
}

// ============== La-CMS 전시 일괄 (마지막 1회) ==============

async function lacmsDisplay(token: string): Promise<{ ok: boolean; message: string }> {
  const params = new URLSearchParams({
    page: "0", pageSize: "100",
    searchTextType: "CONTENTS_CODE",
    productType: "ALL",
    isEnabled: "true",
    centerCode: DEFAULT_CENTERS.join(","),
    sellerId: String(KURLY_SELLER_ID),
    createdEndDate: "",
  });
  const r = await call("GET", `${DISPLAY_LIST_URL}?${params}`, {
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
  });
  if (!r.ok) return { ok: false, message: `전시 조회 HTTP ${r.status}` };
  const products: any[] = r.data?.data?.content ?? [];
  if (products.length === 0) return { ok: true, message: "전시 조회 0건 — 변경 없음" };
  const body = products.map((p) => ({
    contentsNo: p.productNo, centerCode: p.centerCode, isShow: true,
  }));
  const r2 = await call("PUT", DISPLAY_BULK_URL, {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
  }, body);
  if (!r2.ok) return { ok: false, message: `전시 일괄 HTTP ${r2.status}` };
  return { ok: true, message: `전시 ${products.length}건 → isShow=true 일괄 적용` };
}

// ============== Main ==============

export async function createProducts1pBatch(
  input: Product1pInput,
  onProgress?: (e: Progress1pEvent) => void
): Promise<Product1pResult[]> {
  const emit = (e: Progress1pEvent) => onProgress?.(e);
  const total = Math.max(1, Math.min(50, input.count | 0));

  // STEP 1: OAuth
  emit({ type: "step", step: "OAUTH", ok: true, message: "lacms OAuth 로그인" });
  const oauth = await oauthLogin(input.lacmsEmail, input.lacmsPassword);
  if (!oauth.token) {
    emit({ type: "step", step: "OAUTH", ok: false, message: oauth.error ?? "로그인 실패" });
    throw new Error(`OAuth 실패: ${oauth.error}`);
  }
  const token = oauth.token;

  const results: Product1pResult[] = [];
  for (let i = 0; i < total; i++) {
    const idx = i + 1;
    const suffix = String(idx).padStart(3, "0");
    const result: Product1pResult = { index: idx };

    // STEP 2: Master
    if (input.doMaster) {
      const m = await createMaster(token, `${input.namePrefix}_마스터${suffix}`, input.basePrice, input.storageType);
      if (!m.code) {
        result.error = `마스터 생성 실패: ${m.error}`;
        emit({ type: "product", productIndex: idx, ok: false, message: result.error });
        results.push(result); continue;
      }
      result.masterCode = m.code;
      emit({ type: "product", productIndex: idx, ok: true, message: `[#${idx}] 마스터 생성 ${m.code}` });
    }

    // STEP 3: Contents
    if (input.doContents && result.masterCode) {
      const c = await createContents(token, result.masterCode, `${input.namePrefix}_콘텐츠${suffix}`, `${input.namePrefix}_딜${suffix}`);
      if (!c.no) {
        result.error = `콘텐츠 생성 실패: ${c.error}`;
        emit({ type: "product", productIndex: idx, ok: false, message: result.error });
        results.push(result); continue;
      }
      result.contentsNo = c.no;
      result.dealProductNo = c.dealNo ?? null;
      result.contentsRawData = c.rawData;
      const dealMsg = c.dealNo ? ` / dealProductNo=${c.dealNo}` : " / dealProductNo 추출 실패 (raw 확인)";
      emit({ type: "product", productIndex: idx, ok: true, message: `[#${idx}] 콘텐츠 생성 ${c.no}${dealMsg}` });
    }

    // STEP 4: Stock
    if (input.doStock && result.masterCode) {
      const s = await setStock(token, result.masterCode, input.stockQuantity);
      result.stockOk = s.ok;
      if (!s.ok) {
        result.error = (result.error ? result.error + " / " : "") + `재고 세팅 실패: ${s.error}`;
        emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] 재고 실패: ${s.error}` });
      } else {
        emit({ type: "product", productIndex: idx, ok: true, message: `[#${idx}] 재고 ${DEFAULT_CENTERS.length}개 센터 × ${input.stockQuantity}` });
      }
    }

    results.push(result);
  }

  // STEP 5: La-CMS 전시 일괄 (마지막 1회 — 등록된 상품 전체 검색해서 isShow=true)
  if (input.doDisplay && results.some((r) => r.masterCode)) {
    // 인덱싱 지연 대비 대기
    emit({ type: "step", step: "DISPLAY", ok: true, message: "La-CMS 인덱싱 대기 8초..." });
    await new Promise((res) => setTimeout(res, 8000));
    const d = await lacmsDisplay(token);
    emit({ type: "step", step: "DISPLAY", ok: d.ok, message: d.message });
  }

  return results;
}
