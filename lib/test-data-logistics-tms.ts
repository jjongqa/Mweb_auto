/**
 * 테스트 데이터 — 물류 주문 Kafka TMS 발행 (운송장 생성)  [Phase 2]
 *
 * 원본: fulfillment_sqe_studio `src/test_order_gen/order_dos_kafka_processor.py` 포팅.
 *   원본은 kafka-python 으로 MSK 브로커(b-1..b-4.stg-msk-integrati…:9092)에 직접 발행.
 *   → 우리는 동일 클러스터(stg-msk-integration-01)를 사내 kafka-ui REST 로 발행
 *     ([[1p-delivery-kafka-ui-pattern]] / lib/test-data-1p-delivery.ts 와 동일 방식).
 *
 * 흐름 (주문번호 1건당):
 *   1. OMS logistics-tracking → outboundOrderCode + 온도그룹(temperatureType 집계)
 *   2. OMS /order/outbound/{outbound} → 주문 상세(order/delivery/region/items)
 *   3. item 별로 송장 발행: orderType=242 면 수량만큼 분할(seq), 그 외 1건
 *      - shippingLabel = {orderType}-{region(2자리)}-{outbound}-{seq:0000}
 *      - convert_to_kafka_format 메시지 → 토픽 발행 (key=outbound)
 *
 * 발행은 토픽 MSG-DELIVERY-TMS-DELIVERY_REQUEST. 운송장(invoice)은 이 발행으로 생성됨.
 */

const KAFKA_UI = process.env.KURLY_KAFKA_UI || "https://manager-kafka-stg.dev.data.kurlycorp.kr";
const CLUSTER = process.env.KURLY_KAFKA_CLUSTER || "stg-msk-integration-01";
const TOPIC_TMS = process.env.KURLY_TMS_TOPIC || "MSG-DELIVERY-TMS-DELIVERY_REQUEST";
const OMS_OP = process.env.KURLY_OMS_OP_STG || "https://oms-order-operation.stg.kurly.services";

// 수량만큼 송장을 쪼갤 주문 타입 (원본 SPLIT_QTY_TYPES)
const SPLIT_QTY_TYPES = new Set(["242"]);

export interface TmsResult {
  index: number;
  clientOrderCode: string;
  ok: boolean;
  outbound?: string;
  labels?: string[];   // 발행된 shippingLabel 들 (= 운송장)
  published?: number;  // 발행 메시지 수
  error?: string;
}
export interface TmsProgressEvent { type: "tms"; index: number; ok: boolean; message: string }

function round6(n: number): number {
  return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

// 온도 그룹 판별 (원본 동일): 섞이면 NORMAL, 단일이면 *_ONLY
function tempGroupOf(trackings: any[]): string {
  if (!trackings || !trackings.length) return "ROOM_ONLY";
  const temps = new Set(trackings.map((t) => t?.temperatureType));
  if (temps.size > 1) return "NORMAL";
  const t = [...temps][0];
  const map: Record<string, string> = { ROOM: "ROOM_ONLY", COLD: "COLD_ONLY", FROZEN: "FROZEN_ONLY" };
  return map[t] || "ROOM_ONLY";
}

function shippingLabel(orderType: string, regionGroupCode: string, outbound: string, seq: number): string {
  const region = String(regionGroupCode || "");
  const formatted = region.length === 1 ? region + "0" : region;
  return `${orderType}-${formatted}-${outbound}-${String(seq).padStart(4, "0")}`;
}

// convert_to_kafka_format 포팅 (필드/구조 원본 그대로, 오타 'accesssType' 포함 — 원본 보존)
function buildTmsMessage(omsData: any, item: any, finalTempGroup: string, label: string): any {
  const order = omsData?.order || {};
  const delivery = omsData?.delivery || {};
  const dest = delivery?.destination || {};
  const addr = dest?.address || {};
  const region = delivery?.region || {};
  return {
    requestId: omsData?.orderCode,
    shippingLabel: label,
    status: "REQUESTED",
    orderInfo: {
      orderChannelCode: "KURLY_MALL",
      clientGroupOrderCode: order?.clientOrderCode,
      paymentAt: order?.paymentAt,
      goods: [{
        name: item?.goodsName,
        clientProductOrderCode: order?.clientOrderCode,
        productionCenter: item?.warehouseCode,
      }],
    },
    deliveryInfo: {
      type: region?.regionType,
      clusterCenter: item?.clusterCenter,
      temperatureGroupType: finalTempGroup,
      courierCode: delivery?.courier,
      deliveryReservationDate: delivery?.deliveryDate,
      requestLocation: {
        type: "DOORSTEP",
        detail: dest?.pickupDetail || "",
        accessMethodMemo: dest?.accesssType,
        accessMethodMemoDetail: dest?.accessDetail || "",
      },
      parcel: {
        type: omsData?.parcelType?.parcelCategory,
        imageUrl: omsData?.parcelType?.image || "",
      },
      region: {
        regionGroupCode: region?.regionGroupCode,
        regionCode: region?.regionCode,
        regionSubCode: region?.regionSubCode,
        sequence: String(region?.sequence ?? ""),
      },
      seller: {
        code: omsData?.seller?.code,
        name: omsData?.seller?.name,
        telNo: omsData?.seller?.telNo,
      },
      sender: {
        name: order?.orderer?.name,
        hpNo: order?.orderer?.phoneNumber,
        memo: order?.orderer?.memo,
      },
      receiver: {
        name: dest?.receiver?.name,
        hpNo: dest?.receiver?.phoneNumber,
        address: {
          coordinates: { latitude: round6(addr?.latitude), longitude: round6(addr?.longitude) },
          zipCode: addr?.zipCode,
          primaryAddress: addr?.primaryAddress,
          secondaryAddress: addr?.secondaryAddress,
          commandPrimaryAddress: addr?.primaryAddress,
          commandSecondaryAddress: addr?.secondaryAddress,
          sigungu: addr?.sigungu,
          dong: addr?.dong,
          buildingNumber: addr?.buildingManagementNumber,
        },
      },
    },
  };
}

async function publishKafkaUi(key: string, valueObj: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `${KAFKA_UI}/api/clusters/${CLUSTER}/topics/${encodeURIComponent(TOPIC_TMS)}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        partition: 0,
        key,
        value: JSON.stringify(valueObj),   // kafbat 본문 필드는 'value'
        keySerde: "String",
        valueSerde: "String",
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: `kafka-ui HTTP ${res.status}: ${t.slice(0, 160)}` };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 주문번호 1건의 TMS 발행 (운송장 생성). tracking 미준비 시 outbound 재시도. */
export async function publishTmsForOrder(clientOrderCode: string, maxTrackRetries = 5): Promise<{ ok: boolean; outbound?: string; labels: string[]; published: number; error?: string }> {
  // 1. tracking → outbound + 온도그룹 (outbound 나올 때까지 재시도)
  let outbound: string | undefined;
  let tempGroup = "ROOM_ONLY";
  for (let attempt = 0; attempt < maxTrackRetries; attempt++) {
    try {
      const res = await fetch(`${OMS_OP}/order/${clientOrderCode}/logistics-tracking`, { headers: { accept: "*/*" } });
      if (res.status === 200) {
        const data: any = await res.json();
        if (data?.outboundOrderCode) {
          outbound = data.outboundOrderCode;
          tempGroup = tempGroupOf(data?.orderItemTrackings || []);
          break;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!outbound) return { ok: false, labels: [], published: 0, error: "출고번호 없음 (OMS 미처리 — OMS 전송 후 재시도)" };

  // 2. outbound 상세
  let omsData: any;
  try {
    const res = await fetch(`${OMS_OP}/order/outbound/${outbound}`, { headers: { accept: "*/*" } });
    if (res.status !== 200) return { ok: false, outbound, labels: [], published: 0, error: `상세조회 HTTP ${res.status}` };
    omsData = await res.json();
  } catch (e) {
    return { ok: false, outbound, labels: [], published: 0, error: e instanceof Error ? e.message : String(e) };
  }

  const items: any[] = omsData?.order?.orderItems || [];
  const regionGroupCode: string = omsData?.delivery?.region?.regionGroupCode || "";
  const labels: string[] = [];
  let published = 0;
  let lastErr: string | undefined;

  // 3. item × seq 발행
  for (const item of items) {
    const oType = String(item?.orderType ?? "");
    const qty = parseInt(String(item?.orderQuantity ?? "1"), 10) || 1;
    const loop = SPLIT_QTY_TYPES.has(oType) ? qty : 1;
    for (let seq = 1; seq <= loop; seq++) {
      const label = shippingLabel(oType, regionGroupCode, outbound, seq);
      const msg = buildTmsMessage(omsData, item, tempGroup, label);
      const r = await publishKafkaUi(String(outbound), msg);
      if (r.ok) { published++; labels.push(label); }
      else lastErr = r.error;
    }
  }
  if (published === 0) return { ok: false, outbound, labels: [], published: 0, error: lastErr || "발행 0건" };
  return { ok: true, outbound, labels, published };
}

/** 여러 주문번호 일괄 TMS 발행. */
export async function publishTmsBatch(clientOrderCodes: string[], onProgress?: (e: TmsProgressEvent) => void): Promise<{ okCount: number; total: number; results: TmsResult[] }> {
  const results: TmsResult[] = [];
  for (let i = 0; i < clientOrderCodes.length; i++) {
    const idx = i + 1;
    const code = String(clientOrderCodes[i]).trim();
    if (!code) continue;
    const r = await publishTmsForOrder(code);
    results.push({ index: idx, clientOrderCode: code, ok: r.ok, outbound: r.outbound, labels: r.labels, published: r.published, error: r.error });
    onProgress?.({
      type: "tms", index: idx, ok: r.ok,
      message: r.ok
        ? `[#${idx}] ${code} → 출고 ${r.outbound} · 운송장 ${r.published}건 발행 (${r.labels.slice(0, 2).join(", ")}${r.labels.length > 2 ? "…" : ""})`
        : `[#${idx}] ${code} → 발행 실패: ${r.error}`,
    });
  }
  const okCount = results.filter((r) => r.ok).length;
  return { okCount, total: results.filter((r) => String(r.clientOrderCode).trim()).length, results };
}
