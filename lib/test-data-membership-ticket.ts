/**
 * 테스트 데이터 — 멤버스 무료이용권 등록
 * POST /membership-internal/v1/admin/subscriptions/tickets
 *
 * 위키 "멤버스 무료이용권 > 무료이용권 등록". 기존 회원에게 무료이용권을 직접 등록.
 * 인증 불필요 (stg internal). 여러 회원 동시 처리.
 *
 * ⚠️ 본문 필드명은 `ticketMetaId` (위키엔 freeTicketMetaId 로 적혀 있으나 그건 400 — 2026-06-17 실측 확인).
 *    /subscriptions/tickets/vip/subscribe (강제 구독, test-data-membership.ts) 와는 다른 엔드포인트.
 */

const STG_TICKET_URL = "https://gateway.cloud.stg.kurly.services/membership-internal/v1/admin/subscriptions/tickets";

// ticketMetaId → 표시명 (멤버스 강제구독 폼과 동일 매핑)
export const TICKET_META: { id: number; label: string }[] = [
  { id: 1, label: "VVIP 6개월 무료이용권" },
  { id: 2, label: "VIP 6개월 무료이용권" },
  { id: 3, label: "1개월 무료이용권" },
  { id: 4, label: "2개월 무료이용권" },
  { id: 5, label: "3개월 무료이용권" },
  { id: 6, label: "4개월 무료이용권" },
  { id: 7, label: "5개월 무료이용권" },
];

export interface MembershipTicketInput {
  memberNos: (number | string)[];
  ticketMetaId: number;
  registeredAt: string;   // "YYYY-MM-DDTHH:mm:ss" (timezone 없음)
  expiredAt: string;      // "YYYY-MM-DDTHH:mm:ss"
}

export interface MembershipTicketResult {
  index: number;
  memberNo: number | string;
  ok: boolean;
  status?: number;
  ticketId?: number | string | null;
  ticketName?: string | null;
  registeredAt?: string | null;
  expiredAt?: string | null;
  error?: string;
}

export interface MembershipTicketProgressEvent {
  type: "member";
  index: number;
  ok: boolean;
  message: string;
}

/** "YYYY-MM-DD" → "YYYY-MM-DDTHH:mm:ss" 보정 (이미 시각 포함이면 그대로). */
export function normalizeTicketDate(s: string, endOfDay = false): string {
  const t = (s || "").trim();
  if (!t) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T${endOfDay ? "23:59:59" : "00:00:00"}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t;
}

export async function registerMembershipTicketBatch(
  input: MembershipTicketInput,
  onProgress?: (e: MembershipTicketProgressEvent) => void
): Promise<MembershipTicketResult[]> {
  const emit = (e: MembershipTicketProgressEvent) => onProgress?.(e);
  const registeredAt = normalizeTicketDate(input.registeredAt, false);
  const expiredAt = normalizeTicketDate(input.expiredAt, true);
  const ticketMetaId = input.ticketMetaId;

  const results: MembershipTicketResult[] = [];
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
      const res = await fetch(STG_TICKET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ memberNo, ticketMetaId, registeredAt, expiredAt }),
      });
      let data: any = null;
      try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
      // 성공 응답: {id, memberNo, name, registeredAt, expiredAt}. 실패: {success:false, message}
      const ok = res.ok && data && data.success !== false && (data.id != null || data.memberNo != null);
      if (!ok) {
        const msg = data?.message ?? (typeof data === "string" ? data : JSON.stringify(data ?? {}).slice(0, 200));
        results.push({ index: idx, memberNo, ok: false, status: res.status, error: `HTTP ${res.status}: ${msg}` });
        emit({ type: "member", index: idx, ok: false, message: `[#${idx}] ${memberNo}: HTTP ${res.status} ${msg}` });
        continue;
      }
      const r: MembershipTicketResult = {
        index: idx, memberNo, ok: true, status: res.status,
        ticketId: data.id ?? null, ticketName: data.name ?? null,
        registeredAt: data.registeredAt ?? registeredAt, expiredAt: data.expiredAt ?? expiredAt,
      };
      results.push(r);
      emit({ type: "member", index: idx, ok: true, message: `[#${idx}] ${memberNo}: ${data.name ?? "이용권"} 등록 (id=${data.id ?? "-"})` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ index: idx, memberNo, ok: false, error: msg });
      emit({ type: "member", index: idx, ok: false, message: `[#${idx}] ${memberNo}: ${msg}` });
    }
  }
  return results;
}
