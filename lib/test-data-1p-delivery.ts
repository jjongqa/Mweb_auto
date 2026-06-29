/**
 * 테스트 데이터 — 1P(컬리배송 샛별/하루, 1P·FBK 상품) 배송상태 변경
 *
 * 위키 "1P, 3P, 컬리나우 배송상태 변경" > 1. 컬리배송 > 방법2. Kafka 사용.
 *   - 토픽 MSG-OMS-KURLY-BOX-TRACKING 에 메시지 1건 발행하면 컬리몰 주문 상태가 배송중/배송완료로 바뀐다.
 *   - 주문완료 상태부터 가능. **대표주문번호(orderCode=Key)만으로 매칭** — 3P와 달리 DB 조회/발송처리 불필요.
 *   - statusAt 은 orderAt 이후여야 함.
 *
 * 발행은 3P와 동일한 사내 kafka-ui(kafbat) REST: POST /api/clusters/{cluster}/topics/{topic}/messages
 *   ⚠️ 본문 필드명은 'value' (kafbat). 'content'면 200이지만 본문 null 로 버려짐(실측).
 * 인증 없음(사내망 한정).
 */

const KAFKA_UI = "https://manager-kafka-stg.dev.data.kurlycorp.kr";
const CLUSTER = "stg-msk-integration-01";
const TOPIC_1P = "MSG-OMS-KURLY-BOX-TRACKING";

// 위키 deliveryStatus 값: 배송중 DELIVERY_ING, 배송완료 DELIVERY_COMPLETED
export type OnePDeliveryStatus = "DELIVERING" | "DELIVERED";

export interface OnePDeliveryResult {
  index: number;
  parentOrderNo: string | number;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface OnePDeliveryProgressEvent {
  type: "order";
  index: number;
  ok: boolean;
  message: string;
}

/** "yyyy-MM-dd HH:mm:ss" (위키 1P 예시 형식, 공백 구분·타임존 없음). */
function fmtDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 출고요청번호(outboundOrderCode) — 컨슈머는 orderCode로 매칭하므로 매칭키 아님. 형식만 맞춰 자동 생성(JA###K#######).
function genOutbound(parentOrderNo: string | number): string {
  const n = Math.abs(Number(String(parentOrderNo).slice(-7)) || 1);
  const p = (v: number, len: number) => String(v).padStart(len, "0");
  return `JA${p(n % 1000, 3)}K${p(n % 10000000, 7)}`;
}

/** 1P 배송상태 Kafka 메시지 1건 발행 (위키 방법2 payload 그대로, 대표주문번호만으로). */
export async function produce1pDelivery(args: {
  parentOrderNo: string | number;
  status: OnePDeliveryStatus;
  at?: Date;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const now = args.at ?? new Date();
  const completed = args.status === "DELIVERED";
  const orderAt = new Date(now.getTime() - 60 * 60 * 1000);  // statusAt 이전이어야 함 → 1시간 전
  const oc = String(args.parentOrderNo);

  const payload = {
    orderCode: oc,
    outboundOrderCode: genOutbound(oc),
    orderAt: fmtDateTime(orderAt),
    courier: "FRS",
    courierName: "넥스트마일",
    invoiceNumber: genOutbound(oc) + "-0001",
    deliveryStatus: completed ? "DELIVERY_COMPLETED" : "DELIVERY_ING",
    statusAt: fmtDateTime(now),
    temperatureType: "COLD",
    deliveryPolicy: "DAWN",
    isEarlyBird: true,
    orderChannelCode: "KURLY_MALL",
    deliveryManager: completed ? { name: "QA배송", phoneNumber: "01000000000" } : null,
    deliverySuccess: null,
    deliveryFail: null,
  };

  const url = `${KAFKA_UI}/api/clusters/${CLUSTER}/topics/${encodeURIComponent(TOPIC_1P)}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        partition: 0,
        key: oc,                          // 위키: Key = {대표주문번호}
        value: JSON.stringify(payload),   // ⚠️ kafbat 본문 필드는 'value' ('content'면 null 발행)
        keySerde: "String",
        valueSerde: "String",
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: `kafka-ui HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 대표주문번호 여러 개를 배송완료(또는 배송중)로 일괄 처리. */
export async function mark1pDeliveredBatch(
  parentOrderNos: (string | number)[],
  status: OnePDeliveryStatus,
  onProgress?: (e: OnePDeliveryProgressEvent) => void
): Promise<OnePDeliveryResult[]> {
  const emit = (e: OnePDeliveryProgressEvent) => onProgress?.(e);
  const label = status === "DELIVERED" ? "배송완료" : "배송중";
  const results: OnePDeliveryResult[] = [];
  for (let i = 0; i < parentOrderNos.length; i++) {
    const idx = i + 1;
    const raw = parentOrderNos[i];
    const parentOrderNo = String(raw).trim();
    if (!parentOrderNo || !/^\d+$/.test(parentOrderNo)) {
      results.push({ index: idx, parentOrderNo: raw, ok: false, error: "유효하지 않은 대표주문번호" });
      emit({ type: "order", index: idx, ok: false, message: `[#${idx}] ${raw}: 유효하지 않은 대표주문번호` });
      continue;
    }
    const r = await produce1pDelivery({ parentOrderNo, status });
    results.push({ index: idx, parentOrderNo, ok: r.ok, status: r.status, error: r.error });
    emit({
      type: "order",
      index: idx,
      ok: r.ok,
      message: r.ok ? `[#${idx}] ${parentOrderNo}: ${label} 발행 OK (HTTP ${r.status})` : `[#${idx}] ${parentOrderNo}: 발행 실패 — ${r.error}`,
    });
  }
  return results;
}
