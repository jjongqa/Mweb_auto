/**
 * 테스트 데이터 — 물류 주문 생성 (KLS / 3PL·FBK)  [Phase 3]
 *
 * 원본: fulfillment_sqe_studio `src/test_order_gen/order_kls_processor.py` + 1_order_generator.py KLS 섹션 포팅.
 *   내부망 전용 API (인증 토큰 없음, x-owner-code 헤더만).
 *
 * 흐름 (주소 1건 = 주문 1건):
 *   1. 온도대(210/220/225) 상품 선택 (CSV kls_test_type)
 *   2. operation-plans POST → region.operationTime (이행계획 선검증)
 *   3. orders POST (clientOrderCode=KLS_{yyMMddHHmmss}{i}, orderItems.goodsCode=channelCode)
 *   4. (전체 후) orders GET → clientOrderCode별 outboundOrderCode 조회
 *
 * 주소 풀은 1P 와 동일 all_center.csv 공유. deliveryDate = 내일(KST).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { loadCenterAddresses } from "./test-data-logistics-order";

const BASE = process.env.KURLY_OMS_FBK_STG || "https://api-oms-fbk.stg.kurly.services";
const PLAN_URL = `${BASE}/api/fulfillment/v1/operation-plans`;
const ORDER_URL = `${BASE}/api/fulfillment/v1/orders`;
const DEFAULT_OWNER_CODE = "CU000294";

const MAX_ORDERS = 100;

export interface KlsZone { on: boolean; cnt: number; qty: number }
export interface KlsRunInput {
  cool: KlsZone;   // 210
  froz: KlsZone;   // 220
  room: KlsZone;   // 225
  center: string;
  regions: string[];
  addrMode: "R" | "A";
  repeatCnt: number;
  ownerCode: string;
  channelCode: string;   // saleChannelCode (판매처)
}

export interface KlsResult {
  index: number;
  ok: boolean;
  clientOrderCode?: string;
  outbound?: string;
  region?: string;
  goods?: string[];
  status: string;
  error?: string;
}
export interface KlsProgressEvent { type: "kls"; index: number; ok: boolean; message: string }

// ── KLS 상품 CSV ──────────────────────────────────────
interface KlsProduct { orderType: string; channelCode: string; goodsCode: string; goodsName: string }
let _kls: KlsProduct[] | null = null;
function loadKlsProducts(): KlsProduct[] {
  if (_kls) return _kls;
  const text = readFileSync(join(process.cwd(), "lib", "logistics-data", "kls_test_type.csv"), "utf-8").replace(/^﻿/, "");
  const out: KlsProduct[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const p = line.split(",");
    const orderType = (p[0] || "").trim();
    const channelCode = (p[1] || "").trim();
    const goodsCode = (p[2] || "").trim();
    const goodsName = p.slice(3).join(",").trim();  // 상품명 콤마 방어
    if (!orderType || !channelCode) continue;
    out.push({ orderType, channelCode, goodsCode, goodsName });
  }
  _kls = out;
  return out;
}

function sample<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, Math.max(0, Math.min(n, a.length)));
}

interface PickedKls { goodsCode: string; goodsName: string; channelCode: string; orderType: string; quantity: number }
function pickKlsProducts(orderType: number, cnt: number, qty: number): PickedKls[] {
  const pool = loadKlsProducts().filter((p) => String(p.orderType) === String(orderType));
  if (!pool.length) return [];
  const actual = cnt > 0 ? Math.min(cnt, pool.length) : Math.floor(Math.random() * Math.min(5, pool.length)) + 1;
  return sample(pool, actual).map((it) => ({ goodsCode: it.goodsCode, goodsName: it.goodsName, channelCode: it.channelCode, orderType: it.orderType, quantity: qty }));
}

// ── 날짜 유틸 (KST) ───────────────────────────────────
function kstNow(): Date {
  // 서버 TZ 무관 KST 기준
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function tomorrowKstDate(): string {
  const d = kstNow();
  d.setUTCDate(d.getUTCDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function nowStampYYMMDDHHMMSS(): string {
  const d = kstNow();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
function paymentAtKst(): string {
  const d = kstNow();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function shortHex(): string {
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
}

const ownerHeaders = (ownerCode: string): Record<string, string> => ({ accept: "*/*", "x-owner-code": ownerCode, "Content-Type": "application/json" });

// ── API ───────────────────────────────────────────────
async function checkOperationPlan(primary: string, secondary: string, deliveryDate: string, ownerCode: string): Promise<{ ok: boolean; operationTime?: string; error?: string }> {
  const key = `k${nowStampYYMMDDHHMMSS()}_${shortHex()}`;
  try {
    const res = await fetch(PLAN_URL, { method: "POST", headers: ownerHeaders(ownerCode), body: JSON.stringify({ key, deliveryDate, primaryAddress: primary, secondaryAddress: secondary }) });
    const data: any = await res.json().catch(() => ({}));
    if (res.status === 200 && data?.plan) {
      return { ok: true, operationTime: data.plan.region?.operationTime || "" };
    }
    return { ok: false, error: data?.error?.message || "이행 계획 없음/에러" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function createKlsOrder(payload: unknown, ownerCode: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(ORDER_URL, { method: "POST", headers: ownerHeaders(ownerCode), body: JSON.stringify(payload) });
    if (res.status === 200) return { ok: true };
    const data: any = await res.json().catch(() => ({}));
    return { ok: false, error: `[${data?.error?.code || "0000"}] ${data?.error?.message || "알 수 없는 에러"}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function queryKlsOrders(codes: string[], deliveryDate: string, ownerCode: string): Promise<Record<string, string>> {
  try {
    const q = codes.map((c) => `clientOrderCodes=${encodeURIComponent(c)}`).join("&");
    const url = `${ORDER_URL}?pageNumber=0&pageSize=50&deliveryStartDate=${deliveryDate}&deliveryEndDate=${deliveryDate}&${q}`;
    const res = await fetch(url, { headers: { accept: "*/*", "x-owner-code": ownerCode } });
    if (res.status !== 200) return {};
    const data: any[] = (await res.json())?.data || [];
    const map: Record<string, string> = {};
    for (const item of data) {
      const code = item?.order?.clientOrderCode || "";
      const outbound = item?.outbound?.outboundOrderCode || "-";
      if (code) map[code] = outbound;
    }
    return map;
  } catch {
    return {};
  }
}

// ── 메인 배치 ─────────────────────────────────────────
export async function runKlsBatch(input: KlsRunInput, onProgress?: (e: KlsProgressEvent) => void): Promise<{ okCount: number; total: number; results: KlsResult[]; deliveryDate: string }> {
  const emit = (index: number, ok: boolean, message: string) => onProgress?.({ type: "kls", index, ok, message });
  const results: KlsResult[] = [];
  const ownerCode = input.ownerCode.trim() || DEFAULT_OWNER_CODE;
  const channelCode = input.channelCode.trim();
  const deliveryDate = tomorrowKstDate();

  // 주소 리스트 (1P 와 동일 풀 공유)
  const centers = loadCenterAddresses();
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
    return { okCount: 0, total: 0, results, deliveryDate };
  }
  emit(0, true, `배송일 ${deliveryDate} · 화주사 ${ownerCode} · 판매처 ${channelCode} · 대상 ${targetAddrs.length}건`);

  for (let i = 0; i < targetAddrs.length; i++) {
    const idx = i + 1;
    const addr = targetAddrs[i];
    const secondary = addr.addressDetail || "1층";

    // 상품 구성
    const items: PickedKls[] = [];
    if (input.cool.on) items.push(...pickKlsProducts(210, input.cool.cnt, input.cool.qty));
    if (input.froz.on) items.push(...pickKlsProducts(220, input.froz.cnt, input.froz.qty));
    if (input.room.on) items.push(...pickKlsProducts(225, input.room.cnt, input.room.qty));
    if (!items.length) {
      results.push({ index: idx, ok: false, region: addr.region, status: "상품 구성 실패" });
      emit(idx, false, `[#${idx}] KLS 상품 구성 실패`);
      continue;
    }

    // STEP1 이행계획
    const plan = await checkOperationPlan(addr.address, secondary, deliveryDate, ownerCode);
    if (!plan.ok) {
      results.push({ index: idx, ok: false, region: addr.region, status: "이행계획 실패", error: plan.error });
      emit(idx, false, `[#${idx}] ❌ 이행계획 실패: ${plan.error}`);
      continue;
    }

    // STEP2 주문 등록
    const clientOrderCode = `KLS_${nowStampYYMMDDHHMMSS()}${idx}`;
    const orderItems = items.map((it) => ({ goodsCode: it.channelCode, goodsName: it.goodsName, quantity: it.quantity }));
    const payload = {
      clientOrderCode,
      paymentAt: paymentAtKst(),
      deliveryDate,
      saleChannelCode: channelCode,
      operationTime: plan.operationTime || "",
      orderer: { memberId: "automation_user", name: "자동화테스터", phoneNumber: "01012345678" },
      receiver: { name: "박오토", phoneNumber: "01012345678", primaryAddress: addr.address, secondaryAddress: secondary, accessMethod: "FREE", pickupType: "DOOR" },
      orderItems,
    };
    const order = await createKlsOrder(payload, ownerCode);
    const goods = items.map((it) => `${it.goodsName}×${it.quantity}`);
    if (order.ok) {
      results.push({ index: idx, ok: true, clientOrderCode, region: addr.region, goods, status: "성공" });
      emit(idx, true, `[#${idx}] ✅ KLS 주문 ${clientOrderCode} (${addr.region}, ${items.length}품목)`);
    } else {
      results.push({ index: idx, ok: false, clientOrderCode, region: addr.region, goods, status: "주문 실패", error: order.error });
      emit(idx, false, `[#${idx}] ❌ KLS 주문 실패 (${clientOrderCode}): ${order.error}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // 출고번호 조회
  const successCodes = results.filter((r) => r.ok && r.clientOrderCode).map((r) => r.clientOrderCode!) as string[];
  if (successCodes.length) {
    emit(0, true, "📋 출고번호 조회 중...");
    await new Promise((r) => setTimeout(r, 2000));
    const map = await queryKlsOrders(successCodes, deliveryDate, ownerCode);
    for (const r of results) {
      if (r.clientOrderCode && map[r.clientOrderCode]) r.outbound = map[r.clientOrderCode];
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return { okCount, total: targetAddrs.length, results, deliveryDate };
}
