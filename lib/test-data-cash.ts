/**
 * 테스트 데이터 — 컬리캐시 강제 지급 (kurlypay test API)
 * POST https://point.stg.kurlypay.services/point/apis/v1/test/cash/publish
 *   body: { memberNo, amount, redeemCode, redeemCodeType }
 * stg test 전용 API — 적립금(free/publish)과 동일 인증 없음.
 *   ★ 호스트는 .services 사용: 캡쳐의 .co.kr 은 사내망 전용(어드민 서버에선 CloudFront 404),
 *     .services 가 적립금과 동일하게 내부에서 닿는 호스트. (검증: .services 는 400 비즈니스응답, .co.kr 은 404)
 */

const STG_CASH_URL = "https://point.stg.kurlypay.services/point/apis/v1/test/cash/publish";

export interface CashPublishInput {
  memberNo: number | string;
  amount: number;
  count: number;
  redeemCode?: string;       // 접두어(선택). redeemCode 는 멱등 이벤트키라 매 호출 유니크값 자동 생성됨.
  redeemCodeType?: string;   // 기본 "B2B"
}

// 폼/적립금 결과 테이블과 컬럼명 공유(seq/charge) — 렌더 재사용.
export interface CashPublishResult {
  index: number;
  ok: boolean;
  status?: number;
  seq?: number | string | null;
  charge?: number | null;
  error?: string;
  raw?: unknown;
}

export interface CashProgressEvent {
  type: "product";
  productIndex: number;
  ok: boolean;
  message: string;
}

async function call(body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(STG_CASH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: err instanceof Error ? err.message : String(err) };
  }
}

export async function publishCashBatch(
  input: CashPublishInput,
  onProgress?: (e: CashProgressEvent) => void
): Promise<CashPublishResult[]> {
  const emit = (e: CashProgressEvent) => onProgress?.(e);
  const total = Math.max(1, Math.min(100, input.count | 0 || 1));
  const amount = Math.max(1, Math.min(100_000_000, input.amount | 0));
  const memberNo = String(input.memberNo).trim();
  const redeemCodeType = input.redeemCodeType || "B2B";
  // redeemCode 는 멱등 이벤트키 — (회원+코드)가 한 번 쓰이면 영구 중복처리됨. 매 호출 유니크 코드 생성.
  const base = ((input.redeemCode || "qa").replace(/[^A-Za-z0-9_]/g, "").slice(0, 20)) || "qa";
  const stamp = Date.now().toString(36).slice(-5);

  const results: CashPublishResult[] = [];
  for (let i = 0; i < total; i++) {
    const idx = i + 1;
    const redeemCode = `${base}_${stamp}${idx}`;
    const r = await call({ memberNo, amount, redeemCode, redeemCodeType });
    const result: CashPublishResult = { index: idx, ok: false, status: r.status, raw: r.data };
    if (!r.ok || r.data?.success === false) {
      const msg = r.data?.error?.message ?? r.data?.message ?? (typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? {}).slice(0, 200));
      result.error = `HTTP ${r.status}: ${msg}`;
      emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] ${result.error}` });
      results.push(result); continue;
    }
    const data = r.data?.data ?? r.data ?? {};
    result.ok = true;
    result.charge = data.depositedAmount ?? data.amount ?? amount;
    result.seq = data.usedRedeemCode ?? redeemCode;   // 사용된 코드(이벤트키) 표시
    emit({ type: "product", productIndex: idx, ok: true, message: `[#${idx}] 컬리캐시 ${(result.charge ?? amount).toLocaleString()}원 지급 (code ${redeemCode})` });
    results.push(result);
  }
  return results;
}
