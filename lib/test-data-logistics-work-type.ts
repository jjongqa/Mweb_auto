/**
 * 테스트 데이터 — 컬리로 근무유형별 테스트  [컬리로/근무유형별 테스트]
 *
 * 원본: fulfillment_sqe_studio `pages/5_pilot_work_type_test.py` 포팅.
 *   근무유형 마스터(48종)별로 프리셋 계정(kurlyqa8801+idx)을 만들고, 그룹/쿼터에 따라
 *   예상 출퇴근 시각을 계산해 회원가입→상용직전환→근무계획→출근→퇴근까지 일괄/개별 실행.
 *
 * 흐름(계정당): signup → mobile_login → convert_to_contract(admin) →
 *   POST /v1/work-plans(admin) → (근무인정 계정만) qa/v1/commute/start-contract → end-with-over-work
 *   ※ qa/v1/commute/* 는 인증 헤더 없음(QA 전용).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { signup, mobileLogin, adminLogin, convertToContract } from "./test-data-logistics-kurlyro";

const INT = process.env.KURLYRO_INT || "https://kurlyro-int-qa.dev.kurly.services";
const DEFAULT_PASSWORD = "kurly12@";
const CLUSTER = "CC02", CENTER = "GGH1", WORK_PART = "IB", WORK_SHIFT = "08:00 ~ 17:00";
const SHIFT_START = 8 * 60;   // 480
const SHIFT_END = 17 * 60;    // 1020

const ADMIN_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  origin: "https://kurlyro-admin-qa.dev.kurlycorp.kr",
  referer: "https://kurlyro-admin-qa.dev.kurlycorp.kr/",
  "user-agent": "Mozilla/5.0",
  "Restrict-Access-Api": "PASS",
  "Want-Cluster-Response": CLUSTER,
  "X-Forwarded-For": "127.0.0.1",
};

// 복합형 컴포넌트별 적용시간 (퍼플/반차=4h, 반반차=2h)
const COMPOSITE_LEAVE: Record<string, { am: number; pm: number }> = {
  "오전퍼플/오후반반차": { am: 4, pm: 2 },
  "오전반반차/오후반차": { am: 2, pm: 4 },
  "오전반차/오후반반차": { am: 4, pm: 2 },
  "오전반반차/오후퍼플": { am: 2, pm: 4 },
  "반반/반반": { am: 2, pm: 2 },
  "반반/생일": { am: 2, pm: 2 },
};

interface MasterRow { name: string; koreanCode: string; group: string; workOk: boolean; workHours: number; breakMins: number; q1: boolean; q2: boolean; q3: boolean; q4: boolean }
export interface WorkTypeAccount {
  idx: number; username: string; name: string; phone: string; empNum: string;
  workType: string; workTypeCode: string; group: string; workOk: boolean;
  workHours: number; breakMins: number;
  expStart: string | null; expEnd: string | null; expStartSec: string | null; expEndSec: string | null;
}

function minsToTime(m: number | null): string | null {
  if (m === null) return null;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// 원본 calc_expected_times 포팅
function calcExpected(m: MasterRow): [number | null, number | null] {
  if (m.group === "휴무형") return [null, null];
  const total = m.workHours * 60 + m.breakMins;
  if (m.group === "전일 근무형") return [SHIFT_START, SHIFT_END];
  if (m.group === "부분 근무형") {
    const comp = COMPOSITE_LEAVE[m.name];
    if (comp) {
      const am = comp.am, pm = comp.pm;
      if (m.q2 && m.q3) return [SHIFT_START + am * 60, SHIFT_END - pm * 60];
      if (m.q3 && !m.q2) { const e = SHIFT_END - pm * 60; return [e - total, e]; }
      if (m.q2 && !m.q3) { const s = SHIFT_START + am * 60; return [s, s + total]; }
    } else {
      if (!m.q1 && m.q4) return [SHIFT_END - total, SHIFT_END];
      if (m.q1 && !m.q4) return [SHIFT_START, SHIFT_START + total];
      if (m.q1 && m.q4) return [SHIFT_START, SHIFT_END];
    }
  }
  return [null, null];
}

let _accounts: WorkTypeAccount[] | null = null;
export function loadWorkTypeAccounts(): WorkTypeAccount[] {
  if (_accounts) return _accounts;
  const master: MasterRow[] = JSON.parse(readFileSync(join(process.cwd(), "lib", "logistics-data", "work-type-master.json"), "utf-8"));
  _accounts = master.map((m, idx) => {
    const [s, e] = calcExpected(m);
    const accountNum = 8801 + idx;
    return {
      idx, username: `kurlyqa${accountNum}`, name: m.name, phone: `010${String(accountNum).padStart(4, "0")}0001`, empNum: `mk${accountNum}`,
      workType: m.name, workTypeCode: m.koreanCode, group: m.group, workOk: m.workOk,
      workHours: m.workHours, breakMins: m.breakMins,
      expStart: minsToTime(s), expEnd: minsToTime(e),
      expStartSec: s !== null ? `${minsToTime(s)}:00` : null, expEndSec: e !== null ? `${minsToTime(e)}:00` : null,
    };
  });
  return _accounts;
}

export interface WorkTypeRunInput {
  adminId: string; adminPw: string;
  scope: "workOk" | "all";   // 근무인정만(22) / 전체(48)
  workDate: string;          // YYYY-MM-DD
  includeStart: boolean;
  includeEnd: boolean;
  usernames?: string[];      // 지정 시 해당 계정만(개별 실행). 비우면 scope 기준.
}
export interface WorkTypeResult {
  index: number; username: string; workType: string;
  signup: string; login: string; convert: string; plan: string; start: string; end: string;
  ok: boolean;
}
export interface WorkTypeProgress { type: "acct"; index: number; ok: boolean; message: string }

const ok2 = (s: number) => s === 200 || s === 201;

async function createWorkPlan(adminToken: string, username: string, workTypeCode: string, workDate: string): Promise<number> {
  const res = await fetch(`${INT}/v1/work-plans`, {
    method: "POST", headers: { ...ADMIN_HEADERS, Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ laborUsername: username, workType: workTypeCode, workDate, workShift: WORK_SHIFT }),
  });
  return res.status;
}
async function startContract(username: string, workDate: string, startTime: string): Promise<number> {
  const res = await fetch(`${INT}/qa/v1/commute/start-contract`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, workDate, startTime }) });
  return res.status;
}
async function endWithOverWork(username: string, workDate: string, endTime: string, overtimeMins = 0): Promise<number> {
  const res = await fetch(`${INT}/qa/v1/commute/end-with-over-work`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, workDate, endTime, overtimeMins }) });
  return res.status;
}

/** 일괄 실행: scope에 따라 계정 생성+근무계획+출퇴근. */
export async function runWorkTypeBatch(input: WorkTypeRunInput, onProgress?: (e: WorkTypeProgress) => void): Promise<{ okCount: number; total: number; results: WorkTypeResult[]; error?: string }> {
  const emit = (index: number, ok: boolean, message: string) => onProgress?.({ type: "acct", index, ok, message });
  const a = await adminLogin(input.adminId, input.adminPw);
  if (!a.ok || !a.adminToken) { emit(0, false, `어드민 로그인 실패: ${a.msg}`); return { okCount: 0, total: 0, results: [], error: a.msg }; }
  emit(0, true, "✅ 어드민 로그인");
  const adminToken = a.adminToken;

  const all = loadWorkTypeAccounts();
  const targets = input.usernames?.length
    ? all.filter((x) => input.usernames!.includes(x.username))
    : input.scope === "workOk" ? all.filter((x) => x.workOk) : all;
  emit(0, true, `대상 ${targets.length}개 (${input.usernames?.length ? "개별 선택" : input.scope === "workOk" ? "근무인정만" : "전체"}) · 근무일 ${input.workDate}`);

  const results: WorkTypeResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    const acc = targets[i];
    const r: WorkTypeResult = { index: i + 1, username: acc.username, workType: acc.workType, signup: "-", login: "-", convert: "-", plan: "-", start: "-", end: "-", ok: false };

    const su = await signup(acc.username, DEFAULT_PASSWORD, acc.name, acc.phone);
    r.signup = su.ok ? "OK" : "SKIP";  // 이미 있으면 SKIP 취급
    const lg = await mobileLogin(acc.username, DEFAULT_PASSWORD);
    if (!lg.ok || !lg.laborAccountId) { r.login = "FAIL"; results.push(r); emit(i + 1, false, `[#${i + 1}] ${acc.username} 로그인 실패`); continue; }
    r.login = "OK";
    const cv = await convertToContract(adminToken, lg.laborAccountId, acc.empNum, CLUSTER, CENTER, WORK_PART);
    r.convert = cv.ok ? "OK" : "SKIP";
    const planStatus = await createWorkPlan(adminToken, acc.username, acc.workTypeCode, input.workDate);
    r.plan = ok2(planStatus) ? "OK" : `FAIL(${planStatus})`;

    if (acc.workOk && acc.expStartSec) {
      if (input.includeStart) { const s = await startContract(acc.username, input.workDate, acc.expStartSec); r.start = ok2(s) ? `OK(${acc.expStart})` : `FAIL(${s})`; }
      else r.start = "미실행";
      if (input.includeEnd && acc.expEndSec) { const e = await endWithOverWork(acc.username, input.workDate, acc.expEndSec, 0); r.end = ok2(e) ? `OK(${acc.expEnd})` : `FAIL(${e})`; }
      else r.end = "미실행";
    } else { r.start = acc.workOk ? "미실행" : "-"; r.end = acc.workOk ? "미실행" : "-"; }

    r.ok = r.login === "OK" && r.plan === "OK" && !r.start.startsWith("FAIL") && !r.end.startsWith("FAIL");
    results.push(r);
    emit(i + 1, r.ok, `[#${i + 1}] ${acc.username} (${acc.workType}) · 계획 ${r.plan}${acc.workOk ? ` · 출근 ${r.start} · 퇴근 ${r.end}` : ""}`);
  }
  const okCount = results.filter((x) => x.ok).length;
  return { okCount, total: targets.length, results };
}

/** 수동 출퇴근 (단건). action='start'|'end'. */
export async function manualCommute(action: "start" | "end", username: string, workDate: string, time: string, overtimeMins = 0): Promise<{ ok: boolean; status: number }> {
  const status = action === "start" ? await startContract(username, workDate, time) : await endWithOverWork(username, workDate, time, overtimeMins);
  return { ok: ok2(status), status };
}

// ── 어드민 리스트 조회 (work-schedules) ──
export interface AdminScheduleRow {
  username: string; laborName: string; workType: string; commuteStatus: string;
  workShift: string; workStartedAt: string; workEndedAt: string; lateTime: number; needCheck: boolean;
}
async function fetchSchedules(adminToken: string, startDate: string, endDate: string): Promise<{ total: number; content: any[] }> {
  const params = new URLSearchParams({ page: "1", size: "500", cluster: CLUSTER, center: CENTER, searchWords: "", startWorkDate: startDate, endWorkDate: endDate, searchOnlyChanged: "false", workTypes: "" });
  const res = await fetch(`${INT}/v1/work-schedules?${params}`, { headers: { ...ADMIN_HEADERS, Authorization: `Bearer ${adminToken}` } });
  if (!ok2(res.status)) return { total: 0, content: [] };
  const d = (await res.json().catch(() => ({})))?.data || {};
  return { total: d.total || 0, content: d.content || [] };
}
export async function adminListSchedules(adminId: string, adminPw: string, workDate: string): Promise<{ ok: boolean; total: number; rows: AdminScheduleRow[]; error?: string }> {
  const a = await adminLogin(adminId, adminPw);
  if (!a.ok || !a.adminToken) return { ok: false, total: 0, rows: [], error: a.msg };
  const { total, content } = await fetchSchedules(a.adminToken, workDate, workDate);
  const rows: AdminScheduleRow[] = content.map((it) => ({
    username: it.username || "-", laborName: it.laborName || "-",
    workType: it?.workType?.text || "-", commuteStatus: it?.commuteStatus?.text || "-",
    workShift: it?.workShift?.formattedText || "-", workStartedAt: it.workStartedAt || "-", workEndedAt: it.workEndedAt || "-",
    lateTime: it.lateTime || 0, needCheck: !!it.needCheckExecutionResult,
  }));
  return { ok: true, total, rows };
}

// ── 모바일 vs 어드민 교차 검증 ──
export interface VerifyRow {
  username: string; workType: string; date: string; status: string;
  typeMatch: string; startMatch: string; endMatch: string; lateMatch: string; result: "PASS" | "FAIL"; detail: string;
}
export interface VerifyProgress { type: "verify"; index: number; ok: boolean; message: string }

function hhmm(v: any): string { const s = String(v ?? "-"); return s.includes("T") ? s.split("T")[1].slice(0, 5) : s; }

async function verifyOneAccount(username: string, month: string, adminToken: string): Promise<{ rows: VerifyRow[]; error?: string }> {
  const lg = await mobileLogin(username, DEFAULT_PASSWORD);
  if (!lg.ok || !lg.workerToken) return { rows: [], error: `${username} 로그인 실패` };
  // 모바일 월간 타임라인
  const tlRes = await fetch(`${process.env.KURLYRO_EXT || "https://kurlyro-ext-qa.dev.kurly.com"}/v1/monthly-timeline?yearMonth=${month}`, { headers: { accept: "application/json", Authorization: `Bearer ${lg.workerToken}` } });
  const timelines: any[] = tlRes.status === 200 ? ((await tlRes.json().catch(() => ({})))?.data?.dailyTimelines || []) : [];
  // 어드민 월간
  const [y, mo] = month.split("-");
  const ld = new Date(Number(y), Number(mo), 0).getDate();
  const { content } = await fetchSchedules(adminToken, `${month}-01`, `${month}-${String(ld).padStart(2, "0")}`);
  const adminByDate: Record<string, any> = {};
  for (const it of content) if (it.username === username) adminByDate[it.workDate || ""] = it;

  const dates = Array.from(new Set([...timelines.map((t) => t.workday), ...Object.keys(adminByDate)])).filter(Boolean).sort();
  const acc = loadWorkTypeAccounts().find((a) => a.username === username);
  const wtLabel = acc?.workType || "-";
  const rows: VerifyRow[] = [];
  for (const d of dates) {
    const mob = timelines.find((t) => t.workday === d);
    const adm = adminByDate[d];
    const mWt = mob?.workType?.text || "-";
    const mLate = mob ? (mob.lateMinutes ?? "-") : "-";
    let mS = "-", mE = "-";
    if (mob) for (const ev of mob.workdayTimeline || []) {
      if (ev?.type?.code === "START_WORK") mS = hhmm(ev.data?.startWorkAt);
      else if (ev?.type?.code === "END_WORK") mE = hhmm(ev.data?.endWorkAt);
    }
    const aWt = adm?.workType?.text || "-", aSt = adm?.commuteStatus?.text || "-";
    const aS = adm?.workStartedAt || "-", aE = adm?.workEndedAt || "-", aL = adm?.lateTime ?? "-";
    const tm = mWt !== "-" && aWt !== "-" ? mWt === aWt : null;
    const sm = mS !== "-" && aS !== "-" ? mS === aS : null;
    const em = mE !== "-" && aE !== "-" ? mE === aE : null;
    const lm = String(mLate) !== "-" && String(aL) !== "-" ? String(mLate) === String(aL) : null;
    const ok = [tm, sm, em, lm].filter((v) => v !== null).every((v) => v !== false);
    const fails: string[] = [];
    ([["근무유형", tm, mWt, aWt], ["출근", sm, mS, aS], ["퇴근", em, mE, aE], ["지각", lm, mLate, aL]] as [string, boolean | null, any, any][])
      .forEach(([lb, mc, mv, av]) => { if (mc === false) fails.push(`${lb}: 모바일(${mv})!=어드민(${av})`); });
    const mark = (v: boolean | null) => (v ? "✅" : v === false ? "❌" : "-");
    rows.push({ username, workType: wtLabel, date: d, status: aSt, typeMatch: mark(tm), startMatch: mark(sm), endMatch: mark(em), lateMatch: mark(lm), result: ok ? "PASS" : "FAIL", detail: fails.length ? fails.join(" / ") : "일치" });
  }
  return { rows };
}

export async function verifyAccounts(adminId: string, adminPw: string, usernames: string[], month: string, onProgress?: (e: VerifyProgress) => void): Promise<{ ok: boolean; rows: VerifyRow[]; passed: number; total: number; error?: string }> {
  const a = await adminLogin(adminId, adminPw);
  if (!a.ok || !a.adminToken) return { ok: false, rows: [], passed: 0, total: 0, error: a.msg };
  const rows: VerifyRow[] = [];
  for (let i = 0; i < usernames.length; i++) {
    const r = await verifyOneAccount(usernames[i], month, a.adminToken);
    if (r.error) { onProgress?.({ type: "verify", index: i + 1, ok: false, message: `[#${i + 1}] ${r.error}` }); continue; }
    rows.push(...r.rows);
    onProgress?.({ type: "verify", index: i + 1, ok: true, message: `[#${i + 1}] ${usernames[i]} · ${r.rows.length}일 검증` });
  }
  const passed = rows.filter((r) => r.result === "PASS").length;
  return { ok: true, rows, passed, total: rows.length };
}

// ── 커스텀 시나리오 (1~5단계 선택 실행) ──
export interface CustomInput {
  adminId: string; adminPw: string;
  username: string; name: string; phone: string; empNum: string;
  workTypeName: string;   // 마스터 name
  shift: string;          // "08:00 ~ 17:00"
  startTime: string; endTime: string; overtimeMins?: number;
  workDate: string; month: string;
  startStep: number; endStep: number;  // 1~5
}
export interface CustomProgress { type: "step"; ok: boolean; level: "info" | "ok" | "err"; message: string }

export async function runCustom(input: CustomInput, onProgress?: (e: CustomProgress) => void): Promise<{ ok: boolean; error?: string; adminRows?: AdminScheduleRow[]; verifyRows?: VerifyRow[] }> {
  const emit = (level: CustomProgress["level"], message: string) => onProgress?.({ type: "step", ok: level !== "err", level, message });
  const master = JSON.parse(readFileSync(join(process.cwd(), "lib", "logistics-data", "work-type-master.json"), "utf-8")) as MasterRow[];
  const wt = master.find((m) => m.name === input.workTypeName);
  if (!wt) return { ok: false, error: `근무유형 없음: ${input.workTypeName}` };
  const inRange = (n: number) => input.startStep <= n && n <= input.endStep;
  let adminToken: string | undefined;
  const ensureAdmin = async (): Promise<boolean> => {
    if (adminToken) return true;
    const a = await adminLogin(input.adminId, input.adminPw);
    if (a.ok && a.adminToken) { adminToken = a.adminToken; return true; }
    emit("err", `어드민 로그인 실패: ${a.msg}`); return false;
  };
  let adminRows: AdminScheduleRow[] | undefined, verifyRows: VerifyRow[] | undefined;

  try {
    if (inRange(1)) {
      emit("info", "1. 계정생성 (회원가입+상용직전환)");
      if (!(await ensureAdmin())) return { ok: false, error: "어드민 로그인 실패" };
      const su = await signup(input.username, DEFAULT_PASSWORD, input.name, input.phone);
      emit(su.ok ? "ok" : "err", `회원가입: ${su.msg}`);
      const lg = await mobileLogin(input.username, DEFAULT_PASSWORD);
      if (!lg.ok || !lg.laborAccountId) { emit("err", `로그인 실패: ${lg.msg}`); return { ok: false, error: "모바일 로그인 실패" }; }
      emit("ok", `로그인 (laborAccountId ${lg.laborAccountId})`);
      const cv = await convertToContract(adminToken!, lg.laborAccountId, input.empNum, CLUSTER, CENTER, WORK_PART);
      emit(cv.ok ? "ok" : "err", `상용직 전환: ${cv.msg}`);
    }
    if (inRange(2)) {
      emit("info", "2. 근무계획 생성");
      if (!(await ensureAdmin())) return { ok: false, error: "어드민 로그인 실패" };
      const res = await fetch(`${INT}/v1/work-plans`, { method: "POST", headers: { ...ADMIN_HEADERS, Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ laborUsername: input.username, workType: wt.koreanCode, workDate: input.workDate, workShift: input.shift }) });
      emit(ok2(res.status) ? "ok" : "err", `근무계획: HTTP ${res.status}`);
    }
    if (inRange(3)) {
      if (!wt.workOk) emit("info", "3. 출퇴근 — 휴무형은 처리 불가");
      else if (input.startTime && input.endTime) {
        emit("info", "3. 출퇴근 처리");
        const s = await startContract(input.username, input.workDate, input.startTime);
        emit(ok2(s) ? "ok" : "err", `출근(${input.startTime}): HTTP ${s}`);
        const e = await endWithOverWork(input.username, input.workDate, input.endTime, input.overtimeMins || 0);
        emit(ok2(e) ? "ok" : "err", `퇴근(${input.endTime}): HTTP ${e}`);
      }
    }
    if (inRange(4)) {
      emit("info", "4. 어드민 조회");
      if (!(await ensureAdmin())) return { ok: false, error: "어드민 로그인 실패" };
      const { content } = await fetchSchedules(adminToken!, input.workDate, input.workDate);
      adminRows = content.filter((it) => it.username === input.username).map((it) => ({
        username: it.username || "-", laborName: it.laborName || "-", workType: it?.workType?.text || "-", commuteStatus: it?.commuteStatus?.text || "-",
        workShift: it?.workShift?.formattedText || "-", workStartedAt: it.workStartedAt || "-", workEndedAt: it.workEndedAt || "-", lateTime: it.lateTime || 0, needCheck: !!it.needCheckExecutionResult,
      }));
      emit("ok", `어드민 조회 ${adminRows.length}건`);
    }
    if (inRange(5)) {
      emit("info", "5. 모바일-어드민 검증");
      if (!(await ensureAdmin())) return { ok: false, error: "어드민 로그인 실패" };
      const r = await verifyOneAccount(input.username, input.month, adminToken!);
      verifyRows = r.rows;
      emit(r.error ? "err" : "ok", r.error || `검증 ${r.rows.length}일 (PASS ${r.rows.filter((x) => x.result === "PASS").length})`);
    }
    return { ok: true, adminRows, verifyRows };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit("err", `오류: ${msg}`);
    return { ok: false, error: msg, adminRows, verifyRows };
  }
}
