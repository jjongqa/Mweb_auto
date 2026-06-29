/**
 * 테스트 데이터 — 멤버스 구독 "해지 예약" 전환 / 취소
 * PUT /membership/v1/subscriptions/payments/products/unsubscribe/reserve
 *
 * 회원용 API. 인증 = X-KURLY-MEMBER-NO 헤더만(쿠키리스, OAuth 불필요).
 * 이미 멤버스 구독 중인 회원을 "해지 예약" 상태(cancelReserved=true)로 전환.
 *   isCancelReserved=true  → 해지 예약 전환
 *   isCancelReserved=false → 해지 예약 취소
 * 성공 응답: 204 No Content (본문 없음). 여러 회원 동시 처리.
 *
 * base 검증: GET /membership/v1/subscriptions/cancel-reason 200 (2026-06-18 실측).
 */

const STG_BASE = "https://gateway.cloud.stg.kurly.services/membership";
const RESERVE_URL = `${STG_BASE}/v1/subscriptions/payments/products/unsubscribe/reserve`;

// 해지 사유 — 라이브 GET /v1/subscriptions/cancel-reason 값(2026-06-18). 해지예약 전환 시에만 사용(옵션).
export const CANCEL_REASONS: { id: number; reason: string }[] = [
  { id: 1, reason: "멤버십 혜택을 이용하지 않아서" },
  { id: 2, reason: "멤버십 혜택이 적어서" },
  { id: 3, reason: "멤버십 가입비가 부담되어서" },
  { id: 4, reason: "컬리를 이용하지 않아서" },
  { id: 5, reason: "기타" },
];

export interface CancelReserveInput {
  memberNos: (number | string)[];
  isCancelReserved: boolean;       // true=해지예약 전환, false=해지예약 취소
  cancelReasonId?: number | null;  // 전환 시 선택(옵션). 취소 시 null.
  opinion?: string | null;         // 기타 의견(옵션)
}

export interface CancelReserveResult {
  index: number;
  memberNo: number | string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface CancelReserveProgressEvent {
  type: "member";
  index: number;
  ok: boolean;
  message: string;
}

export async function reserveCancelBatch(
  input: CancelReserveInput,
  onProgress?: (e: CancelReserveProgressEvent) => void
): Promise<CancelReserveResult[]> {
  const emit = (e: CancelReserveProgressEvent) => onProgress?.(e);
  const action = input.isCancelReserved ? "해지예약" : "해지예약 취소";
  const body = {
    cancelReasonId: input.isCancelReserved ? (input.cancelReasonId ?? null) : null,
    opinion: input.isCancelReserved ? (input.opinion?.trim() || null) : null,
    isCancelReserved: input.isCancelReserved,
    ticketSelection: null,
  };

  const results: CancelReserveResult[] = [];
  for (let i = 0; i < input.memberNos.length; i++) {
    const idx = i + 1;
    const raw = input.memberNos[i];
    const memberNo = Number(raw);
    if (!memberNo || isNaN(memberNo)) {
      results.push({ index: idx, memberNo: raw, ok: false, error: "유효하지 않은 회원번호" });
      emit({ type: "member", index: idx, ok: false, message: `[#${idx}] ${raw}: 유효하지 않은 회원번호` });
      continue;
    }
    try {
      const res = await fetch(RESERVE_URL, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Accept": "application/json",
          "X-KURLY-MEMBER-NO": String(memberNo),
        },
        body: JSON.stringify(body),
      });
      // 성공 = 204 No Content. 실패 = {success:false,message} 또는 4xx/5xx
      if (res.ok) {
        results.push({ index: idx, memberNo, ok: true, status: res.status });
        emit({ type: "member", index: idx, ok: true, message: `[#${idx}] ${memberNo}: ${action} 완료 (HTTP ${res.status})` });
        continue;
      }
      let data: any = null;
      try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
      const msg = data?.message ?? (typeof data === "string" ? data : JSON.stringify(data ?? {}).slice(0, 200));
      results.push({ index: idx, memberNo, ok: false, status: res.status, error: `HTTP ${res.status}: ${msg}` });
      emit({ type: "member", index: idx, ok: false, message: `[#${idx}] ${memberNo}: HTTP ${res.status} ${msg}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ index: idx, memberNo, ok: false, error: msg });
      emit({ type: "member", index: idx, ok: false, message: `[#${idx}] ${memberNo}: ${msg}` });
    }
  }
  return results;
}
