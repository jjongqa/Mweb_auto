/**
 * 테스트 데이터 — 3P(판매자배송) 주문 배송상태 변경 (간편 방법)
 *
 * 위키 "1P, 3P, 컬리나우 배송상태 변경" > 3. 판매자배송(3P) > "3P 배송상태 간편하게 바꾸는 방법"
 *   - Kafka 토픽 MSG-3P-ORDER-DELIVERY-STATUS-DATA 에 메시지 1건 발행하면
 *     컬리몰/la-cms 의 주문 상태가 배송중/배송완료로 바뀐다. (파트너 연동·운송장은 안 됨 → QA 상태확인용)
 *   - 주문완료 상태부터 가능.
 *
 * 필요한 값: aggregateId(대표주문번호) / payload.order_no(개별주문번호) / payload.deal_product_no(딜번호).
 *   대표주문번호(우리 주문결과 groupOrderNo)만 있으면 PARTNER3P DB 에서 개별번호+딜번호를 조회해 자동 완성.
 *
 * 발행은 사내 kafka-ui(kafbat) REST API 로: POST /api/clusters/{cluster}/topics/{topic}/messages
 *   (partition 필수. value 는 String serde 로 raw JSON 발행.)
 *
 * 인증 없음(사내망 한정). STG/사내 creds 노출 정책상 서버 단일 소스로 둠.
 */

import mysql from "mysql2/promise";
import { randomBytes } from "crypto";

// PARTNER3P DB (대표→개별주문번호+딜번호 조회) — 위키 방법1 쿼리 출처
const DB_CONFIG = {
  host: "stg-commerce-thirdparty.cluster-c9cx6a2jazb5.ap-northeast-2.rds.amazonaws.com",
  user: "kurly_thirdparty",
  password: "t#$1bnH579uL",
  database: "PARTNER3P",
  connectTimeout: 8000,
};

// 사내 kafka-ui
const KAFKA_UI = "https://manager-kafka-stg.dev.data.kurlycorp.kr";
const CLUSTER = "stg-msk-integration-01";
const TOPIC = "MSG-3P-ORDER-DELIVERY-STATUS-DATA";        // 간편(la-cms 표시만) — standalone mark3pDelivered 용
const TOPIC_TRACE = "MSG-3P-ORDER-DELIVERY-TRACE-DATA";   // 정식(파트너 연동, 스윗트래커 트레이스 모사) — 풀플로우 ③ 용

// TRACE-DATA 고정 공유 시크릿(위키 예시값). 스윗트래커 트레이스 인증 우회용 — STG 한정.
const TRACE_SECRET_VALUE = "yqzaciv0zlw5rtjt";
const TRACE_LEVEL_COMPLETED = 6;                          // 스윗트래커 배송단계 6 = 배송완료

export type ThreePDeliveryStatus = "DELIVERING" | "DELIVERED";

export interface ThreePOrderItem {
  orderNo: string | number;          // 개별주문번호 (neo_3p_order.order_no, 짧은 내부번호) — Kafka 배송완료용
  orderItemNo: string | number;      // 주문아이템번호 (neo_3p_order_item.order_item_no) — OpenAPI 발주확인/발송처리용
  dealProductNo: string | number;    // 딜번호 (neo_3p_order_item.deal_product_no)
  productDivisionCd: string;         // 상품구분코드 (neo_3p_order_item.product_division_cd) — 발송처리 필수("0"=일반택배)
  contentsProductNo?: string | number | null;
  orderItemStatus?: string | null;
  productName?: string | null;
}

export interface ProduceResult {
  ok: boolean;
  status: number;
  orderNo: string | number;
  dealProductNo: string | number;
  error?: string;
}

export interface Mark3pResult {
  ok: boolean;                       // 1건 이상 발행 성공
  parentOrderNo: string | number;
  items: ThreePOrderItem[];          // 조회된 개별주문/딜
  produced: ProduceResult[];         // 발행 결과(아이템별)
  error?: string;                    // 조회/연결 단계 실패
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function fmtDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** TRACE-DATA 시각 형식: "yyyy-MM-ddTHH:mm:ss" (Java LocalDateTime, 타임존/Z 없음). */
function fmtIsoNoTz(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 대표주문번호(parent_order_no)로 개별주문번호 + 딜번호 조회.
 * 주문완료 직후엔 3P 시스템 전파가 비동기라 행이 없을 수 있어 폴링 재시도.
 */
export async function lookup3pOrderItems(
  parentOrderNo: string | number,
  opts?: { maxTry?: number; intervalMs?: number; onWait?: (attempt: number, max: number) => void }
): Promise<{ ok: boolean; items: ThreePOrderItem[]; error?: string }> {
  const maxTry = opts?.maxTry ?? 12;        // 7s × 12 ≈ 84s
  const intervalMs = opts?.intervalMs ?? 7000;
  const sql = `SELECT o.order_no, i.order_item_no, i.deal_product_no, i.product_division_cd, i.contents_product_no, i.order_item_status, i.product_name
               FROM neo_3p_order o
               JOIN neo_3p_order_item i ON o.order_no = i.order_no
               WHERE o.parent_order_no = ?
               ORDER BY i.order_item_no`;
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    for (let attempt = 1; attempt <= maxTry; attempt++) {
      const [rows] = await conn.query(sql, [String(parentOrderNo)]);
      const items = (rows as any[]).map((r) => ({
        orderNo: r.order_no,
        orderItemNo: r.order_item_no,
        dealProductNo: r.deal_product_no,
        productDivisionCd: r.product_division_cd != null ? String(r.product_division_cd) : "0",
        contentsProductNo: r.contents_product_no,
        orderItemStatus: r.order_item_status,
        productName: r.product_name,
      })) as ThreePOrderItem[];
      if (items.length > 0) return { ok: true, items };
      if (attempt < maxTry) {
        opts?.onWait?.(attempt, maxTry);
        await sleep(intervalMs);
      }
    }
    return { ok: false, items: [], error: `3P 주문 행이 ${maxTry * (intervalMs / 1000)}초 내 PARTNER3P 에 안 생김 (전파 지연 또는 1P 주문)` };
  } catch (e) {
    return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

// ===================== TRACE-DATA(정식) 입력값: neo_3p_delivery 조회 =====================
// 발송처리(②)가 만든 배송행에서 fid(uuid)·운송장(tracking_no)·택배사(delivery_provider) 를 읽어온다.
// 위키 "입력값 조회" 쿼리 그대로. fid 가 TRACE 컨슈머의 배송 매칭 키라, 임의값이면 DB 반영이 안 됨.

export interface Delivery3pRow {
  orderNo: string | number;          // neo_3p_delivery.order_no = 개별주문번호
  fid: string;                       // neo_3p_delivery.uuid → key + payload.fid
  trackingNo: string;                // neo_3p_delivery.tracking_no → payload.invoice_no
  deliveryProvider: string;          // neo_3p_delivery.delivery_provider → comcode + courier_code
  kafkaOrderNo?: string | number | null;
}

/**
 * 대표주문번호로 배송행(neo_3p_delivery) 조회. 발송처리 직후엔 배송행 생성이 비동기라 폴링.
 * TRACE-DATA 발행에 필요한 fid/운송장/택배사를 반환.
 */
export async function lookup3pDeliveries(
  parentOrderNo: string | number,
  opts?: { maxTry?: number; intervalMs?: number; onWait?: (attempt: number, max: number) => void }
): Promise<{ ok: boolean; rows: Delivery3pRow[]; error?: string }> {
  const maxTry = opts?.maxTry ?? 8;          // 5s × 8 = 40s
  const intervalMs = opts?.intervalMs ?? 5000;
  // 배송행 기준(아이템 JOIN 없이) — uuid 중복 방지. fid/운송장/택배사만 필요.
  const sql = `SELECT a.order_no, a.uuid AS fid, a.tracking_no, a.delivery_provider, b.kafka_order_no
               FROM neo_3p_delivery a
               JOIN neo_3p_order b ON a.order_no = b.order_no
               WHERE b.parent_order_no = ?
               ORDER BY b.kafka_order_no ASC`;
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    for (let attempt = 1; attempt <= maxTry; attempt++) {
      const [raw] = await conn.query(sql, [String(parentOrderNo)]);
      const seen = new Set<string>();
      const rows: Delivery3pRow[] = [];
      for (const r of raw as any[]) {
        const fid = r.fid != null ? String(r.fid) : "";
        if (!fid || seen.has(fid)) continue;       // uuid 중복 제거
        if (r.tracking_no == null || String(r.tracking_no).trim() === "") continue; // 운송장 없으면 아직 발송처리 전
        seen.add(fid);
        rows.push({
          orderNo: r.order_no,
          fid,
          trackingNo: String(r.tracking_no),
          deliveryProvider: r.delivery_provider != null ? String(r.delivery_provider) : "",
          kafkaOrderNo: r.kafka_order_no ?? null,
        });
      }
      if (rows.length > 0) return { ok: true, rows };
      if (attempt < maxTry) {
        opts?.onWait?.(attempt, maxTry);
        await sleep(intervalMs);
      }
    }
    return { ok: false, rows: [], error: `배송행(neo_3p_delivery)이 ${maxTry * (intervalMs / 1000)}초 내 안 생김 (발송처리 미반영 또는 운송장 누락)` };
  } catch (e) {
    return { ok: false, rows: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/** 배송상태 Kafka 메시지 1건 발행 (위키 간편 방법 payload 구조 그대로). */
export async function produce3pDeliveryStatus(args: {
  parentOrderNo: string | number;
  orderNo: string | number;
  dealProductNo: string | number;
  status: ThreePDeliveryStatus;
  waybillNumber?: string;
  courierCode?: string;
  courierName?: string;
}): Promise<ProduceResult> {
  const now = new Date();
  const completed = args.status === "DELIVERED";
  const payload = {
    aggregateId: String(args.parentOrderNo),
    eventVersion: 1,
    occurredOn: now.toISOString(),
    recovery: false,
    route: ["third-party-partner-api_MSG-3P-ORDER-DELIVERY-STATUS-DATA"],
    transaction: { seq: 1, total: 1, first: true, last: true },
    payload: {
      delivery_id: null,
      order_no: String(args.orderNo),
      deal_product_no: String(args.dealProductNo),
      courier_company_name: args.courierName ?? null,
      courier_company_code: args.courierCode ?? null,
      courier_company_status: null,
      courier_company_delivery_status: null,
      waybill_number: args.waybillNumber ?? null,
      delivery_status: completed ? "DELIVERED" : "DELIVERING",
      delivery_completed_at: completed ? fmtDateTime(now) : null,
      delivery_completed_status: completed,
    },
    header: {
      trace_id: randomBytes(8).toString("hex"),
      created_at: now.toISOString(),
      version: "1.0",
      issuer: "3p-partner-api",
      action: "modify",
      subject: "orderStatus",
      method: completed ? null : "deliver",
    },
    action: "OrderDeliveryStatusData",
  };

  const url = `${KAFKA_UI}/api/clusters/${CLUSTER}/topics/${encodeURIComponent(TOPIC)}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        partition: 0,            // kafbat ui 필수 필드
        key: String(args.parentOrderNo),
        value: JSON.stringify(payload),   // ⚠️ 이 kafbat 배포는 본문 필드명이 'value'. 'content'로 보내면 200이지만 본문이 null로 버려짐(실측 확인).
        keySerde: "String",
        valueSerde: "String",
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, orderNo: args.orderNo, dealProductNo: args.dealProductNo, error: `kafka-ui HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true, status: res.status, orderNo: args.orderNo, dealProductNo: args.dealProductNo };
  } catch (e) {
    return { ok: false, status: 0, orderNo: args.orderNo, dealProductNo: args.dealProductNo, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 배송완료 TRACE-DATA 1건 발행 (정식 방법, 위키 템플릿 그대로).
 * 스윗트래커 "배송완료" 트레이스 콜백을 모사 → 파트너/la-cms/컬리몰 전부 배송완료 전환.
 * fid·invoice_no·comcode 는 반드시 neo_3p_delivery 에서 읽어온 실값이어야 컨슈머가 배송행을 매칭함.
 */
export async function produce3pDeliveryTrace(args: {
  fid: string;                       // neo_3p_delivery.uuid (Key + payload.fid)
  invoiceNo: string;                 // neo_3p_delivery.tracking_no
  comcode: string;                   // neo_3p_delivery.delivery_provider
  at?: Date;                         // 배송완료 시각 (default now)
}): Promise<{ ok: boolean; status: number; fid: string; error?: string }> {
  const now = args.at ?? new Date();
  const iso = fmtIsoNoTz(now);
  const payload = {
    aggregateId: args.fid,           // 컨슈머는 fid 로 매칭. aggregateId 값 자체는 비중요(위키 예시도 고정값 방치).
    eventVersion: 1,
    occurredOn: iso,
    recovery: false,
    route: ["third-party-partner-api_MSG-3P-ORDER-DELIVERY-TRACE-DATA"],
    transaction: { seq: 1, total: 1, first: true, last: true },
    secret_value: TRACE_SECRET_VALUE,
    fid: args.fid,
    invoice_no: args.invoiceNo,
    level: TRACE_LEVEL_COMPLETED,    // 6 = 배송완료
    time_trans: iso,                 // 위키: 둘 다 now()
    time_sweet: iso,
    where: "",
    telno_office: "",
    telno_man: "",
    details: "배송완료",
    recv_addr: "",
    recv_name: "",
    send_name: "",
    man: "",
    estmate: "",
    comcode: args.comcode,
    courier_code: args.comcode,
    action: "OrderDeliveryTraceData",
  };

  const url = `${KAFKA_UI}/api/clusters/${CLUSTER}/topics/${encodeURIComponent(TOPIC_TRACE)}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        partition: 0,
        key: args.fid,               // 위키: Key = {fid}
        value: JSON.stringify(payload),   // ⚠️ 본문 필드명은 'value' (kafbat). 'content'는 무시되어 본문 null 발행됨(실측 확인).
        keySerde: "String",
        valueSerde: "String",
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, fid: args.fid, error: `kafka-ui HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true, status: res.status, fid: args.fid };
  } catch (e) {
    return { ok: false, status: 0, fid: args.fid, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 배송완료가 PARTNER3P 에 실제 반영됐는지 best-effort 확인.
 * neo_3p_delivery.delivery_complation_date 가 모든 배송행에서 non-null 이면 완료로 본다.
 * 컬럼명이 환경에 따라 다를 수 있어, 알 수 없는 컬럼 에러면 supported:false 로 조용히 스킵(발행 성공은 유지).
 */
export async function verify3pCompleted(
  parentOrderNo: string | number,
  opts?: { maxTry?: number; intervalMs?: number; onWait?: (attempt: number, max: number) => void }
): Promise<{ supported: boolean; completed: boolean }> {
  const maxTry = opts?.maxTry ?? 6;          // 5s × 6 = 30s
  const intervalMs = opts?.intervalMs ?? 5000;
  const sql = `SELECT a.delivery_complation_date AS done
               FROM neo_3p_delivery a JOIN neo_3p_order b ON a.order_no = b.order_no
               WHERE b.parent_order_no = ?`;
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    for (let attempt = 1; attempt <= maxTry; attempt++) {
      let rows: any[];
      try {
        const [r] = await conn.query(sql, [String(parentOrderNo)]);
        rows = r as any[];
      } catch (e: any) {
        if (e?.code === "ER_BAD_FIELD_ERROR") return { supported: false, completed: false };  // 컬럼 추정 빗나감 → 스킵
        throw e;
      }
      if (rows.length > 0 && rows.every((x) => x.done != null)) return { supported: true, completed: true };
      if (attempt < maxTry) { opts?.onWait?.(attempt, maxTry); await sleep(intervalMs); }
    }
    return { supported: true, completed: false };
  } catch {
    return { supported: false, completed: false };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/**
 * 대표주문번호 하나를 배송완료(또는 배송중)로 처리.
 * DB 조회로 개별주문번호+딜번호 자동 완성 후, 아이템마다 Kafka 발행.
 */
export async function mark3pDelivered(
  parentOrderNo: string | number,
  opts?: {
    status?: ThreePDeliveryStatus;                                  // default DELIVERED
    items?: ThreePOrderItem[];                                      // 이미 알면 DB 조회 생략
    lookup?: { maxTry?: number; intervalMs?: number };
    onProgress?: (msg: string, ok: boolean) => void;
  }
): Promise<Mark3pResult> {
  const status = opts?.status ?? "DELIVERED";
  const emit = (msg: string, ok = true) => opts?.onProgress?.(msg, ok);

  let items = opts?.items;
  if (!items || items.length === 0) {
    emit(`PARTNER3P 조회 (대표 ${parentOrderNo} → 개별주문번호·딜번호)…`);
    const looked = await lookup3pOrderItems(parentOrderNo, {
      ...opts?.lookup,
      onWait: (a, m) => emit(`3P 주문 전파 대기 ${a}/${m} (~7초)…`),
    });
    if (!looked.ok) return { ok: false, parentOrderNo, items: [], produced: [], error: looked.error };
    items = looked.items;
    emit(`조회 완료: ${items.map((i) => `order_no=${i.orderNo}/딜=${i.dealProductNo}`).join(", ")}`);
  }

  const produced: ProduceResult[] = [];
  for (const it of items) {
    const r = await produce3pDeliveryStatus({
      parentOrderNo,
      orderNo: it.orderNo,
      dealProductNo: it.dealProductNo,
      status,
    });
    produced.push(r);
    emit(
      r.ok
        ? `${status === "DELIVERED" ? "배송완료" : "배송중"} 발행 OK (order_no=${it.orderNo}, 딜=${it.dealProductNo})`
        : `발행 실패 (order_no=${it.orderNo}): ${r.error}`,
      r.ok
    );
  }

  return { ok: produced.some((p) => p.ok), parentOrderNo, items, produced };
}

// ===================== 풀 플로우: 발주확인 → 발송처리 → 배송완료 =====================
// 파트너오피스(3p-partner) 액션의 OpenAPI 미러. OpenAPI accessToken(Bearer)으로 인증.
//   발주확인  PUT /open-api/v1/order-sheets/preparing-delivery  { orderItemNos:[...] }   (주문완료→배송준비중)
//   발송처리  PUT /open-api/v1/order-sheets/delivering          { invoices:[{orderItemNo,trackingNo,courierCode}] } (배송준비중→배송중, 일반택배만)
//   배송완료  Kafka(간편 STATUS-DATA) 재사용
// 주의: 발송처리는 "일반(택배)" 상품만 가능(컬리배송 등은 불가).

const OPENAPI_BASE = "https://third-party-external-api.stg.kurly.com";

async function openApiPut(path: string, accessToken: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(`${OPENAPI_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    // OpenAPI 성공 코드는 "0000" / "정상". HTTP 200 이어도 code 확인.
    const ok = res.ok && (data == null || data.code == null || data.code === "0000");
    return { ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: e instanceof Error ? e.message : String(e) };
  }
}

/** 발주확인 (주문완료 → 배송준비중). orderItemNo 들을 한 번에. */
export async function confirmPreparingDelivery(accessToken: string, orderItemNos: (string | number)[]) {
  return openApiPut("/open-api/v1/order-sheets/preparing-delivery", accessToken, { orderItemNos });
}

export interface DeliveringInvoice {
  orderItemNo: string | number;
  trackingNo: string;               // 운송장번호 (영문/숫자/하이픈)
  courierId: string;                // couriers API courierId (예 "04" CJ대한통운)
  courierName: string;              // 택배사명 (예 "CJ대한통운")
  productDivisionCd: string;        // 상품구분코드 — 발송처리 검증 필수 ("0"=일반택배)
}

/** 발송처리 (배송준비중 → 배송중). 일반택배("0")만. payload 구조는 파트너오피스 캡처와 동일. */
export async function shipDelivering(accessToken: string, invoices: DeliveringInvoice[]) {
  return openApiPut("/open-api/v1/order-sheets/delivering", accessToken, { invoices });
}

// 흔한 택배사 (couriers API courierId → 이름)
const COURIERS: Record<string, string> = { "01": "우체국택배", "04": "CJ대한통운", "05": "한진택배", "06": "로젠택배", "08": "롯데택배" };

/** 운송장번호 생성 (영숫자/하이픈 규칙 충족 — 숫자 12자리). */
function genTrackingNo(seed: number): string {
  return String(100000000000 + (seed % 900000000000));
}

export interface Full3pDeliveryResult {
  ok: boolean;
  parentOrderNo: string | number;
  items: ThreePOrderItem[];
  confirmedOk: boolean;
  shippedOk: boolean;
  deliveredOk: boolean;                 // TRACE-DATA 발행 성공(=Kafka 접수)
  deliveryConfirmed?: boolean;          // PARTNER3P DB 배송완료 실제 반영 확인 (best-effort, undefined=확인불가)
  deliveries?: Delivery3pRow[];         // 발행에 쓴 배송행(fid/운송장/택배사)
  error?: string;
}

/**
 * 3P 주문 풀 배송 플로우: 발주확인 → 발송처리(자동 운송장) → 배송완료.
 * groupOrderNo(대표주문번호)로 DB 조회해 orderItemNo·order_no·딜번호 자동 수집.
 */
export async function runFull3pDelivery(
  parentOrderNo: string | number,
  accessToken: string,
  opts?: { courierId?: string; onProgress?: (msg: string, ok: boolean) => void }
): Promise<Full3pDeliveryResult> {
  const emit = (msg: string, ok = true) => opts?.onProgress?.(msg, ok);
  const courierId = opts?.courierId || "04";  // 기본 CJ대한통운
  const courierName = COURIERS[courierId] || "CJ대한통운";

  emit(`PARTNER3P 조회 (대표 ${parentOrderNo} → orderItemNo·딜번호)…`);
  const looked = await lookup3pOrderItems(parentOrderNo, { onWait: (a, m) => emit(`3P 주문 전파 대기 ${a}/${m} (~7초)…`) });
  if (!looked.ok) return { ok: false, parentOrderNo, items: [], confirmedOk: false, shippedOk: false, deliveredOk: false, error: looked.error };
  const items = looked.items;
  emit(`조회 완료: ${items.map((i) => `orderItemNo=${i.orderItemNo}`).join(", ")}`);

  const orderItemNos = items.map((i) => i.orderItemNo);

  // 1) 발주확인
  const conf = await confirmPreparingDelivery(accessToken, orderItemNos);
  const confirmedOk = conf.ok;
  emit(confirmedOk ? `① 발주확인 OK → 배송준비중` : `① 발주확인 실패: ${conf.data?.message ?? conf.status}`, confirmedOk);
  if (!confirmedOk) return { ok: false, parentOrderNo, items, confirmedOk, shippedOk: false, deliveredOk: false, error: `발주확인 실패: HTTP ${conf.status} ${JSON.stringify(conf.data).slice(0, 200)}` };

  // 2) 발송처리 (운송장 자동 생성). productDivisionCd 는 아이템에서(일반택배 "0").
  const invoices: DeliveringInvoice[] = items.map((it, idx) => ({
    orderItemNo: it.orderItemNo,
    trackingNo: genTrackingNo(Number(it.orderItemNo) + idx),
    courierId,
    courierName,
    productDivisionCd: it.productDivisionCd ?? "0",
  }));
  const ship = await shipDelivering(accessToken, invoices);
  const shippedOk = ship.ok;
  emit(
    shippedOk
      ? `② 발송처리 OK → 배송중 (운송장 ${invoices.map((i) => i.trackingNo).join(",")}, 택배사 ${courierName})`
      : `② 발송처리 실패: ${ship.data?.message ?? ship.status} ${JSON.stringify(ship.data?.data ?? "").slice(0, 200)}`,
    shippedOk
  );
  if (!shippedOk) return { ok: false, parentOrderNo, items, confirmedOk, shippedOk, deliveredOk: false, error: `발송처리 실패: HTTP ${ship.status} ${JSON.stringify(ship.data).slice(0, 200)}` };

  // 3) 배송완료 (Kafka TRACE-DATA) — 발송처리가 만든 neo_3p_delivery 의 fid(uuid)·운송장으로 발행해야 컨슈머가 매칭함.
  //    (STATUS-DATA 간편 방식은 실 발송처리 거친 배송중 주문엔 안 먹힘. standalone mark3pDelivered 전용으로 분리.)
  emit(`PARTNER3P 배송행 조회 (neo_3p_delivery: fid·운송장)…`);
  const deliv = await lookup3pDeliveries(parentOrderNo, { onWait: (a, m) => emit(`배송행 생성 대기 ${a}/${m} (~5초)…`) });
  if (!deliv.ok || deliv.rows.length === 0) {
    emit(`③ 배송완료 실패: ${deliv.error ?? "neo_3p_delivery 행 없음"}`, false);
    return { ok: false, parentOrderNo, items, confirmedOk, shippedOk, deliveredOk: false, error: `배송행 조회 실패: ${deliv.error ?? "neo_3p_delivery 행 없음"}` };
  }
  emit(`배송행 ${deliv.rows.length}건: ${deliv.rows.map((d) => `운송장=${d.trackingNo}(${d.deliveryProvider})`).join(", ")}`);

  let producedOk = false;
  for (const d of deliv.rows) {
    const r = await produce3pDeliveryTrace({ fid: d.fid, invoiceNo: d.trackingNo, comcode: d.deliveryProvider });
    if (r.ok) producedOk = true;
    emit(
      r.ok
        ? `③ 배송완료 TRACE 발행 OK (fid=${d.fid.slice(0, 8)}…, 운송장=${d.trackingNo})`
        : `③ 배송완료 발행 실패 (fid=${d.fid.slice(0, 8)}…): ${r.error}`,
      r.ok
    );
  }
  const deliveredOk = producedOk;

  // 발행 후 DB 실제 전환 best-effort 확인
  let deliveryConfirmed: boolean | undefined = undefined;
  if (producedOk) {
    emit(`③ DB 배송완료 반영 확인 중…`);
    const v = await verify3pCompleted(parentOrderNo, { onWait: (a, m) => emit(`완료 반영 대기 ${a}/${m} (~5초)…`) });
    if (v.supported) {
      deliveryConfirmed = v.completed;
      emit(v.completed ? `③ 배송완료 DB 반영 확인됨 ✅` : `③ 발행은 OK이나 DB 반영 미확인 (전파 지연 가능 — la-cms 확인 권장)`, v.completed);
    }
  }

  return { ok: confirmedOk && shippedOk && deliveredOk, parentOrderNo, items, confirmedOk, shippedOk, deliveredOk, deliveryConfirmed, deliveries: deliv.rows };
}
