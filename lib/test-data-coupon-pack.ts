/**
 * 테스트 데이터 — 쿠폰팩(coupon-packs) 생성 + 발급 풀체인.
 * stg lacms admin gateway. 쿠폰 발행과 동일 인증(JWT + X-KURLY-CMS-USER), 동일 베이스.
 *
 * 쿠폰팩 = 이미 만든 쿠폰 발행 ID들(coupon_publish_ids)을 묶는 것.
 *   생성  POST /v3/admin/coupon-packs                 → { data: { id } }
 *   대상  POST /v3/admin/coupon-packs/{id}/target/file (ADMIN 발급 회원 CSV, multipart 'file')
 *   발급  POST /v3/admin/coupon-packs/{id}/issue       (운영자 발급, body 없음)
 *   활성  POST /v3/admin/coupon-packs/{id}/activate     (DOWNLOAD 활성화, body 없음)
 *
 * 풀체인: ADMIN → 생성 → (대상 회원 지정 시) target/file → issue
 *         DOWNLOAD → 생성 → activate
 */

const STG_BASE = "https://gateway.cloud.stg.kurly.services/admin/marketing-coupon-api";
const LACMS_ORIGIN = "https://lacms2.stg.kurlycorp.kr";

export type PackIssueType = "ADMIN" | "DOWNLOAD";

export interface CouponPackInput {
  jwtToken: string;
  cmsUser?: string;
  name: string;
  couponPublishIds: number[];        // 묶을 쿠폰 발행 ID들 (필수)
  issueType: PackIssueType;
  validDays?: number;                // publish_period 기간(일) — default 7
  bundleUse?: boolean;               // 묶음 사용 처리 여부
  issueMemberNos?: string[];         // ADMIN: 발급 대상 회원번호 (지정 시 target/file → issue)
}

export interface CouponPackResult {
  ok: boolean;
  status?: number;
  id?: number | string | null;
  issued?: boolean;                  // ADMIN 운영자 발급 완료
  activated?: boolean;               // DOWNLOAD 활성화 완료
  targetCount?: number | null;       // 발급대상 저장 수
  error?: string;                    // 생성 단계 실패
  stepError?: string;                // 발급/활성 단계 실패(생성은 성공)
}

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function authHeaders(input: CouponPackInput): Record<string, string> {
  const h: Record<string, string> = {
    "authorization": `bearer ${input.jwtToken}`,
    "origin": LACMS_ORIGIN,
    "referer": LACMS_ORIGIN + "/",
  };
  if (input.cmsUser) h["x-kurly-cms-user"] = input.cmsUser;
  return h;
}

async function postJson(url: string, body: unknown | null, input: CouponPackInput) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json", ...authHeaders(input) },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = await res.text().catch(() => null); }
  return { ok: res.ok && data?.success !== false, status: res.status, data };
}

// 쿠폰 발행 단건 조회 → 발급기간(publish_period) 추출. GET /v3/admin/coupon-publishes/{id}
async function fetchPublishPeriod(input: CouponPackInput, id: number): Promise<{ start: string; end: string } | null> {
  try {
    const res = await fetch(`${STG_BASE}/v3/admin/coupon-publishes/${id}`, {
      method: "GET",
      headers: { "Accept": "application/json", ...authHeaders(input) },
    });
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    if (data?.success === false) return null;
    const pp = data?.data?.publish_period ?? data?.publish_period;
    if (pp?.start_at && pp?.end_at) return { start: String(pp.start_at), end: String(pp.end_at) };
    return null;
  } catch {
    return null;
  }
}

const ms = (s: string) => new Date(s.replace(" ", "T")).getTime();

export async function createCouponPack(
  input: CouponPackInput,
  onStep?: (msg: string, ok: boolean) => void
): Promise<CouponPackResult> {
  const emit = (msg: string, ok = true) => onStep?.(msg, ok);
  const days = Math.max(1, Math.min(365, input.validDays ?? 7));
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // 정책: 쿠폰팩 발급기간 = 묶을 쿠폰들의 발급기간과 일치해야 함.
  // 각 쿠폰 발급기간을 조회해 교집합(가장 늦은 시작 ~ 가장 이른 종료)으로 맞춘다.
  let startAt = fmtLocal(now);
  let endAt = fmtLocal(end);
  const periods = (await Promise.all(input.couponPublishIds.map((id) => fetchPublishPeriod(input, id))))
    .filter((p): p is { start: string; end: string } => p != null);
  if (periods.length > 0) {
    const latestStart = periods.map((p) => p.start).reduce((a, b) => (ms(b) > ms(a) ? b : a));
    const earliestEnd = periods.map((p) => p.end).reduce((a, b) => (ms(b) < ms(a) ? b : a));
    if (ms(latestStart) >= ms(earliestEnd)) {
      emit(`묶을 쿠폰들의 발급기간이 서로 겹치지 않습니다 (시작 ${latestStart} ≥ 종료 ${earliestEnd}) — 같은 기간 쿠폰끼리만 묶을 수 있어요`, false);
      return { ok: false, error: "쿠폰 발급기간 교집합 없음 — 서로 다른 기간의 쿠폰이 섞였습니다" };
    }
    startAt = latestStart;
    endAt = earliestEnd;
    emit(`발급기간 정렬: ${startAt} ~ ${endAt} (쿠폰 ${periods.length}개 발급기간 일치)`);
  } else {
    emit(`쿠폰 발급기간 조회 실패 — 현재시각 기준으로 진행(쿠폰 발급기간과 불일치 시 400 가능)`, false);
  }

  const body: Record<string, unknown> = {
    issue_type: input.issueType,
    name: input.name.slice(0, 50),
    bundle_use: !!input.bundleUse,
    coupon_publish_ids: input.couponPublishIds,
    publish_period: { start_at: startAt, end_at: endAt },
    // 쿠폰팩 예산 — 비활성(QA). 공식 예시 바디에 있는 필드로, 누락 시 서버 NPE(500) 유발 가능 → 명시.
    budget: { budget_enabled: false, budget_cost: null },
  };
  // DOWNLOAD 만 download_condition 필요. 공식 예시 키 전체를 채워 NPE 회피(미설정은 null).
  if (input.issueType === "DOWNLOAD") {
    body.download_condition = {
      download_condition_type: "ACCESS_KEY",
      keyword: null,
      access_key: null,
      random_code_issue_quantity: null,
      max_issue: null,
      member_max_issue: null,   // 쿠폰팩은 "회원당 최대 발급 수량 설정 불가" (400) — 반드시 null
      max_budget_cost: null,
      allow_biz_member: false,
      last_sale_condition: { last_sale_condition_type: "ALL", last_sale_condition_purchase_type: "ALL", n_days: null },
      allow_member_level: null,
      allow_subscription_type: null,
      allow_vip_types: null,
    };
  }

  // 1) 생성
  const created = await postJson(`${STG_BASE}/v3/admin/coupon-packs`, body, input);
  if (!created.ok) {
    emit(`생성 실패 (HTTP ${created.status}): ${JSON.stringify(created.data ?? "").slice(0, 300)}`, false);
    return { ok: false, status: created.status, error: `생성 실패 (HTTP ${created.status}): ${JSON.stringify(created.data ?? "").slice(0, 300)}` };
  }
  const id = created.data?.data?.id ?? created.data?.id ?? null;
  emit(`쿠폰팩 생성 OK (id=${id}, 쿠폰 ${input.couponPublishIds.length}개 묶음)`);
  const result: CouponPackResult = { ok: true, status: created.status, id };
  if (id == null) { result.stepError = "생성 응답에 id 없음 — 발급 스킵"; return result; }

  // 2) 발급/활성
  if (input.issueType === "DOWNLOAD") {
    const act = await postJson(`${STG_BASE}/v3/admin/coupon-packs/${id}/activate`, null, input);
    result.activated = act.ok;
    emit(act.ok ? `다운로드 활성화 OK` : `활성화 실패 (HTTP ${act.status}): ${JSON.stringify(act.data ?? "").slice(0, 200)}`, act.ok);
    if (!act.ok) result.stepError = `활성화 실패: HTTP ${act.status}`;
    return result;
  }

  // ADMIN: 발급 대상 지정 시 target/file → issue
  const members = (input.issueMemberNos ?? []).filter((s) => /^\d+$/.test(s.trim()));
  if (members.length === 0) {
    emit(`ADMIN 발급 — 대상 회원 미지정이라 생성까지만 (발급 스킵)`);
    return result;
  }
  try {
    const csv = "회원번호\n" + members.join("\n") + "\n";
    const fd = new FormData();
    fd.append("file", new Blob([csv], { type: "text/csv" }), "targets.csv");
    const tRes = await fetch(`${STG_BASE}/v3/admin/coupon-packs/${id}/target/file`, { method: "POST", headers: authHeaders(input), body: fd });
    let tData: any = null; try { tData = await tRes.json(); } catch { tData = null; }
    if (!tRes.ok || tData?.success === false) { result.stepError = `발급대상 저장 실패: HTTP ${tRes.status}`; emit(result.stepError, false); return result; }
    result.targetCount = tData?.data?.count ?? members.length;
    emit(`발급대상 ${result.targetCount}명 저장 OK`);
  } catch (e) {
    result.stepError = `발급대상 저장 예외: ${e instanceof Error ? e.message : String(e)}`;
    emit(result.stepError, false); return result;
  }
  const iss = await postJson(`${STG_BASE}/v3/admin/coupon-packs/${id}/issue`, null, input);
  result.issued = iss.ok;
  emit(iss.ok ? `운영자 발급 OK` : `발급 실패 (HTTP ${iss.status}): ${JSON.stringify(iss.data ?? "").slice(0, 200)}`, iss.ok);
  if (!iss.ok) result.stepError = `발급 실패: HTTP ${iss.status}`;
  return result;
}
