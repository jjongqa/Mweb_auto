/**
 * 테스트 데이터 — 상품 후기(리뷰) 작성
 *
 * product-review docs(/product-review/docs). 인증 = X-KURLY-MEMBER-NO 헤더만(쿠키리스).
 * 후기는 **배송완료 상태**의 주문에만 작성 가능 — 작성가능 후기 목록 API가 배송완료된 건만 돌려주므로
 * 그 목록을 받아 자동으로 일괄 작성한다. (배송완료 제약 자동 충족)
 *
 *   작성가능 목록  GET  /v1/writable-reviews?pageNo=&size=  → data[]{ orderNo, dealProductNo, ... }
 *   후기 등록      POST /v2/orders/{orderNo}/deal-products/{dealProductNo}
 *                  body { contents, uploadImages:[], passStatus } → 204 No Content
 *   passStatus: NONE(검증 안 함, 테스트용) / ALL(금칙어+무의미) / FORBIDDEN(금칙어만). 422 회피 위해 NONE.
 *
 * base 검증: GET /product-review/v1/writable-reviews → 401(라우트 존재), prefix 없으면 404 (2026-06-18 실측).
 */

const STG_BASE = "https://gateway.cloud.stg.kurly.services/product-review";

// 기본 후기 내용 풀 (10자 이상, 금칙어 없음) — 항목마다 회전해 동일 내용 반복 회피.
const DEFAULT_CONTENTS = [
  "신선하고 맛있어서 아주 만족스러워요. 재구매 의사 있습니다!",
  "배송도 빠르고 품질도 좋네요. 가족들이 잘 먹었어요. 추천합니다.",
  "기대 이상으로 좋았습니다. 포장도 꼼꼼해서 다음에도 또 주문할게요.",
  "상품 상태 훌륭하고 가성비도 좋아요. 잘 먹겠습니다 감사합니다.",
  "신선도 유지가 잘 되어 있고 맛도 괜찮습니다. 만족스러운 구매였어요.",
];

export type ReviewPassStatus = "NONE" | "ALL" | "FORBIDDEN";

export interface WritableReviewItem {
  orderNo: number | string;
  dealProductNo: number | string;
  contentsProductName?: string | null;
  dealProductName?: string | null;
  shippedDate?: string | null;
  expectedReward?: number | null;
  isFirstReview?: boolean;
}

export interface ReviewWriteInput {
  memberNo: number | string;
  contents?: string;          // 비우면 기본 풀에서 회전
  maxCount?: number;          // 0/미지정 = 작성 가능 전체
  passStatus?: ReviewPassStatus;  // default NONE
}

export interface ReviewWriteResult {
  index: number;
  orderNo: number | string;
  dealProductNo: number | string;
  productName?: string | null;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ReviewWriteProgressEvent {
  type: "phase" | "review";
  index?: number;
  ok: boolean;
  message: string;
}

function authHeaders(memberNo: number | string): Record<string, string> {
  return {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json",
    "X-KURLY-MEMBER-NO": String(memberNo),
  };
}

/** 작성 가능(배송완료) 후기 목록 조회. nextPage 따라가며 수집(최대 몇 페이지). */
export async function fetchWritableReviews(
  memberNo: number | string,
  opts?: { maxPages?: number; size?: number }
): Promise<{ ok: boolean; items: WritableReviewItem[]; error?: string }> {
  const size = opts?.size ?? 100;
  const maxPages = opts?.maxPages ?? 5;
  const items: WritableReviewItem[] = [];
  try {
    let pageNo: number | null = 1;
    for (let guard = 0; pageNo != null && guard < maxPages; guard++) {
      const res = await fetch(`${STG_BASE}/v1/writable-reviews?pageNo=${pageNo}&size=${size}`, {
        method: "GET",
        headers: { "Accept": "application/json", "X-KURLY-MEMBER-NO": String(memberNo) },
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, items, error: `작성가능 목록 조회 실패 HTTP ${res.status}: ${t.slice(0, 200)}` };
      }
      const data: any = await res.json().catch(() => null);
      const list: any[] = Array.isArray(data?.data) ? data.data : [];
      for (const d of list) {
        if (d?.orderNo == null || d?.dealProductNo == null) continue;
        items.push({
          orderNo: d.orderNo,
          dealProductNo: d.dealProductNo,
          contentsProductName: d.contentsProductName ?? null,
          dealProductName: d.dealProductName ?? null,
          shippedDate: d.shippedDate ?? null,
          expectedReward: d.expectedReward ?? null,
          isFirstReview: d.isFirstReview ?? undefined,
        });
      }
      pageNo = data?.meta?.pagination?.nextPage ?? null;
    }
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 후기 1건 등록. 성공 204. 실패 시 422 메시지 등 추출. */
export async function createReview(args: {
  memberNo: number | string;
  orderNo: number | string;
  dealProductNo: number | string;
  contents: string;
  passStatus?: ReviewPassStatus;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(`${STG_BASE}/v2/orders/${args.orderNo}/deal-products/${args.dealProductNo}`, {
      method: "POST",
      headers: authHeaders(args.memberNo),
      body: JSON.stringify({
        contents: args.contents,
        uploadImages: [],
        passStatus: args.passStatus ?? "NONE",
      }),
    });
    if (res.ok) return { ok: true, status: res.status };
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    const msg = data?.message ?? (typeof data === "string" ? data : JSON.stringify(data ?? {}).slice(0, 200));
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${msg}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 회원의 작성 가능 후기들을 조회해 일괄 작성. */
export async function writeReviewsBatch(
  input: ReviewWriteInput,
  onProgress?: (e: ReviewWriteProgressEvent) => void
): Promise<{ results: ReviewWriteResult[]; writableTotal: number; error?: string }> {
  const emit = (e: ReviewWriteProgressEvent) => onProgress?.(e);
  const passStatus = input.passStatus ?? "NONE";
  const custom = input.contents?.trim();

  emit({ type: "phase", ok: true, message: `작성 가능(배송완료) 후기 조회 중…` });
  const w = await fetchWritableReviews(input.memberNo);
  if (!w.ok) {
    emit({ type: "phase", ok: false, message: w.error ?? "작성가능 목록 조회 실패" });
    return { results: [], writableTotal: 0, error: w.error };
  }
  const max = input.maxCount && input.maxCount > 0 ? input.maxCount : w.items.length;
  const targets = w.items.slice(0, max);
  emit({ type: "phase", ok: true, message: `작성 가능 ${w.items.length}건 중 ${targets.length}건 작성 시작` });

  const results: ReviewWriteResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    const it = targets[i];
    const idx = i + 1;
    // 후기는 "이전에 작성한 후기와 동일 내용"이면 422 → 항목마다 고유 꼬리표(주문번호)를 붙여
    // 배치 내·과거 작성분 모두와 안 겹치게 한다. (custom 내용을 넣어도 항목별로 유니크해짐)
    const base = custom || DEFAULT_CONTENTS[i % DEFAULT_CONTENTS.length];
    const contents = `${base} (주문 ${it.orderNo})`;
    const name = it.dealProductName ?? it.contentsProductName ?? null;
    const r = await createReview({
      memberNo: input.memberNo,
      orderNo: it.orderNo,
      dealProductNo: it.dealProductNo,
      contents,
      passStatus,
    });
    results.push({ index: idx, orderNo: it.orderNo, dealProductNo: it.dealProductNo, productName: name, ok: r.ok, status: r.status, error: r.error });
    emit({
      type: "review",
      index: idx,
      ok: r.ok,
      message: r.ok
        ? `[#${idx}] 후기 작성 OK — 주문 ${it.orderNo} / 딜 ${it.dealProductNo}${name ? ` (${name})` : ""}`
        : `[#${idx}] 작성 실패 — 주문 ${it.orderNo}: ${r.error}`,
    });
  }
  return { results, writableTotal: w.items.length };
}
