/**
 * 테스트 데이터 — 주문 생성 (STG 내부 게이트웨이, 쿠키리스)
 *
 * 인증: X-KURLY-MEMBER-NO 헤더만 (ksi/kdi/krt 쿠키·리캡차 로그인 전부 제거).
 *   내부 게이트웨이(gateway.cloud.stg.kurly.services)는 이 헤더만으로 회원 인증 — 실증 완료.
 *
 * 흐름 (전부 게이트웨이 + memberNo 헤더):
 *   0. addressbook/default          → memberNo 의 기본 배송지 + cluster_center_code 자동 조회
 *   1. external-cart/v2/add         → 장바구니 담기
 *   2. v2/proceed-to-checkout       → 주문서 진입 (clean 주소 + 센터코드 헤더 필수)
 *   3. v1/checkout (GET)            → deliveryPrice / totalPaymentPrice
 *   4. v1/payment-price/calculate   → 적립금 전액 사용 등록
 *   5. v2/place-order               → 가주문 → groupOrderNo + transactionId
 *   6. v1/payment-complete          → 결제 완료 (적립금 결제 확정)
 *
 * 검증된 함정: user-agent 는 'ios' 같은 토큰(브라우저 UA면 500) / 도로명주소는 빌딩명 "(...)" 제거
 *   / 센터코드는 addressbook 의 cluster_center_code (틀리면 400 "배송불가") / dealProductNo 유효성 중요.
 */

const GATEWAY = process.env.KURLY_STG_GATEWAY || "https://gateway.cloud.stg.kurly.services";
const ADDR_DEFAULT_URL = `${GATEWAY}/addressbook/v1/common/addresses/default`;
const CART_ADD_URL = `${GATEWAY}/order-receipt/external-cart/v2/add`;
const CHECKOUT_URL = `${GATEWAY}/order-receipt/v2/proceed-to-checkout`;
const CHECKOUT_GET_URL = `${GATEWAY}/order-receipt/v1/checkout`;
const PAYMENT_CALC_URL = `${GATEWAY}/order-receipt/v1/payment-price/calculate`;
const PLACE_ORDER_URL = `${GATEWAY}/order-receipt/v2/place-order`;
const PAYMENT_COMPLETE_URL = `${GATEWAY}/order-receipt/v1/payment-complete`;

// 게이트웨이는 브라우저 UA 가 아니라 토큰형 user-agent 를 기대 (Mozilla/... → 500)
const UA_TOKEN = "ios";

export interface OrderCreateInput {
  memberNo: number | string;           // 필수 — 게이트웨이 인증 (X-KURLY-MEMBER-NO)
  dealProductNo: number | string;      // 주문할 상품
  quantity?: number;
  count?: number;                      // 생성할 주문 수
  usingFreePoint?: number;             // 미지정 시 결제예정금액 전액 자동
  paymentGatewayId?: string;           // 기본 "kurly" (적립금/컬리페이)
  // 배송지 — 미지정 시 기본 배송지 자동 조회. 일부만 줘도 자동값 위에 덮어씀.
  address?: string;
  addressDetail?: string;
  zipCode?: string;
  receiverName?: string;
  receiverPhoneNumber?: string;
  clusterCenterCode?: string;
  memo?: string;
}

export interface OrderCreateResult {
  index: number;
  ok: boolean;
  status?: number;
  cartOk?: boolean;
  checkoutOk?: boolean;
  placeOrderOk?: boolean;
  paymentCompleteOk?: boolean;
  groupOrderNo?: string | number | null;
  transactionId?: string | null;
  totalPaymentPrice?: number | null;
  rawResponse?: unknown;
  error?: string;
}

export interface OrderProgressEvent {
  type: "step" | "product";
  step?: "ADDRESS" | "CART" | "CHECKOUT" | "CALC" | "PLACE_ORDER" | "PAYMENT_COMPLETE";
  productIndex?: number;
  ok: boolean;
  message: string;
}

interface HttpResp { ok: boolean; status: number; data: any; }

function headers(memberNo: string, centerCode?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-KURLY-MEMBER-NO": memberNo,
    "user-agent": UA_TOKEN,
  };
  if (centerCode) h["X-KURLY-CLUSTER-CENTER-CODE"] = centerCode;
  return h;
}

async function http(method: string, url: string, h: Record<string, string>, body?: unknown): Promise<HttpResp> {
  try {
    const res = await fetch(url, { method, headers: h, body: body != null ? JSON.stringify(body) : undefined });
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: err instanceof Error ? err.message : String(err) };
  }
}

// 도로명주소에서 빌딩명 괄호 "(...)" 제거 — 괄호 들어가면 checkout 500.
function cleanRoadAddress(road: string): string {
  return (road || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function errMsg(r: HttpResp, label: string): string {
  const m = r.data?.message ?? r.data?.error?.message ?? (typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? {}).slice(0, 200));
  return `${label} HTTP ${r.status}: ${m}`;
}

export interface DefaultAddress {
  roadAddress: string;
  addressDetail: string;
  zipCode: string;
  clusterCenterCode: string | null;
  receiverName: string;
  receiverPhone: string;
  deliverable: boolean;       // delivery_operation_time != null
  raw: any;
}

// memberNo 의 기본 배송지 조회 — 배송 가능 여부 + 센터코드까지.
export async function fetchDefaultAddress(memberNo: string): Promise<{ ok: boolean; address?: DefaultAddress; error?: string }> {
  const r = await http("GET", ADDR_DEFAULT_URL, headers(memberNo));
  if (!r.ok || r.data?.success === false) return { ok: false, error: errMsg(r, "addressbook/default") };
  const d = r.data?.data;
  if (!d || !d.road_address) return { ok: false, error: "기본 배송지 없음 (회원에 등록된 배송지가 없음)" };
  return {
    ok: true,
    address: {
      roadAddress: d.road_address,
      addressDetail: d.address_sub ?? "",
      zipCode: d.road_zonecode ?? d.zipcode ?? "",
      clusterCenterCode: d.cluster_center_code ?? null,
      receiverName: d.name || "",
      receiverPhone: d.mobile || "",
      deliverable: d.delivery_operation_time != null,
      raw: d,
    },
  };
}

// ============== 단계별 호출 ==============

// 카트/주문서 아이템 (다상품 지원). 1P·3P·FBK 혼합 가능 — 컬리몰이 배송그룹을 타입별로 자동 분리.
export interface OrderItem { dealProductNo: number; quantity: number; }

async function addToCart(memberNo: string, centerCode: string | undefined, items: OrderItem[]) {
  const r = await http("POST", CART_ADD_URL, headers(memberNo, centerCode), { cartItems: items });
  if (!r.ok || r.data?.success === false) return { ok: false, error: errMsg(r, "cart"), raw: r.data };
  return { ok: true, raw: r.data };
}

async function proceedToCheckout(memberNo: string, centerCode: string | undefined, address: string, addressDetail: string, items: OrderItem[]) {
  const body = {
    address,
    addressDetail,
    dealProducts: items,
    isDirectCheckout: false,
    applyMaxBenefitCoupon: false,
  };
  const r = await http("POST", CHECKOUT_URL, headers(memberNo, centerCode), body);
  if (!r.ok || r.data?.success === false) {
    // 인증은 통과(cart까지 OK)인데 checkout 만 500/9999 면 상품 자체가 주문서 진입 불가 상태일 때가 많음
    // (배송정책 비호환 / 가격·배송 데이터 미완 / 인덱싱). 회원/주소/인증 문제가 아님을 분명히.
    const hint = (r.status === 500 || r.data?.code === "9999")
      ? ` — 이 상품이 주문서 진입 불가 상태일 수 있음 (배송정책 비호환·상품 가격/배송 데이터 미완 등). 인증/배송지 문제 아님(dealProductNo ${items.map((it) => it.dealProductNo).join(",")})`
      : "";
    return { ok: false, error: errMsg(r, "checkout") + hint, raw: r.data };
  }
  return { ok: true, raw: r.data };
}

async function getCheckout(memberNo: string, centerCode: string | undefined) {
  const r = await http("GET", CHECKOUT_GET_URL, headers(memberNo, centerCode));
  if (!r.ok || r.data?.success === false) return { ok: false, error: errMsg(r, "checkout-get"), raw: r.data };
  const d = r.data?.data ?? {};
  return {
    ok: true,
    deliveryPrice: d.deliveryPrice ?? 0,
    totalPaymentPrice: d.totalPaymentPrice ?? 0,
    totalDealProductsPrice: d.totalDealProductsPrice ?? 0,
    availablePoint: d.availablePoint ?? null,
    raw: r.data,
  };
}

async function paymentCalculate(memberNo: string, centerCode: string | undefined, deliveryPrice: number, usingFreePoint: number, paymentGatewayId: string) {
  const body = {
    couponCode: null,
    productCoupons: [],
    plccDiscountPrice: 0,
    usingFreePoint,
    deliveryPrice,
    paymentGatewayId,
    creditCardId: null,
    type: null,
    reserveRateForChargedAmountUse: 1,
  };
  const r = await http("POST", PAYMENT_CALC_URL, headers(memberNo, centerCode), body);
  if (!r.ok || r.data?.success === false) return { ok: false, error: errMsg(r, "payment-calc"), raw: r.data };
  return { ok: true, totalPaymentPrice: r.data?.data?.totalPaymentPrice ?? null, raw: r.data };
}

function buildPlaceOrderBody(input: OrderCreateInput, addr: ResolvedAddr, usingFreePoint: number) {
  return {
    couponCode: null,
    productCoupons: [],
    plccDiscountPrice: 0,
    usingFreePoint,
    paymentGatewayId: input.paymentGatewayId ?? "kurly",
    creditCardParameter: null,
    kurlypayEasyPaymentParameter: null,
    paymentSuccessRedirectUrl: "https://www.stg.kurly.com/order/checkout/process/kurly",
    paymentFailRedirectUrl: "https://www.stg.kurly.com/order/checkout/fail/pay-fail",
    paymentCancelRedirectUrl: "https://www.stg.kurly.com/order/checkout/cancel/kurly",
    memo: input.memo ?? "",
    receiverName: addr.receiverName,
    receiverPhoneNumber: addr.receiverPhone,
    address: addr.road,
    addressDetail: addr.detail,
    zipCode: addr.zip,
    pickupType: "DOOR",
    pickupDetail: "",
    pickupDetailCategory: null,
    accessMethod: "FREE",
    accessDetail: "",
    deliveryMessageTimeType: "IMMEDIATELY",
    packingType: null,
    userAgent: { applicationType: "DESKTOP_WEB", platform: "DESKTOP", appVersion: null },
    termsAgreements: [
      { termsCode: "M01", agreed: true },
      { termsCode: "M02", agreed: true },
      { termsCode: "M04", agreed: true },
    ],
    pickup: null,
    personalCustomsCode: "",
    reserveRateForChargedAmountUse: 1,
  };
}

async function placeOrder(memberNo: string, centerCode: string | undefined, body: ReturnType<typeof buildPlaceOrderBody>) {
  const r = await http("POST", PLACE_ORDER_URL, headers(memberNo, centerCode), body);
  if (!r.ok || r.data?.success === false) return { ok: false, error: errMsg(r, "place-order"), raw: r.data };
  const d = r.data?.data ?? {};
  const txn = d.paymentAuthParameter?.paymentGatewayTransactionId
    ?? d.paymentGatewayTransactionId
    ?? d.transactionId
    ?? null;
  return { ok: true, groupOrderNo: d.groupOrderNo ?? null, transactionId: txn, raw: r.data };
}

async function paymentComplete(memberNo: string, centerCode: string | undefined, groupOrderNo: unknown, transactionId: string) {
  const r = await http("POST", PAYMENT_COMPLETE_URL, headers(memberNo, centerCode), {
    groupOrderNo: String(groupOrderNo),
    paymentGatewayAuthNo: "",
    paymentGatewayAuthToken: "",
    paymentGatewayToken: "",
    paymentGatewayTransactionId: transactionId,
  });
  if (!r.ok || r.data?.success === false) return { ok: false, error: errMsg(r, "payment-complete"), raw: r.data };
  return { ok: true, totalPaymentPrice: r.data?.data?.totalPaymentPrice ?? null, raw: r.data };
}

interface ResolvedAddr { road: string; detail: string; zip: string; center?: string; receiverName: string; receiverPhone: string; }

// ============== Main ==============

export async function placeOrderBatch(
  input: OrderCreateInput,
  onProgress?: (e: OrderProgressEvent) => void
): Promise<OrderCreateResult[]> {
  const emit = (e: OrderProgressEvent) => onProgress?.(e);
  const memberNo = String(input.memberNo ?? "").trim();
  if (!memberNo) throw new Error("memberNo (회원번호) 필수");
  const total = Math.max(1, Math.min(20, input.count ?? 1));
  const quantity = Math.max(1, Math.min(100, input.quantity ?? 1));
  const dealProductNo = Number(input.dealProductNo);
  if (!dealProductNo) throw new Error("dealProductNo 필수");

  // STEP 0: 기본 배송지 자동 조회 (배치 1회). 입력 override 가 있으면 덮어씀.
  const def = await fetchDefaultAddress(memberNo);
  if (!def.ok || !def.address) {
    emit({ type: "step", step: "ADDRESS", ok: false, message: `기본 배송지 조회 실패: ${def.error}` });
    return [{ index: 1, ok: false, error: `기본 배송지 조회 실패: ${def.error}` }];
  }
  const a = def.address;
  const addr: ResolvedAddr = {
    road: cleanRoadAddress(input.address || a.roadAddress),
    detail: input.addressDetail ?? a.addressDetail,
    zip: input.zipCode ?? a.zipCode,
    center: input.clusterCenterCode ?? a.clusterCenterCode ?? undefined,
    receiverName: input.receiverName || a.receiverName || "QA테스트",
    receiverPhone: input.receiverPhoneNumber || a.receiverPhone || "01011111111",
  };
  if (!input.address && !a.deliverable) {
    emit({ type: "step", step: "ADDRESS", ok: false, message: `기본 배송지가 배송 불가(delivery_operation_time=null) — 배송지 변경 필요` });
    return [{ index: 1, ok: false, error: "기본 배송지가 배송 불가 지역" }];
  }
  emit({ type: "step", step: "ADDRESS", ok: true, message: `기본 배송지 ${addr.road} (센터 ${addr.center ?? "-"}, 수령 ${addr.receiverName})` });

  const results: OrderCreateResult[] = [];
  for (let i = 0; i < total; i++) {
    const idx = i + 1;
    const result: OrderCreateResult = { index: idx, ok: false };

    const items: OrderItem[] = [{ dealProductNo, quantity }];
    const cart = await addToCart(memberNo, addr.center, items);
    result.cartOk = cart.ok;
    if (!cart.ok) { result.error = cart.error; result.rawResponse = cart.raw; emit({ type: "product", step: "CART", productIndex: idx, ok: false, message: `[#${idx}] ${cart.error}` }); results.push(result); continue; }
    emit({ type: "product", step: "CART", productIndex: idx, ok: true, message: `[#${idx}] 장바구니 담기 OK` });

    const checkout = await proceedToCheckout(memberNo, addr.center, addr.road, addr.detail, items);
    result.checkoutOk = checkout.ok;
    if (!checkout.ok) { result.error = checkout.error; result.rawResponse = checkout.raw; emit({ type: "product", step: "CHECKOUT", productIndex: idx, ok: false, message: `[#${idx}] ${checkout.error}` }); results.push(result); continue; }
    emit({ type: "product", step: "CHECKOUT", productIndex: idx, ok: true, message: `[#${idx}] 주문서 진입 OK` });

    const ck = await getCheckout(memberNo, addr.center);
    if (!ck.ok) { result.error = ck.error; result.rawResponse = ck.raw; emit({ type: "product", step: "CALC", productIndex: idx, ok: false, message: `[#${idx}] ${ck.error}` }); results.push(result); continue; }
    const totalPaymentPrice = input.usingFreePoint ?? ck.totalPaymentPrice ?? 0;
    emit({ type: "product", step: "CALC", productIndex: idx, ok: true, message: `[#${idx}] 결제예정 ${ck.totalPaymentPrice}원 (상품 ${ck.totalDealProductsPrice} + 배송 ${ck.deliveryPrice})` });

    // 적립금 전액 사용 등록
    const calc = await paymentCalculate(memberNo, addr.center, ck.deliveryPrice, totalPaymentPrice, input.paymentGatewayId ?? "kurly");
    if (!calc.ok) { result.error = `적립금 사용 등록 실패: ${calc.error}`; result.rawResponse = calc.raw; emit({ type: "product", step: "CALC", productIndex: idx, ok: false, message: `[#${idx}] ${result.error}` }); results.push(result); continue; }
    emit({ type: "product", step: "CALC", productIndex: idx, ok: true, message: `[#${idx}] 적립금 ${totalPaymentPrice}원 사용 등록 (최종 ${calc.totalPaymentPrice}원)` });

    const order = await placeOrder(memberNo, addr.center, buildPlaceOrderBody(input, addr, totalPaymentPrice));
    result.placeOrderOk = order.ok;
    result.groupOrderNo = order.groupOrderNo;
    result.transactionId = order.transactionId;
    if (!order.ok) { result.error = order.error; result.rawResponse = order.raw; emit({ type: "product", step: "PLACE_ORDER", productIndex: idx, ok: false, message: `[#${idx}] ${order.error}` }); results.push(result); continue; }
    emit({ type: "product", step: "PLACE_ORDER", productIndex: idx, ok: true, message: `[#${idx}] 가주문 생성 ${order.groupOrderNo}` });

    if (order.transactionId) {
      const pc = await paymentComplete(memberNo, addr.center, order.groupOrderNo, order.transactionId);
      result.paymentCompleteOk = pc.ok;
      result.totalPaymentPrice = pc.totalPaymentPrice;
      result.rawResponse = pc.raw;
      if (!pc.ok) { result.error = pc.error; emit({ type: "product", step: "PAYMENT_COMPLETE", productIndex: idx, ok: false, message: `[#${idx}] ${pc.error}` }); results.push(result); continue; }
      emit({ type: "product", step: "PAYMENT_COMPLETE", productIndex: idx, ok: true, message: `[#${idx}] 결제 완료 ${order.groupOrderNo} (${pc.totalPaymentPrice}원)` });
      result.ok = true;
    } else {
      result.error = "transactionId 없음 — payment-complete 스킵 (가주문까지 성공)";
      result.ok = order.ok;
    }
    results.push(result);
  }
  return results;
}

// ============== 다상품 단일 주문 (1P + 3P + FBK 혼합) ==============
// 여러 dealProductNo 를 한 카트에 담아 하나의 groupOrderNo 로 주문. 컬리몰이 배송그룹을 타입별 자동 분리.
// (주문 생성 단계는 상품 타입을 구분하지 않음 — dealProductNo 만 유효하면 됨.)

export interface MultiOrderInput {
  memberNo: number | string;
  items: OrderItem[];                  // 한 주문에 담을 상품들 (혼합 가능)
  usingFreePoint?: number;             // 미지정 시 결제예정금액 전액 자동
  paymentGatewayId?: string;
  address?: string;
  addressDetail?: string;
  zipCode?: string;
  receiverName?: string;
  receiverPhoneNumber?: string;
  clusterCenterCode?: string;
  memo?: string;
}

export async function placeMultiProductOrder(
  input: MultiOrderInput,
  onProgress?: (e: OrderProgressEvent) => void
): Promise<OrderCreateResult> {
  const emit = (e: OrderProgressEvent) => onProgress?.(e);
  const memberNo = String(input.memberNo ?? "").trim();
  if (!memberNo) throw new Error("memberNo (회원번호) 필수");
  const items = (input.items ?? []).filter((it) => Number(it.dealProductNo) > 0)
    .map((it) => ({ dealProductNo: Number(it.dealProductNo), quantity: Math.max(1, Math.min(100, it.quantity || 1)) }));
  if (items.length === 0) throw new Error("주문할 상품(dealProductNo) 최소 1개 필요");

  const result: OrderCreateResult = { index: 1, ok: false };

  // STEP 0: 기본 배송지
  const def = await fetchDefaultAddress(memberNo);
  if (!def.ok || !def.address) {
    emit({ type: "step", step: "ADDRESS", ok: false, message: `기본 배송지 조회 실패: ${def.error}` });
    return { ...result, error: `기본 배송지 조회 실패: ${def.error}` };
  }
  const a = def.address;
  const addr: ResolvedAddr = {
    road: cleanRoadAddress(input.address || a.roadAddress),
    detail: input.addressDetail ?? a.addressDetail,
    zip: input.zipCode ?? a.zipCode,
    center: input.clusterCenterCode ?? a.clusterCenterCode ?? undefined,
    receiverName: input.receiverName || a.receiverName || "QA테스트",
    receiverPhone: input.receiverPhoneNumber || a.receiverPhone || "01011111111",
  };
  if (!input.address && !a.deliverable) {
    emit({ type: "step", step: "ADDRESS", ok: false, message: `기본 배송지가 배송 불가(delivery_operation_time=null)` });
    return { ...result, error: "기본 배송지가 배송 불가 지역" };
  }
  emit({ type: "step", step: "ADDRESS", ok: true, message: `배송지 ${addr.road} (센터 ${addr.center ?? "-"}) · 상품 ${items.length}종` });

  // 1) 카트 담기 (전 상품 한 번에)
  const cart = await addToCart(memberNo, addr.center, items);
  result.cartOk = cart.ok;
  if (!cart.ok) { emit({ type: "step", step: "CART", ok: false, message: cart.error! }); return { ...result, error: cart.error, rawResponse: cart.raw }; }
  emit({ type: "step", step: "CART", ok: true, message: `장바구니 담기 OK (${items.map((it) => `${it.dealProductNo}×${it.quantity}`).join(", ")})` });

  // 2) 주문서 진입
  const checkout = await proceedToCheckout(memberNo, addr.center, addr.road, addr.detail, items);
  result.checkoutOk = checkout.ok;
  if (!checkout.ok) { emit({ type: "step", step: "CHECKOUT", ok: false, message: checkout.error! }); return { ...result, error: checkout.error, rawResponse: checkout.raw }; }
  emit({ type: "step", step: "CHECKOUT", ok: true, message: `주문서 진입 OK (배송그룹 자동 분리)` });

  // 3) 결제예정금액
  const ck = await getCheckout(memberNo, addr.center);
  if (!ck.ok) { emit({ type: "step", step: "CALC", ok: false, message: ck.error! }); return { ...result, error: ck.error, rawResponse: ck.raw }; }
  const usingFreePoint = input.usingFreePoint ?? ck.totalPaymentPrice ?? 0;
  emit({ type: "step", step: "CALC", ok: true, message: `결제예정 ${ck.totalPaymentPrice}원 (상품 ${ck.totalDealProductsPrice} + 배송 ${ck.deliveryPrice})` });

  // 4) 적립금 사용 등록
  const calc = await paymentCalculate(memberNo, addr.center, ck.deliveryPrice, usingFreePoint, input.paymentGatewayId ?? "kurly");
  if (!calc.ok) { emit({ type: "step", step: "CALC", ok: false, message: `적립금 사용 등록 실패: ${calc.error}` }); return { ...result, error: `적립금 사용 등록 실패: ${calc.error}`, rawResponse: calc.raw }; }
  emit({ type: "step", step: "CALC", ok: true, message: `적립금 ${usingFreePoint}원 사용 등록 (최종 ${calc.totalPaymentPrice}원)` });

  // 5) 가주문
  const orderInput = { ...input, dealProductNo: items[0].dealProductNo } as unknown as OrderCreateInput;
  const order = await placeOrder(memberNo, addr.center, buildPlaceOrderBody(orderInput, addr, usingFreePoint));
  result.placeOrderOk = order.ok;
  result.groupOrderNo = order.groupOrderNo;
  result.transactionId = order.transactionId;
  if (!order.ok) { emit({ type: "step", step: "PLACE_ORDER", ok: false, message: order.error! }); return { ...result, error: order.error, rawResponse: order.raw }; }
  emit({ type: "step", step: "PLACE_ORDER", ok: true, message: `가주문 생성 ${order.groupOrderNo}` });

  // 6) 결제 완료
  if (order.transactionId) {
    const pc = await paymentComplete(memberNo, addr.center, order.groupOrderNo, order.transactionId);
    result.paymentCompleteOk = pc.ok;
    result.totalPaymentPrice = pc.totalPaymentPrice;
    result.rawResponse = pc.raw;
    if (!pc.ok) { emit({ type: "step", step: "PAYMENT_COMPLETE", ok: false, message: pc.error! }); return { ...result, error: pc.error }; }
    emit({ type: "step", step: "PAYMENT_COMPLETE", ok: true, message: `결제 완료 ${order.groupOrderNo} (${pc.totalPaymentPrice}원)` });
    result.ok = true;
  } else {
    result.ok = order.ok;
    result.error = "transactionId 없음 — payment-complete 스킵 (가주문까지 성공)";
  }
  return result;
}
