/**
 * 테스트 데이터 — 적립금 강제 지급 (kurlypay test API)
 * POST https://point.stg.kurlypay.services/point/apis/v1/test/free/publish
 *
 * stg test 전용 API — 인증 없이 호출 가능 (캡쳐 기준)
 */

const STG_POINT_URL = "https://point.stg.kurlypay.services/point/apis/v1/test/free/publish";
const DEFAULT_ACTION_MEMBER_NO = 7671779;  // 캡쳐 기본 (지급자/어드민)

export interface PointPublishInput {
  memberNumber: number | string;
  point: number;
  count: number;
  expireDateTime?: string;  // ISO format with timezone (예: 2027-05-23T13:42:21.27+09:00)
  memo?: string;
  detail?: string;
  actionMemberNumber?: number;
  historyType?: number;
}

export interface PointPublishResult {
  index: number;
  ok: boolean;
  status?: number;
  seq?: number | string | null;
  charge?: number | null;
  regDateTime?: string | null;
  expireDateTime?: string | null;
  error?: string;
  raw?: any;
}

export type PointStep = "PUBLISH";

export interface PointProgressEvent {
  type: "product";
  productIndex: number;
  ok: boolean;
  message: string;
}

function defaultExpireDateTime(): string {
  // 1년 후 23:59:59 KST (+09:00)
  const now = new Date();
  const expire = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate(), 23, 59, 59);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${expire.getFullYear()}-${pad(expire.getMonth() + 1)}-${pad(expire.getDate())}T${pad(expire.getHours())}:${pad(expire.getMinutes())}:${pad(expire.getSeconds())}+09:00`;
}

async function call(body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(STG_POINT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: err instanceof Error ? err.message : String(err) };
  }
}

export async function publishPointsBatch(
  input: PointPublishInput,
  onProgress?: (e: PointProgressEvent) => void
): Promise<PointPublishResult[]> {
  const emit = (e: PointProgressEvent) => onProgress?.(e);
  const total = Math.max(1, Math.min(100, input.count | 0 || 1));
  const expireDate = input.expireDateTime || defaultExpireDateTime();
  const memberNumber = Number(input.memberNumber);
  const point = Math.max(1, Math.min(100_000_000, input.point | 0));

  const results: PointPublishResult[] = [];
  for (let i = 0; i < total; i++) {
    const idx = i + 1;
    const body = {
      memberNumber,
      point,
      historyType: input.historyType ?? 5,
      payment: false,
      settle: false,
      expireDate,
      memo: input.memo ?? "테스트지급",
      detail: input.detail ?? `QA 자동지급 #${idx}`,
      actionMemberNumber: input.actionMemberNumber ?? DEFAULT_ACTION_MEMBER_NO,
      hidden: false,
    };
    const r = await call(body);
    const result: PointPublishResult = { index: idx, ok: false, status: r.status, raw: r.data };
    if (!r.ok || r.data?.success === false) {
      const msg = r.data?.message ?? JSON.stringify(r.data).slice(0, 200);
      result.error = `HTTP ${r.status}: ${msg}`;
      emit({ type: "product", productIndex: idx, ok: false, message: `[#${idx}] ${result.error}` });
      results.push(result); continue;
    }
    const data = r.data?.data ?? {};
    result.ok = true;
    result.seq = data.seq;
    result.charge = data.charge;
    result.regDateTime = data.regDateTime;
    result.expireDateTime = data.expireDateTime;
    emit({ type: "product", productIndex: idx, ok: true, message: `[#${idx}] 지급 완료 seq=${data.seq} (${data.charge?.toLocaleString()}원)` });
    results.push(result);
  }
  return results;
}
