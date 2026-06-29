/**
 * 테스트 데이터 — 3P 상품 등록 자동화 (Python api_call_3p.py 의 TypeScript 포팅)
 *
 * 흐름:
 *   STEP 1~4: 사전 조회 (출고지/반품지/배송사) + 파일 업로드 → 1회 (N건 공유)
 *   STEP 5~6: 상품 등록 + 검증 → 매 건마다
 *   STEP 7: 어드민 로그인 → 1회
 *   STEP 8~9: 승인 폴링 + 승인 → 매 건마다
 *   La-CMS:  로그인 → 재고 일괄 → 전시 일괄 → 1회 (마지막에 모든 등록 상품 일괄)
 */

const CMS_OAUTH_BASIC_DEFAULT =
  "Y21zLWJhY2stb2ZmaWNlOmUwODEwYmIxLWY3MjEtNGI2OS05MTAyLWQ4MjMwMjMxNmI4Zg==";
const CMS_ORIGIN_DEFAULT = "https://lacms2.stg.kurlycorp.kr";
const ADMIN_ORIGIN_DEFAULT = "https://3p-internal.stg.kurlycorp.kr";  // 어드민 게이트웨이가 origin/referer 검증 (없으면 403)
const PARTNER_STORE_NO_DEFAULT = "d8d88df7-21f7-4be6-95c1-4da178a3dd1c";
const CMS_SELLER_ID_DEFAULT = 414;
const CMS_MD_NO_DEFAULT = 71;

const PLACEHOLDER_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

export type ProductType = "NORMAL_PARCEL" | "KURLY_PARCEL" | "KURLY_PARCEL_LIQUOR" | "INSTALLATION_DELIVERY" | "GOURMET_DELIVERY" | "QUICK_DELIVERY" | "ACCOMMODATION" | "AIRLINE_TICKET" | "ONLINE_TICKET" | "SELF_PICKUP_WINE";

export interface Product3pInput {
  // 호스트
  openapiBase: string;        // https://third-party-external-api.stg.kurly.com
  adminHost: string;          // https://third-party-partner-gateway.stg.kurly.com
  cmsHost: string;            // https://gateway.cloud.stg.kurly.services
  // 인증
  accessToken: string;        // OpenAPI Bearer
  adminId: string;
  adminPw: string;
  cmsUsername?: string;
  cmsPassword?: string;
  cmsOauthBasic?: string;     // default CMS_OAUTH_BASIC_DEFAULT
  // 옵션
  productType: ProductType;
  count: number;              // 생성 개수
  includeLacms: boolean;      // La-CMS 전시/재고 포함 여부
  doDisplay: boolean;
  doStock: boolean;
  stockQuantity?: string;     // default "100"
  partnerStoreNo?: string;
  cmsSellerId?: number;
  cmsMdNo?: number;
}

export type Step =
  | "PREP_ADDRESSES" | "PREP_RETURN_COST" | "PREP_COURIER" | "PREP_UPLOAD"
  | "ADMIN_LOGIN"
  | "REGISTER" | "SEARCH" | "REVIEW_POLL" | "APPROVE"
  | "LACMS_LOGIN" | "LACMS_STOCK" | "LACMS_DISPLAY";

export interface ProgressEvent {
  type: "step" | "product" | "phase";
  step?: Step;
  productIndex?: number;
  ok: boolean;
  message: string;
}

export interface ProductResult {
  index: number;
  productId?: number | string | null;
  partnerProductNo?: string | null;
  reviewApprovalId?: number | string | null;
  approved: boolean;
  actualDivisionType?: string | null;  // 등록 후 실제로 DB에 잡힌 유형
  actualDeliveryType?: string | null;
  dealProductNo?: number | string | null;     // 주문 풀체인에서 cart 에 보낼 deal product no — 검색 응답에서 추출
  searchRawTopKeys?: string[];                  // dealProductNo 추출 실패 시 어디서 키를 찾을지 진단용
  searchRawSample?: string;                     // 응답 본문 일부 (raw, 디버그용)
  error?: string;
}

interface Ctx {
  shippingDisplayAddress?: string;
  repReturnZipCd?: string;
  repReturnAddress?: string;
  repReturnAddressDetail?: string;
  returnCostString?: string;
  selectedCourierId?: string | number;
  selectedCourierName?: string;
  thumbnailFileId?: number;
  thumbnailFileUrl?: string;
  adminToken?: string;
  cmsToken?: string;
}

// ============== HTTP helpers ==============

interface Resp { ok: boolean; status: number; data: any; }

async function call(
  method: "GET" | "POST" | "PUT",
  url: string,
  headers: Record<string, string>,
  body?: any
): Promise<Resp> {
  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      if (body instanceof FormData) {
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
function bearer(token: string): Record<string, string> {
  return { "Accept": "application/json", "Authorization": `Bearer ${token}` };
}
function adminAuth(token: string, contentType?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
    "origin": ADMIN_ORIGIN_DEFAULT,
    "referer": ADMIN_ORIGIN_DEFAULT + "/",
  };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

// ============== STEP 1~6 (OpenAPI) ==============

async function step1Addresses(input: Product3pInput, ctx: Ctx): Promise<string | null> {
  const r = await call("GET", `${input.openapiBase}/open-api/v1/partner-products/store-addresses`, bearer(input.accessToken));
  if (!r.ok) return `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`;
  const list = r.data?.data ?? [];
  const ship = list.find((a: any) => a.isRepresentShippingPlace === true);
  if (ship?.displayAddress) ctx.shippingDisplayAddress = ship.displayAddress;
  const ret = list.find((a: any) => a.isRepresentReturnPlace === true);
  if (!ret?.zipCd || !ret?.address || !ret?.addressDetail) {
    return "대표 반품지(isRepresentReturnPlace=true) 정보 누락";
  }
  ctx.repReturnZipCd = ret.zipCd;
  ctx.repReturnAddress = ret.address;
  ctx.repReturnAddressDetail = ret.addressDetail;
  return null;
}

async function step2ReturnCost(input: Product3pInput, ctx: Ctx): Promise<string | null> {
  const r = await call("GET", `${input.openapiBase}/open-api/v1/partner-stores/return-shipping-addresses`, bearer(input.accessToken));
  if (!r.ok) return `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`;
  const list = r.data?.data ?? [];
  const rep = list.find((a: any) => a.isRepresentReturnPlace === true) || list[0];
  ctx.returnCostString = rep?.returnDeliveryCost != null ? String(rep.returnDeliveryCost) : "5000";
  return null;
}

async function step3Courier(input: Product3pInput, ctx: Ctx): Promise<string | null> {
  const r = await call("GET", `${input.openapiBase}/open-api/v1/partner-products/couriers`, bearer(input.accessToken));
  if (!r.ok) return `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`;
  const list = r.data?.data ?? [];
  if (list.length === 0) return "배송사 목록 비어있음";
  const first = list[0];
  ctx.selectedCourierId = first.id ?? first.code ?? first.courierId;
  ctx.selectedCourierName = first.name ?? first.courierName;
  return null;
}

async function step4Upload(input: Product3pInput, ctx: Ctx): Promise<string | null> {
  // 1x1 PNG placeholder 자동 생성
  const bin = Uint8Array.from(atob(PLACEHOLDER_PNG_B64), (c) => c.charCodeAt(0));
  const blob = new Blob([bin], { type: "image/png" });
  const fd = new FormData();
  fd.append("file", blob, "thumbnail.png");
  const r = await call(
    "POST",
    `${input.openapiBase}/open-api/v1/files/upload`,
    { "Accept": "application/json", "Authorization": `Bearer ${input.accessToken}` },
    fd
  );
  if (!r.ok) return `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`;
  ctx.thumbnailFileId = r.data?.data?.id;
  ctx.thumbnailFileUrl = r.data?.data?.url;
  if (!ctx.thumbnailFileUrl) return "업로드 응답에 url 없음";
  return null;
}

// ============== Body builders ==============

function buildNotice() {
  const elements: [string, string][] = [
    ["PN00", "제품명"],
    ["PN01", "식품의 유형"],
    ["PN02", "생산자 및 소재지 (수입품의 경우 생산자, 수입자 및 제조국)"],
    ["PN03", "제조연월일, 소비기한 또는 품질유지기한"],
    ["PN04", "포장단위별 내용물의 용량(중량), 수량"],
    ["PN05", "원재료명 및 함량"],
    ["PN06", "영양성분"],
    ["PN07", "유전자변형식품에 해당하는 경우의 표시"],
    ["PN08", "소비자 안전을 위한 주의사항"],
    ["PN09", "수입식품의 경우 수입신고 필함 문구"],
    ["PN10", "소비자 상담 관련 전화번호"],
  ];
  return {
    noticeTemplateId: "624e770f8d62d962dc3df41a",
    noticeTemplateType: "가공식품",
    noticeElements: elements.map(([code, attr], seq) => ({
      noticeType: code, noticeAttribute: attr, noticeDescription: "상품설명 및 상품이미지 참조", noticeSeq: seq,
    })),
  };
}

function buildOption(
  value: string, rrp: number, salePrice: number, sku: string, model: string, ctx: Ctx, stock: number
) {
  const img = { id: ctx.thumbnailFileId ?? 0, s3Url: ctx.thumbnailFileUrl ?? "" };
  return {
    optionName: "사이즈",
    optionValue: value,
    recommendedRetailPrice: rrp,
    salePrice,
    stockQuantity: stock,
    sellerProductCode: sku,
    productModelName: model,
    productBarcode: "",
    representPriceExposureType: "EXPOSURE",
    description: {
      thumbnailImage: { ...img },
      mobileProductDescription1stImage: { ...img },
      pcProductDescription1stImage: { ...img },
    },
  };
}

function buildNormalParcelBody(ctx: Ctx, rand: number) {
  return {
    base: {
      categoryIds: [2, 11, 91, 460],
      categoryFullPathName: "주방용품 > 냄비/팬/솥 > 냄비/뚝배기",
      categoryFullPath: "/00000002/00000011/00000091/00000460",
      mainCategoryId: 11, mainCategoryName: "주방용품",
      middleCategoryId: 91, middleCategoryName: "냄비/팬/솥",
      subCategoryId: 460, subCategoryName: "냄비/뚝배기",
      productDivisionType: "NORMAL_PARCEL",
      commissionRate: "1.3",
      mdName: "박소희", mdNo: 71,
    },
    namespace: {
      name: `[API] 일반(택배)_멀티딜_${rand}`,
      description: "상품 설명입니다.",
      searchTexts: "API,테스트,멀티딜",
    },
    meta: {
      originType: "FOREIGN_MADE",
      minorSaleApprovalType: "APPROVAL",
      storageTemperatureType: "AMBIENT_TEMPERATURE",
      manufacturer: "테스트 제조사",
      originDescription: "외국산 입니다. (상세설명 참조)",
      productVolume: "1개입",
      circulationPeriod: "제조일로부터 12개월",
      todayBrix: null,
      allergyDescription: "해당 없음",
      saleUnitDescription: "1박스",
      metaAdditionalInfoList: [
        { additionalName: "추가정보명1", additionalDescription: "추가정보값1" },
        { additionalName: "추가정보명2", additionalDescription: "추가정보값2" },
      ],
      brandId: 211, brandName: "살롱드벨라자로",
    },
    sale: {
      saleCompletionType: "MANUAL",
      taxType: "TAX",
      saleMinQuantity: 1, saleMaxQuantity: 10,
      saleRestrictionAreaList: [],
      memberSale: { saleLimitationType: "NOT_USE" },
      optionSaleLimitationType: "NONE",
    },
    detail: {
      imageUseType: "USE_REPRESENT",
      optionType: "MULTI",
      detailOptions: [
        buildOption("S", 15000, 10000, "TEST_SKU_S", "MODEL_XYZ_S", ctx, 100),
        buildOption("M", 16000, 11000, "TEST_SKU_M", "MODEL_XYZ_M", ctx, 100),
        buildOption("L", 17000, 12000, "TEST_SKU_L", "MODEL_XYZ_L", ctx, 100),
      ],
    },
    notice: buildNotice(),
    delivery: {
      deliveryType: "PARCEL_SERVICE",
      deliveryStatus: "ENABLED",
      deliveryFeeType: "FREE",
      deliveryCorporationCode: ctx.selectedCourierId,
      deliveryCorporationName: ctx.selectedCourierName,
      deliveryForwardingLocation: ctx.shippingDisplayAddress ?? "",
      deliveryNotification: "",
      deliveryReservationType: "NORMAL",
      returnShippingZipCd: ctx.repReturnZipCd,
      returnShippingAddress: ctx.repReturnAddress,
      returnShippingAddressDetail: ctx.repReturnAddressDetail,
      fullPathReturnShippingAddress: `(${ctx.repReturnZipCd})${ctx.repReturnAddress}, ${ctx.repReturnAddressDetail}`,
      returnShippingCost: ctx.returnCostString,
    },
    afterSaleService: {
      afterSaleServiceContactNumber: "02-0000-0000",
      afterSaleServiceDescription: "A/S 안내사항 입니다.",
    },
  };
}

function buildKurlyParcelBody(ctx: Ctx, rand: number) {
  const b = buildNormalParcelBody(ctx, rand) as any;
  b.base.productDivisionType = "KURLY_PARCEL";
  b.namespace.name = `[API] 컬리배송_멀티딜_${rand}`;
  b.detail.detailOptions = [
    buildOption("S", 15000, 10000, "TEST_SKU_S", "MODEL_XYZ_S", ctx, 0),
    buildOption("M", 16000, 11000, "TEST_SKU_M", "MODEL_XYZ_M", ctx, 0),
    buildOption("L", 17000, 12000, "TEST_SKU_L", "MODEL_XYZ_L", ctx, 0),
  ];
  b.delivery = {
    deliveryType: "KURLY_DAWN_AND_DAY_PARCEL",
    deliveryStatus: "ENABLED",
    deliveryFeeType: "PAY",  // 컬리배송 상품은 유료 (FREE 시 400)
    deliveryCorporationCode: "",
    deliveryCorporationName: "",
    deliveryForwardingLocation: "",
    deliveryNotification: "",
    returnShippingZipCd: null,
    returnShippingAddress: null,
    returnShippingAddressDetail: null,
    fullPathReturnShippingAddress: null,
    returnShippingCost: 0,
  };
  return b;
}

// 설치배송/주류/미식 공통 — description 객체에 22개 필드 (대부분 null) + Array형 이미지
// includeDealOptionImage=false 이면 dealOptionImage 를 null 로 (미식딜리버리)
function buildInstallationOption(
  value: string, rrp: number, salePrice: number, ctx: Ctx, stock: number,
  includeDealOptionImage: boolean = true
) {
  const fileObj = {
    id: ctx.thumbnailFileId ?? 0,
    s3Url: ctx.thumbnailFileUrl ?? "",
    originalFileName: "thumbnail.png",
    fileType: "image/png",
    savedFullPathName: "",
    bucket: "",
  };
  return {
    optionName: "사이즈",
    optionValue: value,
    recommendedRetailPrice: rrp,
    salePrice,
    stockQuantity: stock,
    sellerProductCode: "",
    productModelName: "",
    productBarcode: "",
    representPriceExposureType: "EXPOSURE",
    description: {
      thumbnailImage: null,
      thumbnailImageList: [fileObj],
      shareImage: null,
      mobileKurlyCommentImage: null,
      mobileGiveawayImage: null,
      mobileNoticeImage: null,
      mobileProductDescription1stImage: null,
      mobileProductDescription2ndImage: null,
      mobileProductDescription3rdImage: null,
      mobileProductDescriptionImageList: [fileObj],
      mobileProductDetailImage: null,
      pcKurlyCommentImage: null,
      pcGiveawayImage: null,
      pcNoticeImage: null,
      pcProductDescription1stImage: null,
      pcProductDescription2ndImage: null,
      pcProductDescription3rdImage: null,
      pcProductDetailImage: null,
      pcProductDescriptionImageList: [fileObj],
      dealOptionImage: includeDealOptionImage ? { ...fileObj } : null,
    },
  };
}

function buildKurlyLiquorBody(ctx: Ctx, rand: number) {
  return {
    base: {
      categoryIds: [2, 4, 41, 237],
      categoryFullPathName: "가전제품 > IT/통신기기 > 노트북/태블릿",
      categoryFullPath: "/00000002/00000004/00000041/00000237",
      mainCategoryId: 4, mainCategoryName: "가전제품",
      middleCategoryId: 41, middleCategoryName: "IT/통신기기",
      subCategoryId: 237, subCategoryName: "노트북/태블릿",
      productDivisionType: "KURLY_PARCEL_LIQUOR",
      commissionRate: "1",
      mdName: "박소희", mdNo: 71,
    },
    namespace: {
      name: `[API] 컬리배송_주류_${rand}`,
      description: "",
      searchTexts: "",
    },
    meta: {
      originType: "REFERENCE_PRODUCT_DETAIL",
      minorSaleApprovalType: "APPROVAL",
      storageTemperatureType: "AMBIENT_TEMPERATURE",
      manufacturer: "", originDescription: "", productVolume: "", circulationPeriod: "",
      todayBrix: "", allergyDescription: "", saleUnitDescription: "",
      metaAdditionalInfoList: [],
      brandId: null, brandName: null,
    },
    sale: {
      saleCompletionType: "MANUAL", taxType: "TAX",
      saleMinQuantity: 1, saleMaxQuantity: "",
      saleRestrictionAreaList: [],
      memberSale: { saleLimitationType: "NOT_USE" },
      optionSaleLimitationType: "NONE",
    },
    detail: {
      imageUseType: "USE_REPRESENT",
      optionType: "MULTI",
      isUseDealOptionImage: true,
      detailOptions: [
        buildInstallationOption("S", 100, 100, ctx, 0),  // 컬리배송과 동일하게 stock=0
      ],
    },
    notice: buildNotice(),
    delivery: {
      // 컬리배송과 동일한 구조 — deliveryType 은 동일/별도 enum 가능, 일단 그냥 KURLY_DAWN_AND_DAY_PARCEL
      deliveryType: "KURLY_DAWN_AND_DAY_PARCEL",
      deliveryStatus: "ENABLED",
      deliveryFeeType: "PAY",
      deliveryCorporationCode: "",
      deliveryCorporationName: "",
      deliveryForwardingLocation: "",
      deliveryNotification: "",
      returnShippingZipCd: null,
      returnShippingAddress: null,
      returnShippingAddressDetail: null,
      fullPathReturnShippingAddress: null,
      returnShippingCost: 0,
    },
    afterSaleService: {
      afterSaleServiceContactNumber: "02-0000-0000",
      afterSaleServiceDescription: "A/S 안내사항 입니다.",
    },
  };
}

// 비배송 유형 공통 빌더 — 숙박/항공권/온라인티켓 공유 (NONE_${divisionType} 패턴)
function buildNonDeliveryBody(
  ctx: Ctx, rand: number,
  divisionType: string, label: string,
  deliveryTypeEnum: string  // 예: NONE_ACCOMMODATION
) {
  return {
    base: {
      categoryIds: [2, 3, 37, 228],
      categoryFullPathName: "가구/인테리어 > 가구/시공 > 가구",
      categoryFullPath: "/00000002/00000003/00000037/00000228",
      mainCategoryId: 3, mainCategoryName: "가구/인테리어",
      middleCategoryId: 37, middleCategoryName: "가구/시공",
      subCategoryId: 228, subCategoryName: "가구",
      productDivisionType: divisionType,
      commissionRate: "1",
      mdName: "박소희", mdNo: 71,
    },
    namespace: {
      name: `[API] ${label}_${rand}`,
      description: "",
      searchTexts: "",
    },
    meta: {
      originType: null as string | null,
      minorSaleApprovalType: "APPROVAL",
      storageTemperatureType: "AMBIENT_TEMPERATURE",
      manufacturer: "", originDescription: "", productVolume: "", circulationPeriod: "",
      todayBrix: "", allergyDescription: "", saleUnitDescription: "",
      metaAdditionalInfoList: [],
      brandId: null, brandName: null,
    },
    sale: {
      saleCompletionType: "MANUAL", taxType: "TAX",
      saleMinQuantity: 1, saleMaxQuantity: "",
      saleRestrictionAreaList: [],
      memberSale: { saleLimitationType: "NOT_USE" },
      optionSaleLimitationType: "NONE",
    },
    detail: {
      imageUseType: "USE_REPRESENT",
      optionType: "MULTI",
      isUseDealOptionImage: true,
      detailOptions: [buildInstallationOption("S", 100, 100, ctx, 100, true)],
    },
    notice: buildNotice(),
    delivery: {
      deliveryType: deliveryTypeEnum,
      deliveryStatus: "DISABLED",
      deliveryFeeType: "FREE",
      deliveryCorporationCode: "",
      deliveryCorporationName: "",
      deliveryForwardingLocation: "",
      deliveryNotification: "",
      deliveryReservationType: "NORMAL",
      returnDeliveryContractId: null,
      returnShippingZipCd: "",
      returnShippingAddress: "",
      returnShippingAddressDetail: "",
      fullPathReturnShippingAddress: "",
      returnShippingCost: "0",
    },
    afterSaleService: {
      afterSaleServiceContactNumber: "02-0000-0000",
      afterSaleServiceDescription: "A/S 안내사항 입니다.",
    },
  };
}

const buildAccommodationBody = (ctx: Ctx, rand: number) =>
  buildNonDeliveryBody(ctx, rand, "ACCOMMODATION", "숙박", "NONE_ACCOMMODATION");

const buildAirlineTicketBody = (ctx: Ctx, rand: number) =>
  buildNonDeliveryBody(ctx, rand, "AIRLINE_TICKET", "항공권", "NONE_AIRLINE_TICKET");

const buildOnlineTicketBody = (ctx: Ctx, rand: number) =>
  buildNonDeliveryBody(ctx, rand, "ONLINE_TICKET", "온라인티켓", "NONE_ONLINE_TICKET");

const buildSelfPickupWineBody = (ctx: Ctx, rand: number) => {
  const b = buildNonDeliveryBody(ctx, rand, "SELF_PICKUP_WINE", "셀프픽업(와인)", "NONE_SELF_PICKUP_WINE");
  b.meta.originType = "REFERENCE_PRODUCT_DETAIL";  // 셀프픽업은 일반 originType (다른 비배송은 null)
  return b;
};

function buildQuickDeliveryBody(ctx: Ctx, rand: number) {
  return {
    base: {
      categoryIds: [2, 3, 38, 230],
      categoryFullPathName: "가구/인테리어 > 조명/소품 > 인테리어소품",
      categoryFullPath: "/00000002/00000003/00000038/00000230",
      mainCategoryId: 3, mainCategoryName: "가구/인테리어",
      middleCategoryId: 38, middleCategoryName: "조명/소품",
      subCategoryId: 230, subCategoryName: "인테리어소품",
      productDivisionType: "QUICK_DELIVERY",
      commissionRate: "1",
      mdName: "박소희", mdNo: 71,
    },
    namespace: {
      name: `[API] 퀵배송_${rand}`,
      description: "",
      searchTexts: "",
    },
    meta: {
      originType: "REFERENCE_PRODUCT_DETAIL",
      minorSaleApprovalType: "APPROVAL",
      storageTemperatureType: "AMBIENT_TEMPERATURE",
      manufacturer: "", originDescription: "", productVolume: "", circulationPeriod: "",
      todayBrix: "", allergyDescription: "", saleUnitDescription: "",
      metaAdditionalInfoList: [],
      brandId: null, brandName: null,
    },
    sale: {
      saleCompletionType: "MANUAL", taxType: "TAX",
      saleMinQuantity: 1, saleMaxQuantity: "",
      saleRestrictionAreaList: [],
      memberSale: { saleLimitationType: "NOT_USE" },
      optionSaleLimitationType: "NONE",
    },
    detail: {
      imageUseType: "USE_REPRESENT",
      optionType: "MULTI",
      isUseDealOptionImage: true,
      detailOptions: [
        buildInstallationOption("S", 100, 100, ctx, 100, true),
      ],
    },
    notice: buildNotice(),
    delivery: {
      deliveryType: "QUICK_DELIVERY",
      deliveryStatus: "ENABLED",
      deliveryFeeType: "FREE",
      deliveryCorporationCode: "",
      deliveryCorporationName: "",
      deliveryForwardingLocation: ctx.shippingDisplayAddress ?? "",
      deliveryNotification: "",
      returnShippingZipCd: ctx.repReturnZipCd,
      returnShippingAddress: ctx.repReturnAddress,
      returnShippingAddressDetail: ctx.repReturnAddressDetail,
      fullPathReturnShippingAddress: `(${ctx.repReturnZipCd})${ctx.repReturnAddress}, ${ctx.repReturnAddressDetail}`,
      returnShippingCost: ctx.returnCostString ?? "2500",
    },
    afterSaleService: {
      afterSaleServiceContactNumber: "02-0000-0000",
      afterSaleServiceDescription: "A/S 안내사항 입니다.",
    },
  };
}

function buildGourmetDeliveryBody(ctx: Ctx, rand: number) {
  return {
    base: {
      categoryIds: [2, 3, 37, 228],
      categoryFullPathName: "가구/인테리어 > 가구/시공 > 가구",
      categoryFullPath: "/00000002/00000003/00000037/00000228",
      mainCategoryId: 3, mainCategoryName: "가구/인테리어",
      middleCategoryId: 37, middleCategoryName: "가구/시공",
      subCategoryId: 228, subCategoryName: "가구",
      productDivisionType: "GOURMET_DELIVERY",
      commissionRate: "1",
      mdName: "박소희", mdNo: 71,
    },
    namespace: {
      name: `[API] 미식딜리버리_${rand}`,
      description: "",
      searchTexts: "",
    },
    meta: {
      originType: "REFERENCE_PRODUCT_DETAIL",
      minorSaleApprovalType: "APPROVAL",
      storageTemperatureType: "AMBIENT_TEMPERATURE",
      manufacturer: "", originDescription: "", productVolume: "", circulationPeriod: "",
      todayBrix: "", allergyDescription: "", saleUnitDescription: "",
      metaAdditionalInfoList: [],
      brandId: null, brandName: null,
    },
    sale: {
      saleCompletionType: "MANUAL", taxType: "TAX",
      saleMinQuantity: 1, saleMaxQuantity: "",
      saleRestrictionAreaList: [],
      memberSale: { saleLimitationType: "NOT_USE" },
      optionSaleLimitationType: "NONE",
    },
    detail: {
      imageUseType: "USE_REPRESENT",
      optionType: "MULTI",
      isUseDealOptionImage: false,  // 미식은 false
      detailOptions: [
        buildInstallationOption("S", 100, 100, ctx, 100, false),  // stock=100, dealOptionImage=null
      ],
    },
    notice: buildNotice(),
    delivery: {
      // 미식은 별도 권역(centerCode) 기반일 가능성 — 일단 설치배송 패턴으로 추정
      deliveryType: "GOURMET_DELIVERY",
      deliveryStatus: "ENABLED",
      deliveryFeeType: "FREE",
      deliveryCorporationCode: "",
      deliveryCorporationName: "",
      deliveryForwardingLocation: ctx.shippingDisplayAddress ?? "",
      deliveryNotification: "",
      returnShippingZipCd: ctx.repReturnZipCd,
      returnShippingAddress: ctx.repReturnAddress,
      returnShippingAddressDetail: ctx.repReturnAddressDetail,
      fullPathReturnShippingAddress: `(${ctx.repReturnZipCd})${ctx.repReturnAddress}, ${ctx.repReturnAddressDetail}`,
      returnShippingCost: ctx.returnCostString ?? "2500",
    },
    afterSaleService: {
      afterSaleServiceContactNumber: "02-0000-0000",
      afterSaleServiceDescription: "A/S 안내사항 입니다.",
    },
  };
}

function buildInstallationDeliveryBody(ctx: Ctx, rand: number) {
  return {
    base: {
      categoryIds: [2, 3, 37, 228],
      categoryFullPathName: "가구/인테리어 > 가구/시공 > 가구",
      categoryFullPath: "/00000002/00000003/00000037/00000228",
      mainCategoryId: 3, mainCategoryName: "가구/인테리어",
      middleCategoryId: 37, middleCategoryName: "가구/시공",
      subCategoryId: 228, subCategoryName: "가구",
      productDivisionType: "INSTALLATION_DELIVERY",
      commissionRate: "1",
      mdName: "박소희", mdNo: 71,
    },
    namespace: {
      name: `[API] 설치배송_${rand}`,
      description: "",
      searchTexts: "",
    },
    meta: {
      originType: "REFERENCE_PRODUCT_DETAIL",
      minorSaleApprovalType: "APPROVAL",
      storageTemperatureType: "AMBIENT_TEMPERATURE",
      manufacturer: "",
      originDescription: "",
      productVolume: "",
      circulationPeriod: "",
      todayBrix: "",
      allergyDescription: "",
      saleUnitDescription: "",
      metaAdditionalInfoList: [],
      brandId: null, brandName: null,
    },
    sale: {
      saleCompletionType: "MANUAL",
      taxType: "TAX",
      saleMinQuantity: 1, saleMaxQuantity: "",
      saleRestrictionAreaList: [],
      memberSale: { saleLimitationType: "NOT_USE" },
      optionSaleLimitationType: "NONE",
    },
    detail: {
      imageUseType: "USE_REPRESENT",
      optionType: "MULTI",
      isUseDealOptionImage: true,
      detailOptions: [
        buildInstallationOption("S", 100, 100, ctx, 100),
      ],
    },
    notice: buildNotice(),
    delivery: {
      // "직접배송(화물배송)" — productDivisionType 과 동일하게 INSTALLATION_DELIVERY 추정
      deliveryType: "INSTALLATION_DELIVERY",
      deliveryStatus: "ENABLED",
      deliveryFeeType: "FREE",
      deliveryCorporationCode: "",
      deliveryCorporationName: "",
      deliveryForwardingLocation: ctx.shippingDisplayAddress ?? "",
      deliveryNotification: "",
      returnShippingZipCd: ctx.repReturnZipCd,
      returnShippingAddress: ctx.repReturnAddress,
      returnShippingAddressDetail: ctx.repReturnAddressDetail,
      fullPathReturnShippingAddress: `(${ctx.repReturnZipCd})${ctx.repReturnAddress}, ${ctx.repReturnAddressDetail}`,
      returnShippingCost: ctx.returnCostString ?? "2500",
    },
    afterSaleService: {
      afterSaleServiceContactNumber: "02-0000-0000",
      afterSaleServiceDescription: "A/S 안내사항 입니다.",
    },
  };
}

// ============== STEP 5~9 ==============

async function step5Register(input: Product3pInput, ctx: Ctx): Promise<{ ok: boolean; productId?: any; partnerProductNo?: string; error?: string }> {
  const rand = Math.floor(Math.random() * 1_000_000) + 1;
  let body: any;
  if (input.productType === "KURLY_PARCEL") body = buildKurlyParcelBody(ctx, rand);
  else if (input.productType === "KURLY_PARCEL_LIQUOR") body = buildKurlyLiquorBody(ctx, rand);
  else if (input.productType === "INSTALLATION_DELIVERY") body = buildInstallationDeliveryBody(ctx, rand);
  else if (input.productType === "GOURMET_DELIVERY") body = buildGourmetDeliveryBody(ctx, rand);
  else if (input.productType === "QUICK_DELIVERY") body = buildQuickDeliveryBody(ctx, rand);
  else if (input.productType === "ACCOMMODATION") body = buildAccommodationBody(ctx, rand);
  else if (input.productType === "AIRLINE_TICKET") body = buildAirlineTicketBody(ctx, rand);
  else if (input.productType === "ONLINE_TICKET") body = buildOnlineTicketBody(ctx, rand);
  else if (input.productType === "SELF_PICKUP_WINE") body = buildSelfPickupWineBody(ctx, rand);
  else body = buildNormalParcelBody(ctx, rand);
  const r = await call(
    "POST",
    `${input.openapiBase}/open-api/v1/partner-products`,
    bearer(input.accessToken),
    body
  );
  if (!r.ok || r.data?.success === false) {
    return { ok: false, error: `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}` };
  }
  const data = r.data?.data ?? {};
  if (!data.partnerProductNo) return { ok: false, error: "partnerProductNo 추출 실패" };
  return { ok: true, productId: data.id, partnerProductNo: data.partnerProductNo };
}

// 컨텐츠상품번호 → 딜상품번호 변환.
// 3P partner-products 검색은 contentsProductNos(컨텐츠코드)만 주고 딜코드가 없다.
// 주문(cart/checkout)에는 딜코드가 필요. 소비자 goods 페이지가 SSR(Next.js)이라 HTML 의
// __NEXT_DATA__ JSON 에 product.dealProducts[].no(딜코드)가 박혀 있어 이를 파싱한다. (인증 불필요)
const KURLY_STG_WEB = process.env.KURLY_STG_WEB || "https://www.stg.kurly.com";

export async function resolveDealProductNoFromGoods(
  contentsProductNo: number | string
): Promise<{ dealProductNo: number | null; deals?: number[]; error?: string }> {
  try {
    const res = await fetch(`${KURLY_STG_WEB}/goods/${contentsProductNo}`, {
      headers: { "user-agent": "Mozilla/5.0", "Accept": "text/html" },
    });
    if (!res.ok) return { dealProductNo: null, error: `goods HTTP ${res.status}` };
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return { dealProductNo: null, error: "__NEXT_DATA__ 미검출 (상품 미전시 가능성)" };
    const data = JSON.parse(m[1]);
    const deals = data?.props?.pageProps?.product?.dealProducts;
    if (!Array.isArray(deals) || deals.length === 0) return { dealProductNo: null, error: "dealProducts 없음" };
    // 구매 가능 + 재고 있는 첫 딜 우선, 없으면 첫 딜
    const pick = deals.find((d: any) => d?.isPurchaseStatus && !d?.isSoldOut) ?? deals[0];
    const raw = pick?.no;
    const no = typeof raw === "number" ? raw : (raw != null ? Number(raw) : null);
    return { dealProductNo: Number.isFinite(no) ? no : null, deals: deals.map((d: any) => d?.no).filter(Boolean) };
  } catch (e) {
    return { dealProductNo: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// STEP6 — 등록 후 검증 (productDivisionType / deliveryType 확인)
async function step6VerifyType(input: Product3pInput, partnerProductNo: string): Promise<{
  divisionType?: string | null;
  deliveryType?: string | null;
  topKeys?: string[];
  dealProductNo?: number | string | null;
  rawSample?: string;
}> {
  const params = new URLSearchParams({
    keywordSearchType: "PRODUCT_NAME",
    page: "0",
    periodSearchType: "PRODUCT_REG_DATE",
    saleStatusList: "SALE_PENDING,SALE,SALE_PAUSE,SALE_BAN,SOLD_OUT",
    searchText: partnerProductNo,
    searchType: "PRODUCT_NO",
    size: "20",
    sortSearchType: "REQUESTED_APPROVAL_AT",
    statusList: "REQUESTED_APPROVAL,REQUESTED_UPDATE,APPROVED,APPROVED_UPDATE,REJECTED_UPDATE,REJECTED",
  });
  const r = await call(
    "GET",
    `${input.openapiBase}/open-api/v1/partner-products?${params}`,
    bearer(input.accessToken)
  );
  if (!r.ok) return {};
  const c = r.data?.data?.content?.[0];
  if (!c) return {};
  // 응답 필드명: partnerProductDivisionType (객체일 수 있음: {code, description})
  const extract = (v: any): string | null => {
    if (v == null) return null;
    if (typeof v === "string") return v;
    if (typeof v === "object") return v.code ?? v.value ?? v.name ?? v.type ?? JSON.stringify(v).slice(0, 80);
    return String(v);
  };
  // dealProductNo 추출 — 3P partner-products 검색 응답은 deal product 번호를 직접 노출 안 함.
  //  실제로는 contentsProductNos 배열에 deal product 번호가 담김 (검색 응답 raw 로 확인).
  //  cart API 의 dealProductNo = 이 contentsProductNos[0] 으로 매핑.
  //  나머지 후보는 다른 응답 변형 대비 fallback.
  const contentsNos = c.contentsProductNos;
  const fromContentsNos: number | string | null =
    Array.isArray(contentsNos) ? (contentsNos[0] ?? null)
      : (contentsNos != null ? contentsNos : null);
  const detailOpts = Array.isArray(c.detailOptions) ? c.detailOptions : [];
  const optsAlt = Array.isArray(c.options) ? c.options : (Array.isArray(c.products) ? c.products : []);
  const dealProductNo: number | string | null =
    fromContentsNos ??
    c.dealProductNo ?? c.dealProductId ?? c.dealNo ??
    c.base?.dealProductNo ??
    c.deal?.productNo ?? c.deal?.dealProductNo ??
    detailOpts[0]?.dealProductNo ?? detailOpts[0]?.dealNo ?? detailOpts[0]?.productNo ??
    optsAlt[0]?.dealProductNo ?? optsAlt[0]?.dealNo ?? optsAlt[0]?.productNo ??
    null;
  // 추출 실패 시 진단용 — contentsProductNos 값을 명시적으로 보여줌 (비어있는지/값이 있는지 즉시 확인용)
  const rawSample = dealProductNo == null
    ? `contentsProductNos=${JSON.stringify(c.contentsProductNos)} | id=${c.id} | saleStatus=${c.saleStatus} | displayStatus=${c.displayStatus} | raw(0..400)=${JSON.stringify(c).slice(0, 400)}`
    : undefined;
  return {
    divisionType: extract(c.partnerProductDivisionType ?? c.productDivisionType ?? c.base?.productDivisionType),
    deliveryType: extract(c.expressDeliveryStatus ?? c.deliveryType ?? c.delivery?.deliveryType),
    topKeys: Object.keys(c).slice(0, 20),
    dealProductNo,
    rawSample,
  };
}

async function step7AdminLogin(input: Product3pInput): Promise<string | null> {
  const r = await call(
    "POST",
    `${input.adminHost}/internal/api/v2/auth/login`,
    { "Content-Type": "application/json", "Accept": "application/json" },
    { id: input.adminId, password: input.adminPw }
  );
  if (!r.ok) return null;
  const d = r.data?.data ?? r.data ?? {};
  return d.token ?? d.accessToken ?? d.access_token ?? null;
}

async function step8PollReview(
  input: Product3pInput,
  adminToken: string,
  partnerProductNo: string,
  opts?: { maxRetries?: number; delayMs?: number; onWait?: (attempt: number, max: number) => void }
): Promise<{ id: any | null; error?: string }> {
  // STG 승인 큐 반영이 등록 직후 10초 넘게 걸리는 경우가 잦아 윈도우를 ~36초로 확대.
  const maxRetries = opts?.maxRetries ?? 12;
  const delayMs = opts?.delayMs ?? 3000;
  const store = input.partnerStoreNo ?? PARTNER_STORE_NO_DEFAULT;
  const params = new URLSearchParams({
    page: "0",
    partnerProductReviewSearchNameType: "PRODUCT_NAME",
    partnerProductReviewSearchNoType: "PARTNER_PRODUCT_NO",
    partnerProductReviewSearchPeriodType: "REQUESTED_APPROVAL_AT",
    partnerProductReviewStatus: "REQUESTED_APPROVAL,REQUESTED_UPDATE,APPROVED,APPROVED_UPDATE,REJECTED_UPDATE,REJECTED",
    partnerStoreNo: store,
    searchName: "",
    searchNo: partnerProductNo,
    size: "20",
  });
  let lastTotal = -1;
  for (let i = 1; i <= maxRetries; i++) {
    const r = await call(
      "GET",
      `${input.adminHost}/internal/api/v3/partner-products/review?${params}`,
      adminAuth(adminToken)
    );
    if (!r.ok) return { id: null, error: `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` };
    const data = r.data?.data ?? {};
    lastTotal = data.total ?? 0;
    if (lastTotal > 0 && data.content?.length > 0) {
      return { id: data.content[0].id };
    }
    if (i < maxRetries) {
      opts?.onWait?.(i, maxRetries);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  // total 이 끝까지 0 이면 전파 지연(타이밍)일 확률이 높고, store/searchNo 가 안 맞으면 구조적 문제.
  return { id: null, error: `${maxRetries}회(${Math.round((maxRetries * delayMs) / 1000)}초) 폴링 후에도 승인목록에 없음 (total=${lastTotal}, store=${store}, searchNo=${partnerProductNo})` };
}

async function step9Approve(input: Product3pInput, adminToken: string, reviewId: any): Promise<string | null> {
  await new Promise((res) => setTimeout(res, 2000));  // 등록 직후 승인 반영 대기
  const r = await call(
    "PUT",
    `${input.adminHost}/internal/api/v3/partner-products/reviews/${reviewId}/approve`,
    adminAuth(adminToken, "application/json"),
    {
      reviewReasonNote: "",
      reviewReasonType: "APPROVAL",
      reviewResultType: "APPROVED",
      tags: [{ name: "무료배송", id: 12 }],
      pointPolicy: "EXCLUDE",
      benefitType: "EXCLUDE",
      contentsExposureType: "REPRESENT",
      exposureProductList: "EXPOSURE",
      exposureSearch: "EXPOSURE",
      exposureNaverShopping: "EXPOSURE",
      exposureExternalChannel: "EXPOSURE",
      exposureUnitType: "CONTENTS",
      exposureOptionIds: [],
      exposureUnitSelectedType: "ALL",
      dueDate: "",
      targetSites: ["MARKET_KURLY"],
    }
  );
  if (!r.ok || r.data?.success === false) {
    return `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`;
  }
  return null;
}

// ============== La-CMS ==============

async function lacmsLogin(input: Product3pInput): Promise<string | null> {
  if (!input.cmsUsername || !input.cmsPassword) return null;
  const params = new URLSearchParams({
    grant_type: "password",
    username: input.cmsUsername,
    password: input.cmsPassword,
  });
  const r = await fetch(`${input.cmsHost}/admin/oauth/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Authorization": `Basic ${input.cmsOauthBasic ?? CMS_OAUTH_BASIC_DEFAULT}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "origin": CMS_ORIGIN_DEFAULT,
      "referer": CMS_ORIGIN_DEFAULT + "/",
      "page-url": "/signin",
    },
    body: params,
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return j.access_token ?? null;
}

interface LacmsResult { ok: boolean; message: string; }

async function lacmsStock(input: Product3pInput, cmsToken: string): Promise<LacmsResult> {
  const sellerId = input.cmsSellerId ?? CMS_SELLER_ID_DEFAULT;
  const mdNo = input.cmsMdNo ?? CMS_MD_NO_DEFAULT;
  // fulfillmentIds 는 컬리배송이면 1 이 아닐 수도 있어 옵션화 (빈값이면 필터 생략)
  const params = new URLSearchParams({
    salesOwner: "THIRD_PARTNER",
    sellerIds: String(sellerId),
    fulfillmentIds: "1",
    mdNos: String(mdNo),
    requestColumnValues: "MD,STOCK,FULFILLMENT_NAME,STOCK_RESET,DATE_BASED_STOCK_D3,BASE_PRICE,SALES_OWNER,IS_USE",
    page: "0",
    size: "100",
  });
  const r = await call(
    "GET",
    `${input.cmsHost}/admin/vsms/v3/stock/products?${params}`,
    { "Accept": "application/json", "Authorization": `Bearer ${cmsToken}` }
  );
  if (!r.ok) return { ok: false, message: `재고 조회 HTTP ${r.status}` };
  const stocks: any[] = r.data?.data?.content ?? [];
  const total = r.data?.data?.totalElements ?? r.data?.data?.total ?? stocks.length;
  if (stocks.length === 0) return { ok: true, message: `재고 조회 0건 — 변경 없음 (total=${total}, fulfillmentIds=1)` };
  const quantity = input.stockQuantity ?? "100";
  const cmds = stocks.map((s) => ({
    stockProduct: { productCode: s.masterProductCode, centerCode: s.centerCode },
    quantity,
  }));
  const r2 = await call(
    "PUT",
    `${input.cmsHost}/admin/vsms/v2/stock/manage/set-n`,
    { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${cmsToken}` },
    { changeQuantityCommands: cmds }
  );
  if (!r2.ok) return { ok: false, message: `재고 일괄 HTTP ${r2.status}` };
  return { ok: true, message: `재고 조회 ${stocks.length}건 → quantity=${quantity} 으로 일괄 변경` };
}

async function lacmsDisplay(input: Product3pInput, cmsToken: string, partnerProductNos?: (string | null | undefined)[]): Promise<LacmsResult> {
  const sellerId = input.cmsSellerId ?? CMS_SELLER_ID_DEFAULT;
  // 새로 만든 상품 타겟팅 — partnerProductNos 있으면 각각 PARTNER_PRODUCT_NO 로 정확 검색,
  // 없으면 (or 모두 빈값) 기존 sellerId 전체 일괄 fallback.
  // sellerId 전체로 가면 새 상품이 페이지 100건 안에 못 들어와 누락되는 게 알려진 문제.
  const targets = (partnerProductNos ?? []).filter((n): n is string => !!n && n.length > 0);
  const collected: any[] = [];
  if (targets.length > 0) {
    for (const ppn of targets) {
      const params = new URLSearchParams({
        page: "0", pageSize: "100",
        searchTextType: "PARTNER_PRODUCT_NO",
        searchText: ppn,
        productType: "ALL",
        isEnabled: "true",
        centerCode: "CC01,CC02,CC03,CC04,MC01,MC02,MC03,MC04,IC",
        sellerId: String(sellerId),
        createdEndDate: "",
      });
      const r = await call(
        "GET",
        `${input.cmsHost}/admin/dsms/v1/display/list?${params}`,
        { "Accept": "application/json", "Authorization": `Bearer ${cmsToken}` }
      );
      if (r.ok) {
        const list: any[] = r.data?.data?.content ?? [];
        for (const row of list) collected.push(row);
      }
    }
  } else {
    // fallback — 검색어 없이 sellerId 전체 (legacy)
    const params = new URLSearchParams({
      page: "0", pageSize: "100",
      searchTextType: "CONTENTS_CODE",
      productType: "ALL",
      isEnabled: "true",
      centerCode: "CC01,CC02,CC03,CC04,MC01,MC02,MC03,MC04,IC",
      sellerId: String(sellerId),
      createdEndDate: "",
    });
    const r = await call(
      "GET",
      `${input.cmsHost}/admin/dsms/v1/display/list?${params}`,
      { "Accept": "application/json", "Authorization": `Bearer ${cmsToken}` }
    );
    if (!r.ok) return { ok: false, message: `전시 조회 HTTP ${r.status}` };
    const list: any[] = r.data?.data?.content ?? [];
    for (const row of list) collected.push(row);
  }
  if (collected.length === 0) {
    return { ok: true, message: targets.length > 0
      ? `전시 조회 0건 (PARTNER_PRODUCT_NO ${targets.length}개 검색) — La-CMS 인덱싱 더 필요`
      : "전시 조회 0건 — 변경 없음" };
  }
  const body = collected.map((p) => ({
    contentsNo: p.productNo, centerCode: p.centerCode, isShow: true,
  }));
  const r2 = await call(
    "PUT",
    `${input.cmsHost}/admin/dsms/v1/display/contents/bulk`,
    { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${cmsToken}` },
    body
  );
  if (!r2.ok) return { ok: false, message: `전시 일괄 HTTP ${r2.status}` };
  return { ok: true, message: `전시 ${collected.length}건 → isShow=true 일괄 적용${targets.length > 0 ? ` (PARTNER_PRODUCT_NO 타겟팅)` : ""}` };
}

// ============== Main ==============

export async function createProducts3pBatch(
  input: Product3pInput,
  onProgress?: (e: ProgressEvent) => void
): Promise<{ results: ProductResult[]; lacmsOk: boolean; lacmsError?: string }> {
  const emit = (e: ProgressEvent) => onProgress?.(e);
  const ctx: Ctx = {};
  const total = Math.max(1, Math.min(50, input.count | 0));
  // 유형별 사전 단계 (1회)
  // NORMAL_PARCEL: 출고지+반품지+배송사 (STEP1+2+3)
  // INSTALLATION_DELIVERY / GOURMET_DELIVERY / QUICK_DELIVERY: 출고지+반품지 (STEP1+2, 배송사 없음)
  // KURLY_PARCEL / KURLY_PARCEL_LIQUOR / ACCOMMODATION: 사전 단계 없음
  const skipAddresses =
    input.productType === "KURLY_PARCEL" ||
    input.productType === "KURLY_PARCEL_LIQUOR" ||
    input.productType === "ACCOMMODATION" ||
    input.productType === "AIRLINE_TICKET" ||
    input.productType === "ONLINE_TICKET" ||
    input.productType === "SELF_PICKUP_WINE";
  const needAddresses = !skipAddresses;
  const needCourier = input.productType === "NORMAL_PARCEL";
  if (needAddresses) {
    emit({ type: "step", step: "PREP_ADDRESSES", ok: true, message: "출고지/반품지 조회" });
    const e1 = await step1Addresses(input, ctx);
    if (e1) { emit({ type: "step", step: "PREP_ADDRESSES", ok: false, message: e1 }); throw new Error(`STEP1: ${e1}`); }

    emit({ type: "step", step: "PREP_RETURN_COST", ok: true, message: "반품비 조회" });
    const e2 = await step2ReturnCost(input, ctx);
    if (e2) { emit({ type: "step", step: "PREP_RETURN_COST", ok: false, message: e2 }); throw new Error(`STEP2: ${e2}`); }
  }
  if (needCourier) {
    emit({ type: "step", step: "PREP_COURIER", ok: true, message: "배송사 조회" });
    const e3 = await step3Courier(input, ctx);
    if (e3) { emit({ type: "step", step: "PREP_COURIER", ok: false, message: e3 }); throw new Error(`STEP3: ${e3}`); }
  }

  emit({ type: "step", step: "PREP_UPLOAD", ok: true, message: "썸네일 업로드" });
  const e4 = await step4Upload(input, ctx);
  if (e4) { emit({ type: "step", step: "PREP_UPLOAD", ok: false, message: e4 }); throw new Error(`STEP4: ${e4}`); }

  emit({ type: "step", step: "ADMIN_LOGIN", ok: true, message: "어드민 로그인" });
  const adminToken = await step7AdminLogin(input);
  if (!adminToken) { emit({ type: "step", step: "ADMIN_LOGIN", ok: false, message: "로그인 실패" }); throw new Error("어드민 로그인 실패"); }
  ctx.adminToken = adminToken;

  // 상품 등록 + 승인 (N건)
  const results: ProductResult[] = [];
  for (let i = 0; i < total; i++) {
    const idx = i + 1;
    const result: ProductResult = { index: idx, approved: false };

    const reg = await step5Register(input, ctx);
    if (!reg.ok) {
      result.error = `등록 실패: ${reg.error}`;
      emit({ type: "product", productIndex: idx, ok: false, message: result.error });
      results.push(result); continue;
    }
    result.productId = reg.productId;
    result.partnerProductNo = reg.partnerProductNo;
    emit({ type: "product", productIndex: idx, ok: true, message: `등록 완료 partnerProductNo=${reg.partnerProductNo}` });

    // 등록 직후 실제 잡힌 유형 확인 (진단 목적) + dealProductNo 추출 (주문 풀체인용)
    const verify = await step6VerifyType(input, reg.partnerProductNo!);
    result.actualDivisionType = verify.divisionType;
    result.actualDeliveryType = verify.deliveryType;
    result.dealProductNo = verify.dealProductNo ?? null;
    result.searchRawTopKeys = verify.topKeys;
    result.searchRawSample = verify.rawSample;
    const expected = input.productType;
    const mismatch = verify.divisionType && verify.divisionType !== expected;
    const dealMsg = verify.dealProductNo != null
      ? ` / dealProductNo=${verify.dealProductNo}`
      : ` / ⚠ dealProductNo 추출 실패 (응답 키: ${verify.topKeys?.slice(0, 8).join(", ") ?? "?"} ...)`;
    const detail = verify.divisionType
      ? `productDivisionType=${verify.divisionType} / deliveryType=${verify.deliveryType ?? "n/a"}${dealMsg}`
      : `응답 키 = [${verify.topKeys?.join(", ") ?? "없음"}]${dealMsg}`;
    emit({
      type: "product",
      productIndex: idx,
      ok: !mismatch,
      message: `검증 (요청: ${expected}) — ${detail}${mismatch ? ` ⚠ 요청과 다름` : ""}`,
    });

    const poll = await step8PollReview(input, adminToken, reg.partnerProductNo!, {
      onWait: (a, m) => emit({ type: "product", productIndex: idx, ok: true, message: `승인 큐 반영 대기 ${a}/${m} (~3초)…` }),
    });
    if (!poll.id) {
      result.error = `승인 폴링 실패: ${poll.error}`;
      emit({ type: "product", productIndex: idx, ok: false, message: result.error });
      results.push(result); continue;
    }
    result.reviewApprovalId = poll.id;

    const approveErr = await step9Approve(input, adminToken, poll.id);
    if (approveErr) {
      result.error = `승인 실패: ${approveErr}`;
      emit({ type: "product", productIndex: idx, ok: false, message: result.error });
      results.push(result); continue;
    }
    result.approved = true;
    emit({ type: "product", productIndex: idx, ok: true, message: `승인 완료 reviewApprovalId=${poll.id}` });
    results.push(result);
  }

  // dealProductNo 재추출 — 승인 직후엔 contentsProductNos 가 비어있음. 인덱싱 대기 후 재조회.
  const needReextract = results.filter((r) => r.approved && r.dealProductNo == null && r.partnerProductNo);
  if (needReextract.length > 0) {
    emit({ type: "phase", ok: true, message: `dealProductNo 재추출 — ${needReextract.length}건 (승인 후 인덱싱 대기 8초)` });
    await new Promise((res) => setTimeout(res, 8000));
    for (const r of needReextract) {
      // 재시도 — 최대 3회 (각 4초 간격) — 인덱싱 시간 더 필요할 수 있음.
      let last: Awaited<ReturnType<typeof step6VerifyType>> | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const v = await step6VerifyType(input, r.partnerProductNo!);
        last = v;
        if (v.dealProductNo != null) {
          r.dealProductNo = v.dealProductNo;
          r.searchRawTopKeys = v.topKeys;
          r.searchRawSample = undefined;
          emit({ type: "product", productIndex: r.index, ok: true, message: `재추출 ${attempt}회차 → dealProductNo=${v.dealProductNo}` });
          break;
        }
        if (attempt < 3) await new Promise((res) => setTimeout(res, 4000));
      }
      if (r.dealProductNo == null && last) {
        r.searchRawTopKeys = last.topKeys;
        r.searchRawSample = last.rawSample;
        emit({ type: "product", productIndex: r.index, ok: false, message: `재추출 3회 모두 실패 — ${last.rawSample?.slice(0, 200) ?? "raw 없음"}` });
      }
    }
  }

  // La-CMS (마지막 1회)
  let lacmsOk = !input.includeLacms;
  let lacmsError: string | undefined;
  if (input.includeLacms) {
    // 등록 직후 La-CMS 인덱싱에 시간이 걸리므로 대기 (재고/전시 조회 0건 방지)
    emit({ type: "phase", ok: true, message: "La-CMS 인덱싱 대기 8초..." });
    await new Promise((res) => setTimeout(res, 8000));

    emit({ type: "step", step: "LACMS_LOGIN", ok: true, message: "La-CMS 로그인" });
    const cmsToken = await lacmsLogin(input);
    if (!cmsToken) {
      lacmsError = "La-CMS 로그인 실패";
      emit({ type: "step", step: "LACMS_LOGIN", ok: false, message: lacmsError });
    } else {
      ctx.cmsToken = cmsToken;
      if (input.doStock) {
        const r = await lacmsStock(input, cmsToken);
        emit({ type: "step", step: "LACMS_STOCK", ok: r.ok, message: r.message });
        if (!r.ok) lacmsError = r.message;
      }
      if (input.doDisplay) {
        const r = await lacmsDisplay(input, cmsToken);
        emit({ type: "step", step: "LACMS_DISPLAY", ok: r.ok, message: r.message });
        if (!r.ok) lacmsError = (lacmsError ? lacmsError + " / " : "") + r.message;
      }
      lacmsOk = !lacmsError;
    }
  }

  return { results, lacmsOk, lacmsError };
}
