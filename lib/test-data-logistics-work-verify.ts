/**
 * 테스트 데이터(검증) — 컬리로 근무관리 대시보드 검증  [컬리로/근무관리 검증]
 *
 * 원본: fulfillment_sqe_studio `pages/4_work_schedule_verify.py` 포팅.
 *   "생성"이 아니라 통계 API ↔ 리스트 집계 ↔ 필터 조회를 교차 비교해 대시보드 정합성을 검증한다.
 *
 * 흐름: 어드민 로그인 → work-schedules 리스트 + 통계 3종 조회 → 리스트 직접 집계 →
 *       그래프 필터별 total 재조회 → 통계값/집계값/필터값 교차 비교(PASS/FAIL).
 */

const INT = process.env.KURLYRO_INT || "https://kurlyro-int-qa.dev.kurly.services";

const BASE_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  origin: "https://kurlyro-admin-qa.dev.kurlycorp.kr",
  referer: "https://kurlyro-admin-qa.dev.kurlycorp.kr/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Restrict-Access-Api": "PASS",
  "X-Forwarded-For": "127.0.0.1",
};

const DAY_OFF_TYPES = new Set(["휴일", "휴무", "연차", "반차(오전)", "반차(오후)"]);

export interface WorkVerifyInput {
  adminId: string;
  adminPw: string;
  cluster: string;       // CC02 등
  center?: string;       // 미지정=전체
  workPart?: string;     // 미지정=전체
  startDate: string;     // YYYY-MM-DD
  endDate: string;       // YYYY-MM-DD
  workTypes?: string;    // 쉼표구분, 비우면 전체
}

export interface VerifyCheck { group: string; label: string; statVal: number | null; listVal: number | null; filterVal: number | null; pass: boolean }
export interface WorkVerifyResult {
  ok: boolean;
  error?: string;
  summary?: { total: number; passed: number; failed: number };
  charts?: {
    workType: { dayOn: number; partDayOn: number; dayOff: number };
    commute: { preregistered: number; normalStart: number; endWork: number };
    exec: { normal: number; abnormal: number; detail: Record<string, number> };
  };
  listTotal?: number;
  checks?: VerifyCheck[];
}
export interface WorkVerifyProgress { type: "step"; ok: boolean; message: string }

function authHeaders(token: string, cluster: string): Record<string, string> {
  return { ...BASE_HEADERS, Authorization: `Bearer ${token}`, "Want-Cluster-Response": cluster };
}
async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers });
  if (res.status !== 200 && res.status !== 201) return null;
  return res.json().catch(() => null);
}
function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.append(k, String(v));
  return p.toString();
}

async function adminLogin(id: string, pw: string, cluster: string): Promise<{ token?: string; error?: string }> {
  try {
    const res = await fetch(`${INT}/v1/admin-accounts/login`, {
      method: "POST", headers: { ...BASE_HEADERS, "Want-Cluster-Response": cluster },
      body: JSON.stringify({ loginId: id, password: pw }),
    });
    if (res.status !== 200 && res.status !== 201) return { error: `어드민 로그인 실패 (HTTP ${res.status})` };
    const d = await res.json().catch(() => ({}));
    const token = d?.data?.token ?? d?.data?.accessToken ?? d?.token;
    return token ? { token } : { error: "토큰 없음" };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

function listParams(i: WorkVerifyInput, extra?: Record<string, string | number>): Record<string, string | number | undefined> {
  return {
    page: 1, size: 500, cluster: i.cluster, searchWords: "",
    startWorkDate: i.startDate, endWorkDate: i.endDate, searchOnlyChanged: "false",
    workTypes: i.workTypes?.trim() || "",
    center: i.center || undefined, workPart: i.workPart || undefined,
    ...extra,
  };
}

export async function runWorkVerify(input: WorkVerifyInput, onProgress?: (e: WorkVerifyProgress) => void): Promise<WorkVerifyResult> {
  const emit = (ok: boolean, message: string) => onProgress?.({ type: "step", ok, message });
  const { token, error } = await adminLogin(input.adminId, input.adminPw, input.cluster);
  if (!token) { emit(false, `어드민 로그인 실패: ${error}`); return { ok: false, error }; }
  emit(true, "✅ 어드민 로그인");
  const H = authHeaders(token, input.cluster);

  // 리스트 + 통계 3종
  emit(true, "리스트/통계 조회 중...");
  const list = await getJson(`${INT}/v1/work-schedules?${qs(listParams(input))}`, H);
  const content: any[] = list?.data?.content || [];
  const listTotal: number = list?.data?.total ?? 0;

  const statWT = (await getJson(`${INT}/v1/statistics/work-schedule/current-work-type?${qs({ cluster: input.cluster, workDate: input.startDate, center: input.center || undefined, workPart: input.workPart || undefined })}`, H))?.data || {};
  const statCS = (await getJson(`${INT}/v1/statistics/work-schedule/current-commute-status?${qs({ cluster: input.cluster, workDate: input.startDate, center: input.center || undefined, workPart: input.workPart || undefined })}`, H))?.data || {};
  const statEX = (await getJson(`${INT}/v1/statistics/work-schedule/work-plan-execution-result?${qs({ cluster: input.cluster, startWorkDate: input.startDate, endWorkDate: input.endDate, center: input.center || undefined, workPart: input.workPart || undefined })}`, H))?.data || {};

  // 리스트 집계
  let csPre = 0, csNormal = 0, csEnd = 0, aggNormal = 0, aggAbnormal = 0;
  for (const it of content) {
    const cs = it?.commuteStatus?.text || "";
    const wt = it?.workType?.text || "";
    if (cs === "출근전") csPre++;
    else if (cs === "근무중") csNormal++;
    else if (cs === "퇴근") csEnd++;
    if (!DAY_OFF_TYPES.has(wt) && cs !== "휴무" && !["출근전", "출근", "근무중"].includes(cs)) {
      if (it?.needCheckExecutionResult === true) aggAbnormal++; else aggNormal++;
    }
  }

  // 필터 조회 헬퍼
  const filteredTotal = async (key: string, value: string, extra?: Record<string, string>): Promise<number | null> => {
    const d = await getJson(`${INT}/v1/work-schedules?${qs(listParams(input, { [key]: value, ...(extra || {}) }))}`, H);
    return d?.data?.total ?? null;
  };

  emit(true, "교차 검증 중...");
  const checks: VerifyCheck[] = [];
  const push = (group: string, label: string, statVal: number | null, listVal: number | null, filterVal: number | null) => {
    const pass = (filterVal === null && listVal === null) ? true
      : listVal !== null ? statVal === listVal
      : filterVal !== null ? statVal === filterVal : true;
    checks.push({ group, label, statVal, listVal, filterVal, pass });
  };

  // 1. 현재 근무 현황 (통계 vs 필터)
  push("현재 근무 현황", "근무", statWT.dayOnCount ?? null, null, await filteredTotal("currentWorkType", "근무"));
  push("현재 근무 현황", "부분근무", statWT.partDayOnCount ?? null, null, await filteredTotal("currentWorkType", "부분근무"));
  push("현재 근무 현황", "휴무", statWT.dayOffCount ?? null, null, await filteredTotal("currentWorkType", "휴무"));
  push("현재 근무 현황", "합계(total)", statWT.totalCount ?? null, listTotal, null);

  // 2. 현재 출근 현황 (통계 vs 리스트 집계)
  push("현재 출근 현황", "출근전", statCS.preregisteredCount ?? null, csPre, null);
  push("현재 출근 현황", "근무중", statCS.normalStartCount ?? null, csNormal, null);
  push("현재 출근 현황", "퇴근", statCS.endWorkCount ?? null, csEnd, null);

  // 3. 근무계획 수행 결과 (통계 vs 리스트 집계)
  push("수행 결과", "정상", statEX.totalNormalWorkEndedCount ?? null, aggNormal, null);
  push("수행 결과", "확인필요", statEX.totalAbnormalWorkEndedCount ?? null, aggAbnormal, null);

  // 4. 확인필요 세부 (통계 vs 필터, currentCommuteStatus=퇴근)
  const detailDefs: [string, string, string][] = [
    ["근무계획미수행", "notExecutedCount", "근무계획미수행"],
    ["지각", "lateCount", "지각"],
    ["임의퇴근", "unauthorizedEarlyEndCount", "임의퇴근"],
    ["이상출근", "checkRequiredCount", "이상출근"],
    ["근무부족", "shortfallCount", "근무부족"],
    ["지각,임의퇴근", "lateAndUnauthorizedEarlyEndCount", "지각_임의퇴근"],
    ["임의퇴근,근무부족", "ueeShortfallCount", "임의퇴근_근무부족"],
    ["지각,근무부족", "lateAndShortfallCount", "지각_근무부족"],
  ];
  const detail: Record<string, number> = {};
  for (const [label, statKey, filterValue] of detailDefs) {
    const statVal = statEX[statKey] ?? 0;
    detail[label] = statVal;
    const filterVal = await filteredTotal("executionResultType", filterValue, { currentCommuteStatus: "퇴근" });
    push("확인필요 세부", label, statVal, null, filterVal);
  }

  const passed = checks.filter((c) => c.pass).length;
  emit(true, `검증 완료: ${passed}/${checks.length} PASS`);
  return {
    ok: true,
    summary: { total: checks.length, passed, failed: checks.length - passed },
    charts: {
      workType: { dayOn: statWT.dayOnCount ?? 0, partDayOn: statWT.partDayOnCount ?? 0, dayOff: statWT.dayOffCount ?? 0 },
      commute: { preregistered: statCS.preregisteredCount ?? 0, normalStart: statCS.normalStartCount ?? 0, endWork: statCS.endWorkCount ?? 0 },
      exec: { normal: statEX.totalNormalWorkEndedCount ?? 0, abnormal: statEX.totalAbnormalWorkEndedCount ?? 0, detail },
    },
    listTotal,
    checks,
  };
}
