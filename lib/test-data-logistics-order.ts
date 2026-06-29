/**
 * 테스트 데이터 — 물류 주문 생성 (1P 컬리몰)  [Phase 1]
 *
 * 원본: fulfillment_sqe_studio `pages/1_order_generator.py` 의 1P 플로우 포팅.
 *   Streamlit + requests → Node fetch. 진행상황은 SSE 콜백.
 *
 * 흐름 (주소 1건 = 주문 1건):
 *   0. 로그인 (auth.stg.kurly.com/login) → accessToken
 *   1. 온도대별(210냉장/220냉동/225상온) 상품 선택 (CSV deal_test_type, 1P/FBK 모드)
 *   2. 상품별 PMS 조회 → 기준가/배송비유형(PAY|FREE) → 합계·배송비(무료조건 or 4만원↑)
 *   3. proceed-to-checkout → place-order(적립금 전액 결제) → payment-complete
 *   4. (옵션) OMS testTransferPlan → logistics-tracking 으로 출고요청번호 조회
 *
 * 운송장(invoice)은 Kafka TMS 발행(Phase 2) 후에야 채워짐 — 여기선 출고요청번호까지.
 * 호스트는 env 오버라이드 가능.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { publishTmsForOrder } from "./test-data-logistics-tms";

const AUTH = process.env.KURLY_AUTH_STG || "https://auth.stg.kurly.com";
const API = process.env.KURLY_API_STG || "https://api.stg.kurly.com";
const PMS = process.env.KURLY_PMS_STG || "https://int-pms-internal-api.cloud.stg.kurly.services";
const SOMS = process.env.KURLY_SOMS_STG || "https://soms-api.stg.kurly.services";
const OMS_OP = process.env.KURLY_OMS_OP_STG || "https://oms-order-operation.stg.kurly.services";

// 원본 COMMON_HEADERS (브라우저 UA 아닌 앱 토큰형 — 게이트웨이가 기대)
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": "OS/iOS (16.6) AppVersion/300.27.0 (4074) Device/iPhone11,2 ADID/5D8B69C4-1234-45A8-1234-2FE0886AB5A8 Kurly/3.27.0 (4074) DeviceID/F19B1D75-4B1A-4F56-8A55-9AB845830738",
  "Content-Type": "application/json",
};

// 특수 권역 → DAY 배송, 그 외 DAWN
const SPECIAL_REGIONS = new Set(["JE", "NP", "NJ", "CT", "LT", "LK", "LP"]);

// 센터 → 권역 목록 (all_center.csv 에서 추출, 폼 셀렉터용으로도 공유)
export const CENTER_REGIONS: Record<string, string[]> = {
  "2cc": ["A", "B", "C", "D", "F", "S", "T", "W", "X", "Z"],
  "3cc": ["-", "CA", "CS", "DJ", "GW", "H", "M", "PT", "R", "U", "Y"],
  "4cc": ["BS", "DE", "DW", "GC", "JI", "PG", "UL", "YS"],
};

export type OrderMode = "미선택" | "1P 상품" | "FBK 포함 (1P+FBK)" | "FBK 상품만";
export interface ZoneSel { mode: OrderMode; cnt: number; qty: number }

export interface OrderRunInput {
  userId: string;
  userPw: string;
  cool: ZoneSel;   // 210 냉장
  froz: ZoneSel;   // 220 냉동
  room: ZoneSel;   // 225 상온
  center: string;
  regions: string[];
  addrMode: "R" | "A";      // 랜덤 1개 / 전체 반복
  repeatCnt: number;         // R 모드에서 권역별 반복 수
  omsTransfer: boolean;
  publishTms?: boolean;      // 주문 생성 후 Kafka TMS 발행 (운송장 생성) — Phase 2
}

export interface OrderResult {
  index: number;
  ok: boolean;
  orderNo?: string;
  outbound?: string;
  region?: string;
  totalPrice?: number;
  status: string;
  invoice?: string;          // TMS 발행으로 생성된 운송장(shippingLabel)들
  tmsPublished?: number;     // TMS 발행 메시지 수
  error?: string;
}
export interface OrderProgressEvent { type: "order"; index: number; ok: boolean; message: string }

const MAX_ORDERS = 100;  // 안전 상한 (원본은 무제한 — STG 폭주 방지)

// ── CSV 로딩 (모듈 캐시) ──────────────────────────────
interface DealProduct { orderType: string; dealProductNo: string; price: number; itemGroup: string }
export interface CenterAddr { address: string; addressDetail: string }
let _deals: DealProduct[] | null = null;
let _centers: Record<string, Record<string, CenterAddr[]>> | null = null;

function dataPath(name: string): string {
  return join(process.cwd(), "lib", "logistics-data", name);
}

function loadDeals(): DealProduct[] {
  if (_deals) return _deals;
  const text = readFileSync(dataPath("deal_test_type.csv"), "utf-8");
  const out: DealProduct[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split(",");
    const orderType = (p[0] || "").trim();
    const dealProductNo = (p[1] || "").trim();
    if (!orderType || !dealProductNo) continue;
    const price = parseInt((p[2] || "0").trim(), 10) || 0;
    let itemGroup = (p[3] || "").trim().toUpperCase();
    if (!itemGroup || itemGroup === "NAN") itemGroup = "1P";
    out.push({ orderType, dealProductNo, price, itemGroup });
  }
  _deals = out;
  return out;
}

function loadCenters(): Record<string, Record<string, CenterAddr[]>> {
  if (_centers) return _centers;
  const text = readFileSync(dataPath("all_center.csv"), "utf-8").replace(/^﻿/, "");
  const centers: Record<string, Record<string, CenterAddr[]>> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const p = line.split(",");
    const center = (p[0] || "").trim();
    const region = (p[1] || "").trim();
    const address = (p[2] || "").trim();
    const addressDetail = (p[3] || "").trim();
    if (!center || !region) continue;
    (centers[center] ??= {});
    (centers[center][region] ??= []);
    centers[center][region].push({ address, addressDetail });
  }
  _centers = centers;
  return centers;
}

/** 센터 주소 풀 공유 (KLS 등 다른 물류 생성기에서 all_center.csv 재사용). */
export function loadCenterAddresses(): Record<string, Record<string, CenterAddr[]>> {
  return loadCenters();
}

// ── 상품 선택 (원본 pick_products_by_mode 포팅) ─────────
function sample<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, Math.min(n, a.length)));
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface PickedItem { orderType: string; dealProductNo: string; price: number; itemGroup: string; order_quantity: number; deliveryPrice?: string }

function pickProductsByMode(orderType: number, mode: OrderMode, cnt: number, qty: number): PickedItem[] {
  if (mode === "미선택") return [];
  const deals = loadDeals();
  const pool = deals.filter((p) => String(p.orderType) === String(orderType));
  if (!pool.length) return [];
  const pool1p = pool.filter((p) => p.itemGroup === "1P");
  const poolFbk = pool.filter((p) => p.itemGroup === "FBK");

  let selected: DealProduct[] = [];
  if (mode === "1P 상품") {
    if (!pool1p.length) return [];
    const actual = cnt > 0 ? Math.min(cnt, pool1p.length) : randInt(1, pool1p.length);
    selected = sample(pool1p, actual);
  } else if (mode === "FBK 상품만") {
    if (!poolFbk.length) return [];
    const actual = cnt > 0 ? Math.min(cnt, poolFbk.length) : randInt(1, poolFbk.length);
    selected = sample(poolFbk, actual);
  } else if (mode === "FBK 포함 (1P+FBK)") {
    const actual = cnt >= 2 ? cnt : 2;   // 최소 2종
    if (!pool1p.length || !poolFbk.length) return [];
    selected = [...sample(pool1p, 1), ...sample(poolFbk, 1)];
    const remaining = actual - 2;
    if (remaining > 0) {
      const rest = pool.filter((p) => !selected.includes(p));
      if (rest.length) selected.push(...sample(rest, Math.min(remaining, rest.length)));
    }
  }
  return selected.map((item) => ({ ...item, order_quantity: qty }));
}

// ── PMS 상품정보 (기준가/배송비) ───────────────────────
async function getPmsProductInfo(dealNo: string): Promise<{ basePrice: number; deliveryPrice: string } | null> {
  const url = `${PMS}/v1/product/contents?page=0&pageSize=10&sortBy=CONTENTS_CODE&orderBy=ASC&dealProductNos=${encodeURIComponent(dealNo)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Kurly/Test-Tool", accept: "*/*" } });
    if (res.status !== 200) return null;
    const data: any = await res.json();
    if (data?.success && data?.data?.content?.length) {
      const dp = data.data.content[0].dealProducts || [];
      if (dp.length) {
        const first = dp[0];
        const deliveryPrice = first.deliveryPrice || "PAY";
        const basePrice = first.masterProduct?.basePrice || 0;
        return { basePrice, deliveryPrice };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── API 호출 ──────────────────────────────────────────
async function apiLogin(userId: string, userPw: string): Promise<{ token?: string; error?: string }> {
  try {
    const res = await fetch(`${AUTH}/login`, {
      method: "POST", headers: COMMON_HEADERS,
      body: JSON.stringify({ id: userId, password: userPw, clientCaptcha: false }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.status === 200) return { token: json?.data?.accessToken };
    const errors = json?.data?.errors || [];
    const msg = errors[0]?.messages?.[0] || json?.message || "로그인 실패";
    return { error: msg };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function authHeaders(token: string): Record<string, string> {
  return { ...COMMON_HEADERS, "KURLY-AUTH": token };
}

async function apiCheckout(token: string, items: PickedItem[], address: string, addressDetail: string, deliveryPolicy: string): Promise<{ ok: boolean; error?: string }> {
  const dealProducts = items.map((p) => ({ dealProductNo: String(p.dealProductNo), quantity: Number(p.order_quantity) }));
  try {
    const res = await fetch(`${API}/order/v2/proceed-to-checkout`, {
      method: "POST", headers: authHeaders(token),
      body: JSON.stringify({ dealProducts, address, addressDetail, deliveryPolicy, isDirectCheckout: false, showKurlyMembersPopupMessage: true }),
    });
    if (res.status === 200) return { ok: true };
    const json: any = await res.json().catch(() => ({}));
    return { ok: false, error: json?.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function apiPlaceOrder(token: string, totalPrice: number, address: string, addressDetail: string): Promise<{ orderNo?: string; error?: string }> {
  const data = {
    couponCode: null, usingFreePoint: totalPrice, paymentGatewayId: "kurly", creditCardParameter: null,
    paymentSuccessRedirectUrl: "https://www.stg.kurly.com/order/checkout/process/kurly",
    paymentFailRedirectUrl: "https://www.stg.kurly.com/order/checkout/fail/pay-fail",
    paymentCancelRedirectUrl: "https://www.stg.kurly.com/order/checkout/cancel/kurly",
    receiverName: "김오토", receiverPhoneNumber: "01000000001",
    address, addressDetail, pickupType: "DOOR", pickupDetail: "", accessMethod: "FREE", accessDetail: "",
    memo: "", deliveryMessageTimeType: "IMMEDIATELY", addressExtraData: "", packingType: "PAPER",
    userAgent: { applicationType: "MOBILE_WEB", platform: "IOS", appVersion: null },
    termsAgreements: [{ termsCode: "M01", agreed: true }, { termsCode: "M02", agreed: true }, { termsCode: "M04", agreed: true }],
    pickup: null,
    kurlypayEasyPaymentParameter: { paymentType: "add-plcc", paymentMethodId: "plcc-lottie", useCardPoint: false, deviceId: "" },
    plccDiscountPrice: 0,
  };
  try {
    const res = await fetch(`${API}/order/v2/place-order`, { method: "POST", headers: authHeaders(token), body: JSON.stringify(data) });
    const json: any = await res.json().catch(() => ({}));
    if (res.status === 200) return { orderNo: json?.data?.groupOrderNo };
    return { error: json?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function apiPaymentComplete(token: string, groupOrderNo: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API}/order/v1/payment-complete`, {
      method: "POST", headers: authHeaders(token),
      body: JSON.stringify({ groupOrderNo, paymentGatewayAuthNo: "", paymentGatewayAuthToken: "", paymentGatewayToken: "", paymentGatewayTransactionId: "kurlysp08m0201240110b659c07415" }),
    });
    if (res.status === 200) return { ok: true };
    const json: any = await res.json().catch(() => ({}));
    return { ok: false, error: json?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function apiOmsTransfer(): Promise<void> {
  try {
    await fetch(`${SOMS}/order-generatorV2/run/testTransferPlan?isIncludeReOrder=true&isIncludeReservedOrder=true`, { method: "GET" });
  } catch {}
}

async function apiGetTracking(clientOrderCode: string, maxRetries = 3): Promise<{ outbound: string; invoice: string }> {
  const url = `${OMS_OP}/order/${clientOrderCode}/logistics-tracking`;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        const data: any = await res.json();
        const outbound = data?.outboundOrderCode;
        if (outbound) {
          const trackings = data?.orderItemTrackings || [{}];
          const invoice = trackings[0]?.invoiceNumber || "-";
          return { outbound, invoice };
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { outbound: "-", invoice: "-" };
}

// ── 메인 배치 ─────────────────────────────────────────
export async function runOrderBatch(input: OrderRunInput, onProgress?: (e: OrderProgressEvent) => void): Promise<{ okCount: number; total: number; results: OrderResult[] }> {
  const emit = (index: number, ok: boolean, message: string) => onProgress?.({ type: "order", index, ok, message });
  const results: OrderResult[] = [];

  // 0. 로그인
  const { token, error: loginErr } = await apiLogin(input.userId, input.userPw);
  if (!token) {
    emit(0, false, `로그인 실패: ${loginErr}`);
    return { okCount: 0, total: 0, results };
  }
  emit(0, true, "✅ 로그인 성공");

  // 주소 리스트 생성
  const centers = loadCenters();
  const pool = centers[input.center] || {};
  const targetAddrs: { address: string; addressDetail: string; region: string }[] = [];
  for (const reg of input.regions) {
    const list = pool[reg] || [];
    if (!list.length) continue;
    if (input.addrMode === "R") {
      for (let k = 0; k < Math.max(1, input.repeatCnt); k++) {
        const a = list[Math.floor(Math.random() * list.length)];
        targetAddrs.push({ ...a, region: reg });
      }
    } else {
      for (const a of list) targetAddrs.push({ ...a, region: reg });
    }
  }
  if (targetAddrs.length > MAX_ORDERS) {
    emit(0, true, `⚠ 대상 주소 ${targetAddrs.length}건 → 안전 상한 ${MAX_ORDERS}건으로 제한`);
    targetAddrs.length = MAX_ORDERS;
  }
  if (!targetAddrs.length) {
    emit(0, false, "대상 주소 없음 (센터/권역 확인)");
    return { okCount: 0, total: 0, results };
  }

  // 주문 루프
  for (let i = 0; i < targetAddrs.length; i++) {
    const idx = i + 1;
    const addr = targetAddrs[i];
    // 상품 구성
    const raw: PickedItem[] = [];
    if (input.cool.mode !== "미선택") raw.push(...pickProductsByMode(210, input.cool.mode, input.cool.cnt, input.cool.qty));
    if (input.froz.mode !== "미선택") raw.push(...pickProductsByMode(220, input.froz.mode, input.froz.cnt, input.froz.qty));
    if (input.room.mode !== "미선택") raw.push(...pickProductsByMode(225, input.room.mode, input.room.cnt, input.room.qty));
    if (!raw.length) {
      results.push({ index: idx, ok: false, region: addr.region, status: "상품 구성 실패(재고 부족)" });
      emit(idx, false, `[#${idx}] 상품 구성 실패 (1P/FBK 재고 부족)`);
      continue;
    }

    // PMS 조회 + 가격/배송비
    let productTotal = 0;
    let hasFree = false;
    for (const item of raw) {
      const pms = await getPmsProductInfo(item.dealProductNo);
      if (pms) {
        item.price = pms.basePrice | 0;
        item.deliveryPrice = pms.deliveryPrice || "PAY";
        if (item.deliveryPrice === "FREE") hasFree = true;
      }
      productTotal += item.price * Number(item.order_quantity);
    }
    const shipping = hasFree || productTotal >= 40000 ? 0 : 3000;
    const finalTotal = productTotal + shipping;
    const dPolicy = SPECIAL_REGIONS.has(addr.region) ? "DAY" : "DAWN";

    // checkout → place → payment
    const chk = await apiCheckout(token, raw, addr.address, addr.addressDetail, dPolicy);
    if (!chk.ok) {
      results.push({ index: idx, ok: false, region: addr.region, totalPrice: finalTotal, status: `주문서 진입 실패`, error: chk.error });
      emit(idx, false, `[#${idx}] ❌ 주문서 진입 실패: ${chk.error ?? ""}`);
      continue;
    }
    const place = await apiPlaceOrder(token, finalTotal, addr.address, addr.addressDetail);
    if (!place.orderNo) {
      results.push({ index: idx, ok: false, region: addr.region, totalPrice: finalTotal, status: "주문 생성 실패", error: place.error });
      emit(idx, false, `[#${idx}] ❌ 주문 생성 실패: ${place.error ?? ""}`);
      continue;
    }
    const pay = await apiPaymentComplete(token, place.orderNo);
    if (!pay.ok) {
      results.push({ index: idx, ok: false, orderNo: place.orderNo, region: addr.region, totalPrice: finalTotal, status: "결제 실패", error: pay.error });
      emit(idx, false, `[#${idx}] ❌ 결제 실패 (주문 ${place.orderNo}): ${pay.error ?? ""}`);
      continue;
    }

    // OMS 전송 + 추적
    if (input.omsTransfer) { await apiOmsTransfer(); await new Promise((r) => setTimeout(r, 1000)); }
    const track = await apiGetTracking(place.orderNo);
    emit(idx, true, `[#${idx}] ✅ 주문 ${place.orderNo} · 출고요청 ${track.outbound} · ${finalTotal.toLocaleString()}원 (${addr.region})`);

    // Kafka TMS 발행 (운송장 생성) — Phase 2
    let invoice: string | undefined;
    let tmsPublished: number | undefined;
    if (input.publishTms) {
      const tms = await publishTmsForOrder(place.orderNo);
      if (tms.ok) {
        invoice = tms.labels.join("\n");
        tmsPublished = tms.published;
        emit(idx, true, `[#${idx}]   ↳ TMS 발행 ${tms.published}건 (운송장 ${tms.labels.slice(0, 2).join(", ")}${tms.labels.length > 2 ? "…" : ""})`);
      } else {
        emit(idx, false, `[#${idx}]   ↳ TMS 발행 실패: ${tms.error}`);
      }
    }

    results.push({ index: idx, ok: true, orderNo: place.orderNo, outbound: track.outbound, region: addr.region, totalPrice: finalTotal, status: "성공", invoice, tmsPublished });
  }

  const okCount = results.filter((r) => r.ok).length;
  return { okCount, total: targetAddrs.length, results };
}
