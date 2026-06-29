/**
 * 혼합 주문 시나리오: 1P + 임의의 3P 유형(일반택배/컬리배송/주류/설치/미식/퀵/숙박/항공/온라인티켓/셀프픽업)을
 * 자동 생성하고 한 주문(groupOrderNo)에 모두 담아 주문 (적립금 결제).
 *
 * 흐름:
 *   1. 1P count + 3P 유형별 spec(productType, count) 만큼 상품 생성
 *        - 1P  : createProducts1pBatch (lacms 토큰)
 *        - 3P  : createProducts3pBatch(productType=<선택 유형>)  — 유형은 3P 상품 등록과 동일 enum
 *   2. dealProductNo 수집
 *        - 1P  : 콘텐츠 생성 응답에서 직접
 *        - 3P  : 검색 응답엔 콘텐츠코드뿐 → goods 페이지에서 진짜 딜코드로 변환(전시 반영 폴링)
 *   3. placeMultiProductOrder 로 전 상품을 한 카트에 담아 단일 주문 생성
 *   4. (선택) 배송완료까지 자동 처리 — 발송처리가 일반택배 배치라 3P가 전부 NORMAL_PARCEL 일 때만
 *
 * 인증: 어떤 타입이든 La-CMS 전시가 있어야 주문 가능 → lacms 공통 필수.
 *       3P 가 하나라도 있으면 OpenAPI accessToken + 어드민 ID/PW 추가 필요.
 */

import { createProducts1pBatch, type Product1pInput } from "./test-data-product-1p";
import { createProducts3pBatch, resolveDealProductNoFromGoods, type Product3pInput, type ProductType } from "./test-data-product-3p";
import { placeMultiProductOrder, type OrderItem, type OrderCreateResult } from "./test-data-order";
import { runFull3pDelivery } from "./test-data-3p-delivery";
import { THREEP_LABEL, DELIVERABLE_3P_TYPES } from "./three-p-types";

export interface ThreePSpec { productType: ProductType; count: number; }

export interface MixedOrderInput {
  memberNo: number | string;
  count1p: number;
  threeP: ThreePSpec[];        // 3P 유형별 개수 (유형 자유 조합)
  quantity?: number;           // 주문 시 상품당 수량 (default 1)
  // 공통 인증 (전시 필수)
  lacmsEmail?: string;
  lacmsPassword?: string;
  // 1P 옵션
  basePrice?: number;
  stockQuantity?: number;
  // 3P 인증
  openapiAccessToken?: string;
  adminId?: string;
  adminPw?: string;
  // 공통
  namePrefix?: string;
  // 주문 옵션
  paymentGatewayId?: string;
  usingFreePoint?: number;
  centerCode?: string;
  receiverName?: string;
  receiverPhoneNumber?: string;
  address?: string;
  addressDetail?: string;
  zipCode?: string;
  memo?: string;
  // 배송완료 (3P 가 전부 NORMAL_PARCEL 일 때만 동작)
  markDelivered3p?: boolean;
}

export interface MixedProduct {
  group: string;             // 표시용 그룹 ("1P" 또는 유형 라벨)
  productType?: ProductType; // 3P 인 경우 유형
  index: number;             // 그룹 내 순번
  ok: boolean;               // 생성 + 딜코드 확보까지
  partnerProductNo?: string | null;
  contentsCode?: number | string | null;
  dealProductNo?: number | null;
  error?: string;
}

export interface MixedStep {
  type: "phase" | "product";
  phase: "PRODUCT" | "ORDER" | "DELIVERED";
  label?: string;
  ok: boolean;
  message: string;
}

export interface MixedOrderResult {
  products: MixedProduct[];
  order?: OrderCreateResult;
  orderItems?: OrderItem[];
  delivered?: boolean;
  deliveryConfirmed?: boolean;
  deliveryError?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const DEAL_MAX_TRY = 12;
const DEAL_INTERVAL = 7000;

async function resolveDeal(
  contentsCode: number | string,
  label: string,
  emit: (e: MixedStep) => void
): Promise<{ dealProductNo: number | null; error?: string }> {
  let resolved = await resolveDealProductNoFromGoods(contentsCode);
  for (let a = 1; !resolved.dealProductNo && a <= DEAL_MAX_TRY; a++) {
    emit({ type: "product", phase: "ORDER", label, ok: true, message: `[${label}] 딜코드 변환 대기 ${a}/${DEAL_MAX_TRY} (전시→goods 반영 ~7초)…` });
    await sleep(DEAL_INTERVAL);
    resolved = await resolveDealProductNoFromGoods(contentsCode);
  }
  if (resolved.dealProductNo) {
    emit({ type: "product", phase: "ORDER", label, ok: true, message: `[${label}] 딜코드 변환 ${contentsCode}(콘텐츠) → ${resolved.dealProductNo}(딜)${resolved.deals && resolved.deals.length > 1 ? ` · 옵션 ${resolved.deals.length}개 중 첫번째` : ""}` });
    return { dealProductNo: resolved.dealProductNo };
  }
  return { dealProductNo: null, error: resolved.error ?? "goods 미반영" };
}

export async function runMixedOrder(
  input: MixedOrderInput,
  onProgress?: (e: MixedStep) => void
): Promise<MixedOrderResult> {
  const emit = (e: MixedStep) => onProgress?.(e);
  const c1 = Math.max(0, Math.min(10, input.count1p | 0));
  const specs = (input.threeP ?? [])
    .map((s) => ({ productType: s.productType, count: Math.max(0, Math.min(10, s.count | 0)) }))
    .filter((s) => s.count > 0);
  const total3p = specs.reduce((n, s) => n + s.count, 0);
  if (c1 + total3p === 0) return { products: [], error: "상품을 1개 이상 선택(개수>0) 해야 함" };

  // 인증 체크
  if (!input.lacmsEmail || !input.lacmsPassword) return { products: [], error: "La-CMS 이메일/패스워드 필수 (전시가 있어야 주문 가능)" };
  if (total3p > 0 && (!input.openapiAccessToken || !input.adminId || !input.adminPw)) {
    return { products: [], error: "3P 포함 시 OpenAPI 토큰 + 어드민 ID/PW 필수" };
  }

  const products: MixedProduct[] = [];
  const namePrefix = input.namePrefix || "QA혼합";

  // ============== 1단계: 상품 생성 ==============
  const summary = [c1 > 0 ? `1P ${c1}` : null, ...specs.map((s) => `${THREEP_LABEL[s.productType] ?? s.productType} ${s.count}`)].filter(Boolean).join(" / ");
  emit({ type: "phase", phase: "PRODUCT", ok: true, message: `상품 생성 시작 — ${summary}` });

  // --- 1P ---
  if (c1 > 0) {
    const p1: Product1pInput = {
      lacmsEmail: input.lacmsEmail, lacmsPassword: input.lacmsPassword,
      count: c1, namePrefix: `${namePrefix}_1P`, basePrice: input.basePrice ?? 5000,
      storageType: "AMBIENT_TEMPERATURE", stockQuantity: input.stockQuantity ?? 10000,
      doMaster: true, doContents: true, doStock: true, doDisplay: true,
    };
    const r = await createProducts1pBatch(p1, (e) =>
      emit({ type: e.type === "product" ? "product" : "phase", phase: "PRODUCT", label: e.productIndex ? `1P #${e.productIndex}` : "1P", ok: e.ok, message: `[1P] ${e.message}` }));
    for (const pr of r) {
      products.push({ group: "1P", index: pr.index, ok: !pr.error && !!pr.masterCode && pr.dealProductNo != null, dealProductNo: pr.dealProductNo != null ? Number(pr.dealProductNo) : null, error: pr.error ?? (pr.dealProductNo == null ? "dealProductNo 추출 실패" : undefined) });
    }
  }

  // --- 3P 유형별 ---
  for (const spec of specs) {
    const label = THREEP_LABEL[spec.productType] ?? spec.productType;
    const p3: Product3pInput = {
      openapiBase: "https://third-party-external-api.stg.kurly.com",
      adminHost: "https://third-party-partner-gateway.stg.kurly.com",
      cmsHost: "https://gateway.cloud.stg.kurly.services",
      accessToken: input.openapiAccessToken!, adminId: input.adminId!, adminPw: input.adminPw!,
      cmsUsername: input.lacmsEmail, cmsPassword: input.lacmsPassword,
      productType: spec.productType, count: spec.count,
      includeLacms: true, doDisplay: true, doStock: true,
    };
    const r3 = await createProducts3pBatch(p3, (e) =>
      emit({ type: e.type === "product" ? "product" : "phase", phase: "PRODUCT", label: e.productIndex ? `${label} #${e.productIndex}` : label, ok: e.ok, message: `[${label}] ${e.message}` }));
    for (const pr of r3.results) {
      products.push({
        group: label, productType: spec.productType, index: pr.index,
        ok: pr.approved && pr.dealProductNo != null,
        partnerProductNo: pr.partnerProductNo,
        contentsCode: pr.dealProductNo ?? null,   // 3P 검색 응답의 dealProductNo 는 사실 콘텐츠코드
        error: pr.error ?? (pr.approved && pr.dealProductNo == null ? "콘텐츠코드 추출 실패" : (!pr.approved ? "승인 실패" : undefined)),
      });
    }
  }

  // ============== 2단계: 딜코드 변환 + 한 주문으로 묶기 ==============
  emit({ type: "phase", phase: "ORDER", ok: true, message: `딜코드 변환 후 한 주문으로 묶기` });

  const quantity = Math.max(1, input.quantity ?? 1);
  const orderItems: OrderItem[] = [];
  for (const p of products) {
    const label = `${p.group} #${p.index}`;
    if (!p.ok) { emit({ type: "product", phase: "ORDER", label, ok: false, message: `[${label}] 상품 단계 실패로 제외: ${p.error}` }); continue; }
    if (p.group === "1P") {
      orderItems.push({ dealProductNo: p.dealProductNo!, quantity });
    } else {
      const res = await resolveDeal(p.contentsCode!, label, emit);
      if (res.dealProductNo) { p.dealProductNo = res.dealProductNo; orderItems.push({ dealProductNo: res.dealProductNo, quantity }); }
      else { p.ok = false; p.error = `딜코드 변환 실패: ${res.error}`; emit({ type: "product", phase: "ORDER", label, ok: false, message: `[${label}] ${p.error} — 이 상품 제외` }); }
    }
  }

  if (orderItems.length === 0) return { products, orderItems, error: "주문 가능한 상품이 없음 (전부 생성/변환 실패)" };
  emit({ type: "phase", phase: "ORDER", ok: true, message: `주문 생성 (상품 ${orderItems.length}종: ${orderItems.map((i) => i.dealProductNo).join(", ")})` });

  const order = await placeMultiProductOrder({
    memberNo: input.memberNo, items: orderItems,
    paymentGatewayId: input.paymentGatewayId, usingFreePoint: input.usingFreePoint,
    clusterCenterCode: input.centerCode, receiverName: input.receiverName, receiverPhoneNumber: input.receiverPhoneNumber,
    address: input.address, addressDetail: input.addressDetail, zipCode: input.zipCode, memo: input.memo,
  }, (e) => emit({ type: "product", phase: "ORDER", label: "주문", ok: e.ok, message: e.message }));

  const result: MixedOrderResult = { products, order, orderItems };
  if (!order.ok) { emit({ type: "product", phase: "ORDER", label: "주문", ok: false, message: `주문 실패: ${order.error}` }); return result; }
  emit({ type: "product", phase: "ORDER", label: "주문", ok: true, message: `✅ 단일 주문 생성 groupOrderNo=${order.groupOrderNo} (상품 ${orderItems.length}종)` });

  // ============== 3단계(선택): 배송완료 — 3P가 전부 NORMAL_PARCEL 일 때만 ==============
  if (input.markDelivered3p && order.groupOrderNo != null && total3p > 0) {
    const allDeliverable = specs.every((s) => DELIVERABLE_3P_TYPES.includes(s.productType));
    if (!allDeliverable) {
      emit({ type: "product", phase: "DELIVERED", label: "배송", ok: true, message: `배송완료 자동화 스킵 — 발송처리(일반택배 배치)와 호환되는 3P 유형은 일반(택배)뿐. 다른 유형이 섞여 있어요.` });
    } else {
      emit({ type: "product", phase: "DELIVERED", label: "배송", ok: true, message: `3P 배송 처리 시작 (발주확인→발송처리→배송완료, 대표 ${order.groupOrderNo})` });
      const fd = await runFull3pDelivery(order.groupOrderNo, input.openapiAccessToken!, {
        onProgress: (msg, ok) => emit({ type: "product", phase: "DELIVERED", label: "배송", ok, message: msg }),
      });
      result.delivered = fd.ok;
      result.deliveryConfirmed = fd.deliveryConfirmed;
      if (!fd.ok) result.deliveryError = fd.error ?? "배송 처리 일부 실패";
      const note = fd.deliveryConfirmed === true ? " — DB 반영 확인됨 ✅" : fd.deliveryConfirmed === false ? " — 발행 OK(DB 반영 지연 가능)" : "";
      emit({ type: "product", phase: "DELIVERED", label: "배송", ok: fd.ok, message: fd.ok ? `✅ 배송완료까지 처리 완료${note}` : `배송 처리 실패: ${result.deliveryError}` });
    }
  }

  return result;
}
