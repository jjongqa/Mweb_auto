/**
 * 테스트 데이터 — 컬리로(Kurlyro) 작업자 생명주기  [컬리로]
 *
 * 원본: fulfillment_sqe_studio `src/test_kurlyworks/kurlyro_api.py` + 3_kurlyro_api.py 연속실행 포팅.
 *   순수 HTTP API (내부망). Selenium 마스터세팅(kurlyworks_setup)은 범위 제외 — 마스터 근무시간대/계약문서는 사전 세팅 가정.
 *
 * 두 시나리오 (시작~종료 단계 선택 가능):
 *   • 상용직 8단계: 회원가입→상용직전환→근무계획→출근→체크인→체크아웃→퇴근→회원탈퇴
 *   • 아르바이트 10단계: 회원가입→개인정보→관리자작업인증→근무등록→근로계약(5)→출근→안전교육→체크인→체크아웃→탈퇴
 *
 * 토큰: 작업자(mobile_login, EXT) / 어드민(admin_login, INT) / privacy(탈퇴 시).
 * 호스트는 env 오버라이드 가능.
 */

import { readFileSync } from "fs";
import { join } from "path";

const EXT = process.env.KURLYRO_EXT || "https://kurlyro-ext-qa.dev.kurly.com";
const INT = process.env.KURLYRO_INT || "https://kurlyro-int-qa.dev.kurly.services";

const BASE_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  origin: "https://kurlyro-admin-qa.dev.kurlycorp.kr",
  referer: "https://kurlyro-admin-qa.dev.kurlycorp.kr/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Restrict-Access-Api": "PASS",
  "Want-Cluster-Response": "CC02",
  "X-Forwarded-For": "127.0.0.1",
};

const DEFAULT_PERSONAL_INFO = {
  juminNo: "0012313234567", postCode: "06133", address: "서울 강남구 테헤란로 133",
  detailAddress: "14층", financialInstitution: "123", accountNo: "2601065678900",
};
const DEFAULT_CONTRACT_INFO = {
  cluster: "CC02", center: "GGH1", workPart: "IB", teamName: "풀필먼트SQE",
  workStartTime: "06:00", workEndTime: "20:00", masterContractSeq: 472, masterContractVersionSeq: 754,
  availableContractStartTime: "06:00:00", availableContractEndTime: "20:00:00",
};
// 서명 PNG (data URI, PIL 미사용 폴백 — 원본 SIGN_PNG_DATA_URI)
const SIGN_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKgAAACFCAYAAADPebNcAAAA" +
  "AXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAFxEAABcRAcom8z8AAD49SURB" +
  "VHhe7X0FeBRn1zbt25YWdy1anCJFi7tDcHeKe2mx4u7FIbi7Q3B39zhESYCQbNztfOc+M5Ns" +
  "NpsA79/+2fDuzfVcZGZnZ3Zn7jn2nHOeNN1+nkXmYR6mOtJ0LzeL2hb+i1oXmGQe5mEyo0" +
  "PxadS93GxK06nENDqw6grdOPncPMzDZMbikfuobZEplKZd0Snk7vCezDDDlHDE8ga1yDuB0r" +
  "T/aQrZP3ZTd5thhmlg34rL1DLfRDNBzTBNmAlqhknDTFAzTBpmgpph0jAT1AyThpmgZpg0zA" +
  "Q1w6RhJqgZJo3/B7FPijCVLF6TAAAAAElFTkSuQmCC";

const ADMIN_LOGIN_ID = process.env.KURLYRO_ADMIN_ID || "autoqa99";
const ADMIN_LOGIN_PW = process.env.KURLYRO_ADMIN_PW || "kurly12@";

export type ProcessCode = "picking" | "packing" | "shipping";
export interface KurlyroAccount {
  username: string;
  password: string;
  name: string;
  phone: string;
  cluster: string;
  center: string;
  workPart: string;          // IB/OB/QC/IM
  empNum?: string;           // 상용직 사번 (미지정 시 mk00+username 끝4)
  processCode?: ProcessCode; // 체크인 공정
  processName?: string;      // 피킹/패킹/출하
  overWork?: "WISHED" | "NOT_WISHED";
}

export type Scenario = "contract" | "arbeit";
export interface KurlyroProgressEvent { type: "step"; ok: boolean; level: "info" | "ok" | "err"; message: string }
export interface KurlyroRunResult { ok: boolean; doneSteps: number; totalSteps: number; failedStep?: string; error?: string }

interface ApiOut { ok: boolean; msg: string; [k: string]: unknown }

const authH = (token: string, extra?: Record<string, string>) => ({ ...BASE_HEADERS, Authorization: `Bearer ${token}`, ...extra });
async function asJson(res: Response): Promise<any> { return res.json().catch(() => ({})); }
const ok2 = (s: number) => s === 200 || s === 201;
const ok3 = (s: number) => s === 200 || s === 201 || s === 204;

// ── 인증 ──────────────────────────────────────────────
export async function mobileLogin(username: string, password: string): Promise<ApiOut & { laborAccountId?: string; workerToken?: string }> {
  try {
    let res = await fetch(`${EXT}/v1/labor-accounts/login`, { method: "POST", headers: BASE_HEADERS, body: JSON.stringify({ username, password }) });
    if (!ok2(res.status)) {
      res = await fetch(`${EXT}/v2/labor-account/login`, { method: "POST", headers: BASE_HEADERS, body: JSON.stringify({ loginId: username, password, keepLogin: true }) });
    }
    if (!ok2(res.status)) return { ok: false, msg: `모바일 로그인 실패 (${username})` };
    const d = await asJson(res);
    const laborAccountId = d?.data?.laborAccountId ?? d?.laborAccountId ?? d?.data?.id;
    const workerToken = d?.data?.accessToken ?? d?.accessToken ?? d?.data?.token;
    return { ok: true, msg: `모바일 로그인 완료: ${username}`, laborAccountId: laborAccountId != null ? String(laborAccountId) : undefined, workerToken };
  } catch (e) { return { ok: false, msg: `모바일 로그인 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

export async function adminLogin(loginId: string = ADMIN_LOGIN_ID, password: string = ADMIN_LOGIN_PW): Promise<ApiOut & { adminToken?: string }> {
  try {
    const res = await fetch(`${INT}/v1/admin-accounts/login`, { method: "POST", headers: BASE_HEADERS, body: JSON.stringify({ loginId, password }) });
    if (!ok2(res.status)) return { ok: false, msg: `어드민 로그인 실패 (HTTP ${res.status})` };
    const d = await asJson(res);
    return { ok: true, msg: "어드민 로그인 완료", adminToken: d?.data?.accessToken ?? d?.accessToken ?? d?.data?.token };
  } catch (e) { return { ok: false, msg: `어드민 로그인 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

// ── 계정 ──────────────────────────────────────────────
export async function signup(username: string, password: string, name: string, phone: string): Promise<ApiOut> {
  try {
    const v = await fetch(`${EXT}/v1/labor-accounts/phone-verification/for-sign-up`, { method: "POST", headers: BASE_HEADERS, body: JSON.stringify({ phoneNumber: phone }) });
    if (!ok3(v.status)) return { ok: false, msg: `휴대폰 인증 요청 실패 (HTTP ${v.status})` };
    const res = await fetch(`${EXT}/v1/labor-accounts`, { method: "POST", headers: BASE_HEADERS, body: JSON.stringify({ username, password, name, phoneNumber: phone, verificationCode: "111111", allowRecruit: true, allowNightTime: true }) });
    if (ok2(res.status)) return { ok: true, msg: `회원가입 완료: ${username}` };
    return { ok: false, msg: `회원가입 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `회원가입 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

async function deleteAccount(workerToken: string, username: string, password: string): Promise<ApiOut> {
  try {
    const check = await fetch(`${EXT}/v1/labor-accounts/check-password`, { method: "POST", headers: authH(workerToken), body: JSON.stringify({ username, password }) });
    if (!ok2(check.status)) return { ok: false, msg: `비밀번호 확인 실패 (${username})` };
    const privacyToken = (await asJson(check))?.data?.kurlyPrivacyPassToken;
    const del = await fetch(`${EXT}/v1/labor-account`, {
      method: "DELETE",
      headers: authH(workerToken, { checkpasstoken: "true", kurlyroprivacypasstoken: String(privacyToken ?? "") }),
      body: JSON.stringify({ loginId: username, password, headers: { checkPassToken: true } }),
    });
    if (ok3(del.status)) return { ok: true, msg: `회원탈퇴 완료: ${username}` };
    return { ok: false, msg: `회원탈퇴 실패 (HTTP ${del.status})` };
  } catch (e) { return { ok: false, msg: `회원탈퇴 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

// ── 상용직 ────────────────────────────────────────────
export async function convertToContract(adminToken: string, laborAccountId: string, empNum: string, cluster: string, center: string, workPart: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${INT}/v1/labor-accounts/${laborAccountId}/contracts/convert-to-contract`, { method: "PUT", headers: authH(adminToken), body: JSON.stringify({ cluster, center, workPart, employeeNumber: empNum, specialMedicalExaminationTarget: true }) });
    return ok3(res.status) ? { ok: true, msg: `상용직 전환 완료 (사번: ${empNum})` } : { ok: false, msg: `상용직 전환 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `상용직 전환 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

function defaultShift(): string {
  const now = new Date();
  const startMin = Math.floor(now.getMinutes() / 30) * 30;
  const s = new Date(now); s.setMinutes(startMin, 0, 0);
  const e = new Date(s.getTime() + 30 * 60000);
  const f = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${f(s)} ~ ${f(e)}`;
}

async function createWorkPlan(adminToken: string, username: string): Promise<ApiOut & { workShift?: string }> {
  try {
    const workDate = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const workShift = defaultShift();
    const res = await fetch(`${INT}/v1/work-plans`, { method: "POST", headers: authH(adminToken), body: JSON.stringify({ laborUsername: username, workType: "근무", workDate, workShift }) });
    return ok2(res.status) ? { ok: true, msg: `근무계획 생성 완료 (${workShift})`, workShift } : { ok: false, msg: `근무계획 생성 실패 (HTTP ${res.status})`, workShift };
  } catch (e) { return { ok: false, msg: `근무계획 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

async function contractStart(workerToken: string, workShift: string, cluster: string, center: string, workPart: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/v1/commutes/contract-start`, { method: "POST", headers: authH(workerToken), body: JSON.stringify({ overWorkWishedStatus: "WISHED", cluster, center, workPart, workShift }) });
    return ok3(res.status) ? { ok: true, msg: `출근 처리 완료 (${workShift})` } : { ok: false, msg: `출근 처리 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `출근 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

async function checkin(workerToken: string, cluster: string, center: string, workPart: string, processCode: string, processName: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/v2/work-process/check`, { method: "POST", headers: authH(workerToken), body: JSON.stringify({ cluster, center, workPart, workProcessCode: processCode, workProcessDetailName: processName }) });
    return ok3(res.status) ? { ok: true, msg: `체크인 완료 (${processName})` } : { ok: false, msg: `체크인 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `체크인 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

async function checkout(workerToken: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/v1/check-out`, { method: "POST", headers: authH(workerToken) });
    return ok3(res.status) ? { ok: true, msg: "체크아웃 완료" } : { ok: false, msg: `체크아웃 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `체크아웃 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

async function endCommute(workerToken: string, laborAccountId: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/v1/commute/end-commute`, { method: "POST", headers: authH(workerToken), body: JSON.stringify({ laborAccountId: Number(laborAccountId) }) });
    return ok3(res.status) ? { ok: true, msg: "퇴근 처리 완료" } : { ok: false, msg: `퇴근 처리 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `퇴근 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

// ── 아르바이트 ────────────────────────────────────────
async function registerPersonalInfo(workerToken: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/qa/v1/labor-account/privacy-info`, { method: "PUT", headers: authH(workerToken), body: JSON.stringify(DEFAULT_PERSONAL_INFO) });
    return ok3(res.status) ? { ok: true, msg: "개인정보 등록 완료" } : { ok: false, msg: `개인정보 등록 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `개인정보 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

async function adminCertifyLabor(adminToken: string, laborAccountId: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${INT}/v1/labor-accounts/${laborAccountId}/skip-certification`, { method: "PUT", headers: authH(adminToken), body: JSON.stringify({}) });
    return ok3(res.status) ? { ok: true, msg: `관리자 작업인증 완료 (ID: ${laborAccountId})` } : { ok: false, msg: `관리자 작업인증 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `작업인증 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

async function registerLaborContract(workerToken: string, cluster: string, center: string, workPart: string): Promise<ApiOut> {
  try {
    const body = { ...DEFAULT_CONTRACT_INFO, cluster, center, workPart };
    const res = await fetch(`${EXT}/v2/labor/contract`, { method: "POST", headers: authH(workerToken), body: JSON.stringify(body) });
    return ok3(res.status) ? { ok: true, msg: "근무 등록 완료" } : { ok: false, msg: `근무 등록 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `근무 등록 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

async function agreeTerms(workerToken: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/v2/labor/agree-terms-and-conditions`, { method: "PUT", headers: authH(workerToken) });
    return ok3(res.status) ? { ok: true, msg: "유의사항 확인 (1/5)" } : { ok: false, msg: `유의사항 확인 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `유의사항 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function checkLaborContract(workerToken: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/v2/labor/contracts/check`, { method: "GET", headers: authH(workerToken) });
    return ok3(res.status) ? { ok: true, msg: "사전 점검 (2/5)" } : { ok: false, msg: `사전 점검 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `사전 점검 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function getContractTemplate(workerToken: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/v2/labor/contracts/preview`, { method: "GET", headers: authH(workerToken) });
    return ok3(res.status) ? { ok: true, msg: "양식 조회 (4/5)" } : { ok: false, msg: `양식 조회 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `양식 조회 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function signContract(workerToken: string): Promise<ApiOut> {
  try {
    const form = new FormData();
    // 원본: file 내용 = data URI 문자열 바이트, filename sign.png, type image/png
    form.append("file", new Blob([SIGN_PNG_DATA_URI], { type: "image/png" }), "sign.png");
    const res = await fetch(`${EXT}/v2/labor/contract/sign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerToken}`,
        accept: "application/json",
        origin: "https://kurlyro-qa.dev.kurly.com",
        referer: "https://kurlyro-qa.dev.kurly.com/",
        "user-agent": "7KhOEXkqa2aJltsE5G5C6gDtSwlcDeujfUeUSQ5j",
        "Restrict-Access-Api": "PASS",
      },
      body: form,
    });
    return ok3(res.status) ? { ok: true, msg: "계약서 서명 완료 (5/5)" } : { ok: false, msg: `서명 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `서명 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function shortStart(workerToken: string, overWork: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/v1/commutes/short-start`, { method: "POST", headers: authH(workerToken), body: JSON.stringify({ overWorkWishedStatus: overWork }) });
    return ok3(res.status) ? { ok: true, msg: `아르바이트 출근 완료 (연장: ${overWork})` } : { ok: false, msg: `아르바이트 출근 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `출근 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function completeSafetyEducation(adminToken: string, loginId: string, cluster: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${INT}/v1/safety-educations/newcomers/complete`, { method: "POST", headers: authH(adminToken), body: JSON.stringify({ cluster, laborLoginId: loginId }) });
    return ok3(res.status) ? { ok: true, msg: `신규 안전교육 완료: ${loginId}` } : { ok: false, msg: `안전교육 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `안전교육 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

// ── 관리(QA) ──────────────────────────────────────────
async function initPassword(adminToken: string, username: string): Promise<ApiOut> {
  try {
    const params = new URLSearchParams({ page: "1", size: "30", searchType: "LABOR_USERNAME", searchWords: username });
    const sres = await fetch(`${INT}/v1/labor-accounts?${params}`, { headers: authH(adminToken) });
    if (!ok2(sres.status)) return { ok: false, msg: `계정 조회 실패 (HTTP ${sres.status})` };
    const items = (await asJson(sres))?.data?.content || [];
    const id = items[0]?.laborAccountId ?? items[0]?.id;
    if (!id) return { ok: false, msg: `계정을 찾을 수 없음: ${username}` };
    const res = await fetch(`${INT}/v1/labor-account/${id}/init-password`, { method: "POST", headers: authH(adminToken), body: "{}" });
    return ok3(res.status) ? { ok: true, msg: `계정 초기화 완료: ${username}` } : { ok: false, msg: `계정 초기화 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `계정 초기화 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function changeSafetyEducationStatus(workerToken: string, loginId: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/qa/labor-account/change-safety-education-status`, { method: "PUT", headers: authH(workerToken), body: JSON.stringify({ loginId }) });
    return ok3(res.status) ? { ok: true, msg: `안전교육 갱신 필요 상태 변경: ${loginId}` } : { ok: false, msg: `안전교육 상태 변경 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `안전교육 상태 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function changePasswordDate(workerToken: string, loginId: string): Promise<ApiOut> {
  try {
    const res = await fetch(`${EXT}/qa/labor-account/password-date`, { method: "POST", headers: authH(workerToken), body: JSON.stringify({ loginId }) });
    return ok3(res.status) ? { ok: true, msg: `비밀번호 90일 경과 상태 변경: ${loginId}` } : { ok: false, msg: `비밀번호 상태 변경 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `비밀번호 상태 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

// ── 특수건강검진 ──────────────────────────────────────
function yearMonthKst(): string { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
function todayKst(): string { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
function healthImage(which: "1st" | "2nd"): Buffer {
  try { return readFileSync(join(process.cwd(), "lib", "logistics-data", "kurlyro-health", `health_check_${which}.png`)); }
  catch { return Buffer.from(SIGN_PNG_DATA_URI.split(",")[1], "base64"); }
}

async function addSpecialMedicalTarget(adminToken: string, laborAccountId: string, cluster: string): Promise<ApiOut> {
  try {
    const body = { specialMedicalExaminations: [{ laborAccountId: Number(laborAccountId), cluster, scheduledExaminationYearMonth: yearMonthKst(), type: "NEW" }] };
    const res = await fetch(`${INT}/v1/examinations/special-medicals/short/targets/labor-accounts`, { method: "POST", headers: authH(adminToken), body: JSON.stringify(body) });
    return ok2(res.status) ? { ok: true, msg: "대상자 추가 완료" } : { ok: false, msg: `대상자 추가 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `대상자 추가 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function registerSpecialMedical(adminToken: string, username: string, cluster: string): Promise<ApiOut> {
  try {
    const q = new URLSearchParams({ page: "1", size: "30", cluster, scheduledYearMonth: yearMonthKst(), searchType: "LABOR_USERNAME", searchWords: username, sortBy: "", sortDirection: "asc" });
    const sres = await fetch(`${INT}/v1/examinations/special-medicals/short/targets?${q}`, { headers: authH(adminToken) });
    if (!ok2(sres.status)) return { ok: false, msg: `대상자 조회 실패 (HTTP ${sres.status})` };
    const items = (await asJson(sres))?.data?.content || [];
    const examId = items[0]?.specialMedicalExaminationId ?? items[0]?.id;
    if (!examId) return { ok: false, msg: `대상자 조회 결과 없음: ${username}` };
    const res = await fetch(`${INT}/v1/examinations/special-medicals/short/register`, { method: "PUT", headers: authH(adminToken), body: JSON.stringify({ specialMedicalExaminationIds: [examId] }) });
    return ok2(res.status) ? { ok: true, msg: `등록처리 완료 (examId=${examId})` } : { ok: false, msg: `등록처리 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `등록처리 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function submitSpecialMedical(workerToken: string, examinationDate: string, second: boolean): Promise<ApiOut> {
  try {
    const url = second ? `${EXT}/v1/labor-accounts/examinations/special-medicals/second/submit` : `${EXT}/v1/labor-accounts/examinations/special-medicals/submit`;
    const img = healthImage(second ? "2nd" : "1st");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(img)], { type: "image/png" }), `health_check_${second ? "2nd" : "1st"}.png`);
    form.append("data", new Blob([JSON.stringify({ examinationDate })], { type: "application/json" }), "data.json");
    const res = await fetch(url, { method: "PATCH", headers: { Authorization: `Bearer ${workerToken}` }, body: form });
    return ok2(res.status) ? { ok: true, msg: `${second ? "2차" : "1차"} 검진 확인서 제출 완료` } : { ok: false, msg: `${second ? "2차" : "1차"} 제출 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `검진 제출 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
// 검진 examId 조회 (worker_type: short=아르바이트 / contract=상용직)
async function searchExam(adminToken: string, username: string, workerType: string, cluster: string, statuses: string): Promise<string | null> {
  const today = todayKst(), ym = yearMonthKst();
  const base = `${INT}/v1/examinations/special-medicals/${workerType}`;
  const url = workerType === "short"
    ? `${base}?page=1&size=30&cluster=${cluster}&scheduledYearMonth=${ym}&submissionDateFrom=${today}&submissionDateTo=${today}&statuses=${statuses}&searchType=LABOR_USERNAME&searchWords=${encodeURIComponent(username)}`
    : `${base}?page=1&size=30&cluster=${cluster}&registrationDateFrom=${today}&registrationDateTo=${today}&submissionDateFrom=${today}&submissionDateTo=${today}&statuses=${statuses}&searchType=LABOR_USERNAME&searchWords=${encodeURIComponent(username)}`;
  try {
    const res = await fetch(url, { headers: authH(adminToken) });
    if (!ok2(res.status)) return null;
    const items = (await asJson(res))?.data?.content || [];
    return items[0]?.specialMedicalExaminationId ?? items[0]?.id ?? null;
  } catch { return null; }
}
async function registerSpecialMedicalSecond(adminToken: string, username: string, workerType: string, cluster: string): Promise<ApiOut> {
  const examId = await searchExam(adminToken, username, workerType, cluster, "APPROVED");
  if (!examId) return { ok: false, msg: `승인 상태 검진 조회 실패 (${username})` };
  try {
    const res = await fetch(`${INT}/v1/examinations/special-medicals/${examId}/second/register`, { method: "POST", headers: authH(adminToken), body: "{}" });
    return ok3(res.status) ? { ok: true, msg: `2차 등록처리 완료 (examId=${examId})` } : { ok: false, msg: `2차 등록처리 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `2차 등록 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function rejectSpecialMedical(adminToken: string, username: string, reason: string, workerType: string, cluster: string, isSecond: boolean): Promise<ApiOut> {
  const statuses = isSecond ? "SECOND_APPROVAL_PENDED" : "APPROVAL_PENDED";
  const examId = await searchExam(adminToken, username, workerType, cluster, statuses);
  const label = isSecond ? "2차" : "1차";
  if (!examId) return { ok: false, msg: `${label} 검진 조회 실패 (${username})` };
  try {
    const url = isSecond ? `${INT}/v1/examinations/special-medicals/${examId}/second/reject` : `${INT}/v1/examinations/special-medicals/${examId}/reject`;
    const res = await fetch(url, { method: isSecond ? "POST" : "PATCH", headers: authH(adminToken), body: JSON.stringify({ rejectionReason: reason }) });
    return ok3(res.status) ? { ok: true, msg: `${label} 반려 완료 (examId=${examId})` } : { ok: false, msg: `${label} 반려 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `반려 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}
async function approveSpecialMedical(adminToken: string, username: string, workerType: string, cluster: string, isSecond: boolean): Promise<ApiOut> {
  const statuses = isSecond ? "SECOND_APPROVAL_PENDED" : "APPROVAL_PENDED";
  const examId = await searchExam(adminToken, username, workerType, cluster, statuses);
  const label = isSecond ? "2차" : "1차";
  if (!examId) return { ok: false, msg: `${label} 검진 조회 실패 (${username})` };
  try {
    const url = isSecond ? `${INT}/v1/examinations/special-medicals/${examId}/second/approve` : `${INT}/v1/examinations/special-medicals/${examId}/approve`;
    const res = await fetch(url, { method: isSecond ? "POST" : "PATCH", headers: authH(adminToken), ...(isSecond ? { body: "{}" } : {}) });
    return ok3(res.status) ? { ok: true, msg: `${label} 승인 완료 (examId=${examId})` } : { ok: false, msg: `${label} 승인 실패 (HTTP ${res.status})` };
  } catch (e) { return { ok: false, msg: `승인 오류: ${e instanceof Error ? e.message : String(e)}` }; }
}

// ── 단건 액션 디스패처 (기본API/아르바이트/관리/특수건강검진 탭) ──
export interface ActionInput {
  username: string; password: string; name?: string; phone?: string;
  cluster: string; center: string; workPart: string; empNum?: string;
  processCode?: ProcessCode; processName?: string; overWork?: "WISHED" | "NOT_WISHED";
  workShift?: string; examinationDate?: string; rejectionReason?: string; isSecond?: boolean;
  workerType?: "short" | "contract"; adminId?: string; adminPw?: string;
}
export interface ActionResult { ok: boolean; logs: string[] }

export async function runKurlyroAction(action: string, input: ActionInput): Promise<ActionResult> {
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);
  const empNum = input.empNum?.trim() || (input.username.length >= 4 ? `mk00${input.username.slice(-4)}` : "mk000000");
  const cluster = input.cluster || "CC02", center = input.center || "GGH1", workPart = input.workPart || "IB";
  const workerType = input.workerType || "short";

  // 토큰 헬퍼
  let _w: { workerToken?: string; laborAccountId?: string } | null = null;
  const worker = async (): Promise<{ workerToken?: string; laborAccountId?: string }> => {
    if (_w) return _w;
    const l = await mobileLogin(input.username, input.password);
    log(`모바일 로그인: ${l.msg}`);
    _w = { workerToken: l.workerToken, laborAccountId: l.laborAccountId };
    return _w;
  };
  let _a: string | undefined;
  const admin = async (): Promise<string | undefined> => {
    if (_a) return _a;
    const a = await adminLogin(input.adminId || undefined, input.adminPw || undefined);
    log(`어드민 로그인: ${a.msg}`);
    _a = a.adminToken; return _a;
  };
  const fin = (r: ApiOut): ActionResult => { log(r.msg); return { ok: r.ok, logs }; };
  const need = (v: any, m: string): boolean => { if (!v) { log(`❌ ${m}`); return false; } return true; };

  try {
    switch (action) {
      // 기본 API
      case "signup": return fin(await signup(input.username, input.password, input.name || "", input.phone || ""));
      case "convert": { const w = await worker(); const t = await admin(); if (!need(w.laborAccountId, "작업자 로그인 실패") || !need(t, "어드민 실패")) return { ok: false, logs }; return fin(await convertToContract(t!, w.laborAccountId!, empNum, cluster, center, workPart)); }
      case "workplan": { const t = await admin(); if (!need(t, "어드민 실패")) return { ok: false, logs }; const r = await createWorkPlan(t!, input.username); return fin(r); }
      case "contractStart": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await contractStart(w.workerToken!, input.workShift || defaultShift(), cluster, center, workPart)); }
      case "checkin": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await checkin(w.workerToken!, cluster, center, workPart, input.processCode || "picking", input.processName || "피킹")); }
      case "checkout": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await checkout(w.workerToken!)); }
      case "endCommute": { const w = await worker(); if (!need(w.workerToken && w.laborAccountId, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await endCommute(w.workerToken!, w.laborAccountId!)); }
      case "delete": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await deleteAccount(w.workerToken!, input.username, input.password)); }
      // 아르바이트
      case "personalInfo": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await registerPersonalInfo(w.workerToken!)); }
      case "certifyLabor": { const w = await worker(); const t = await admin(); if (!need(w.laborAccountId, "작업자 로그인 실패") || !need(t, "어드민 실패")) return { ok: false, logs }; return fin(await adminCertifyLabor(t!, w.laborAccountId!)); }
      case "registerContract": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await registerLaborContract(w.workerToken!, cluster, center, workPart)); }
      case "shortStart": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await shortStart(w.workerToken!, input.overWork || "WISHED")); }
      case "laborContract5": {
        const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs };
        const wt = w.workerToken!;
        for (const [name, fn] of [["유의사항", () => agreeTerms(wt)], ["사전점검", () => checkLaborContract(wt)], ["근로계약 등록", () => registerLaborContract(wt, cluster, center, workPart)], ["양식 조회", () => getContractTemplate(wt)], ["서명", () => signContract(wt)]] as [string, () => Promise<ApiOut>][]) {
          const r = await fn(); log(`${name}: ${r.msg}`); if (!r.ok) return { ok: false, logs };
        }
        return { ok: true, logs };
      }
      // 관리
      case "safetyComplete": { const t = await admin(); if (!need(t, "어드민 실패")) return { ok: false, logs }; return fin(await completeSafetyEducation(t!, input.username, cluster)); }
      case "safetyStatus": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await changeSafetyEducationStatus(w.workerToken!, input.username)); }
      case "passwordDate": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await changePasswordDate(w.workerToken!, input.username)); }
      case "initPassword": { const t = await admin(); if (!need(t, "어드민 실패")) return { ok: false, logs }; return fin(await initPassword(t!, input.username)); }
      // 특수건강검진
      case "smAddTarget": { const w = await worker(); const t = await admin(); if (!need(w.laborAccountId, "작업자 로그인 실패") || !need(t, "어드민 실패")) return { ok: false, logs }; return fin(await addSpecialMedicalTarget(t!, w.laborAccountId!, cluster)); }
      case "smRegister": { const t = await admin(); if (!need(t, "어드민 실패")) return { ok: false, logs }; return fin(await registerSpecialMedical(t!, input.username, cluster)); }
      case "smSubmit1": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await submitSpecialMedical(w.workerToken!, input.examinationDate || todayKst(), false)); }
      case "smSubmit2": { const w = await worker(); if (!need(w.workerToken, "작업자 로그인 실패")) return { ok: false, logs }; return fin(await submitSpecialMedical(w.workerToken!, input.examinationDate || todayKst(), true)); }
      case "smRegister2": { const t = await admin(); if (!need(t, "어드민 실패")) return { ok: false, logs }; return fin(await registerSpecialMedicalSecond(t!, input.username, workerType, cluster)); }
      case "smReject": { const t = await admin(); if (!need(t, "어드민 실패")) return { ok: false, logs }; return fin(await rejectSpecialMedical(t!, input.username, input.rejectionReason || "반려 처리", workerType, cluster, !!input.isSecond)); }
      case "smApprove": { const t = await admin(); if (!need(t, "어드민 실패")) return { ok: false, logs }; return fin(await approveSpecialMedical(t!, input.username, workerType, cluster, !!input.isSecond)); }
      default: log(`알 수 없는 액션: ${action}`); return { ok: false, logs };
    }
  } catch (e) {
    log(`오류: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, logs };
  }
}

// ── 오케스트레이터 ────────────────────────────────────
const empNumOf = (a: KurlyroAccount) => (a.empNum?.trim() || (a.username.length >= 4 ? `mk00${a.username.slice(-4)}` : "mk000000"));

export const CONTRACT_STEPS = ["회원가입", "상용직 전환", "근무계획 생성", "출근 처리", "체크인", "체크아웃", "퇴근 처리", "회원탈퇴"];
export const ARBEIT_STEPS = ["회원가입", "개인정보 등록", "관리자 작업인증", "근무 등록", "작업자 근로계약", "아르바이트 출근", "안전교육 진행", "체크인", "체크아웃", "회원탈퇴"];

export async function runKurlyro(scenario: Scenario, account: KurlyroAccount, startStep: number, endStep: number, onProgress?: (e: KurlyroProgressEvent) => void): Promise<KurlyroRunResult> {
  const emit = (level: KurlyroProgressEvent["level"], message: string) => onProgress?.({ type: "step", ok: level !== "err", level, message });
  const steps = scenario === "contract" ? CONTRACT_STEPS : ARBEIT_STEPS;
  const total = endStep - startStep + 1;
  let done = 0;
  let workerToken: string | undefined;
  let adminToken: string | undefined;
  let laborAccountId: string | undefined;
  let workShift: string | undefined;
  const inRange = (n: number) => startStep <= n && n <= endStep;
  const fin = (failedStep?: string) => ({ ok: !failedStep, doneSteps: done, totalSteps: total, failedStep });
  const step = async (n: number, label: string, fn: () => Promise<ApiOut>): Promise<boolean> => {
    emit("info", `━━━ Step ${n}. ${label} ━━━`);
    const r = await fn();
    emit(r.ok ? "ok" : "err", `Step ${n}. ${r.msg}`);
    if (r.ok) done++;
    return r.ok;
  };

  try {
    if (scenario === "contract") {
      // Step 1 회원가입
      if (inRange(1) && !(await step(1, "회원가입", () => signup(account.username, account.password, account.name, account.phone)))) return fin("회원가입");
      // 모바일 로그인 (Step2+)
      if (endStep >= 2) {
        const l = await mobileLogin(account.username, account.password);
        emit(l.ok ? "ok" : "err", `모바일 로그인: ${l.msg}`);
        if (!l.ok) return fin("모바일 로그인");
        workerToken = l.workerToken; laborAccountId = l.laborAccountId;
      }
      // 어드민 로그인 (Step2 or 3)
      if (inRange(2) || inRange(3)) {
        const a = await adminLogin();
        emit(a.ok ? "ok" : "err", `어드민 로그인: ${a.msg}`);
        if (!a.ok) return fin("어드민 로그인");
        adminToken = a.adminToken;
      }
      if (inRange(2) && !(await step(2, "상용직 전환", () => convertToContract(adminToken!, laborAccountId!, empNumOf(account), account.cluster, account.center, account.workPart)))) return fin("상용직 전환");
      if (inRange(3)) {
        emit("info", "━━━ Step 3. 근무계획 생성 ━━━");
        const r = await createWorkPlan(adminToken!, account.username);
        emit(r.ok ? "ok" : "err", `Step 3. ${r.msg}`);
        if (!r.ok) return fin("근무계획 생성");
        workShift = r.workShift; done++;
      }
      if (inRange(4)) {
        if (!workShift) workShift = defaultShift();
        if (!(await step(4, "출근 처리", () => contractStart(workerToken!, workShift!, account.cluster, account.center, account.workPart)))) return fin("출근 처리");
      }
      if (inRange(5) && !(await step(5, "체크인", () => checkin(workerToken!, account.cluster, account.center, account.workPart, account.processCode || "picking", account.processName || "피킹")))) return fin("체크인");
      if (inRange(6) && !(await step(6, "체크아웃", () => checkout(workerToken!)))) return fin("체크아웃");
      if (inRange(7) && !(await step(7, "퇴근 처리", () => endCommute(workerToken!, laborAccountId!)))) return fin("퇴근 처리");
      if (inRange(8)) {
        if (!workerToken) { const re = await mobileLogin(account.username, account.password); workerToken = re.workerToken; }
        if (!(await step(8, "회원탈퇴", () => deleteAccount(workerToken!, account.username, account.password)))) return fin("회원탈퇴");
      }
      return fin();
    }

    // ── 아르바이트 ──
    if (inRange(1) && !(await step(1, "회원가입", () => signup(account.username, account.password, account.name, account.phone)))) return fin("회원가입");
    if (endStep >= 2) {
      const l = await mobileLogin(account.username, account.password);
      emit(l.ok ? "ok" : "err", `모바일 로그인: ${l.msg}`);
      if (!l.ok) return fin("모바일 로그인");
      workerToken = l.workerToken; laborAccountId = l.laborAccountId;
    }
    if (inRange(2) && !(await step(2, "개인정보 등록", () => registerPersonalInfo(workerToken!)))) return fin("개인정보 등록");
    if (inRange(3)) {
      const a = await adminLogin();
      emit(a.ok ? "ok" : "err", `어드민 로그인: ${a.msg}`);
      if (!a.ok) return fin("어드민 로그인");
      adminToken = a.adminToken;
      if (!(await step(3, "관리자 작업인증", () => adminCertifyLabor(adminToken!, laborAccountId!)))) return fin("관리자 작업인증");
    }
    if (inRange(4) && !(await step(4, "근무 등록", () => registerLaborContract(workerToken!, account.cluster, account.center, account.workPart)))) return fin("근무 등록");
    if (inRange(5)) {
      emit("info", "━━━ Step 5. 작업자 근로계약 (5단계) ━━━");
      const subs: [string, () => Promise<ApiOut>][] = [
        ["유의사항 확인", () => agreeTerms(workerToken!)],
        ["사전 점검", () => checkLaborContract(workerToken!)],
        ["근로계약 등록", () => registerLaborContract(workerToken!, account.cluster, account.center, account.workPart)],
        ["양식 조회", () => getContractTemplate(workerToken!)],
        ["서명", () => signContract(workerToken!)],
      ];
      for (const [name, fn] of subs) {
        const r = await fn();
        emit(r.ok ? "ok" : "err", `  · ${name}: ${r.msg}`);
        if (!r.ok) return fin(`작업자 근로계약(${name})`);
      }
      done++;
    }
    if (inRange(6)) {
      const re = await mobileLogin(account.username, account.password);
      if (re.ok) workerToken = re.workerToken;
      if (!(await step(6, "아르바이트 출근", () => shortStart(workerToken!, account.overWork || "WISHED")))) return fin("아르바이트 출근");
    }
    if (inRange(7)) {
      if (!adminToken) { const a = await adminLogin(); if (!a.ok) return fin("어드민 로그인"); adminToken = a.adminToken; }
      if (!(await step(7, "안전교육 진행", () => completeSafetyEducation(adminToken!, account.username, account.cluster)))) return fin("안전교육 진행");
    }
    if (inRange(8) && !(await step(8, "체크인", () => checkin(workerToken!, account.cluster, account.center, account.workPart, account.processCode || "picking", account.processName || "피킹")))) return fin("체크인");
    if (inRange(9) && !(await step(9, "체크아웃", () => checkout(workerToken!)))) return fin("체크아웃");
    if (inRange(10) && !(await step(10, "회원탈퇴", () => deleteAccount(workerToken!, account.username, account.password)))) return fin("회원탈퇴");
    return fin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit("err", `❌ 오류: ${msg}`);
    return { ok: false, doneSteps: done, totalSteps: total, error: msg };
  }
}
