/**
 * 발주(PO) 공통 — 환경(ENV) 맵 + HTTP 헤더 유틸
 *
 * 원본: seahuijang/jangsehui index.html (CAPA + 발주 V2) 의 ENV/getEnv/empHeaders/supHeaders/api 포팅.
 * 서버사이드 fetch라 origin/referer 헤더가 실제로 적용됨(브라우저 forbidden-header 제약 없음).
 * 환경별 base URL·기본 계정은 env(KURLY_PO_*)로 오버라이드 가능.
 */

export type PoEnvName = "STG" | "DEV01" | "DEV02" | "DEV03" | "DEV04" | "DEV05";

export interface PoEnv {
  admin: string;   // escm-api-admin
  escm: string;    // api.escm
  rms: string;     // inbound-api.rms
  empEmail: string;
  rmsId: string; rmsPw: string;
  supId: string; supPw: string;
}

export const PO_ENVS: Record<PoEnvName, PoEnv> = {
  STG: { admin: "https://escm-api-admin.stg.kurly.services", escm: "https://api.escm.stg.kurly.com", rms: "https://inbound-api.rms.stg.kurly.services",
    empEmail: "seahui.jang@kurlycorp.com", rmsId: "seahui.jang1", rmsPw: "tpgldia12!", supId: "vd5783.02", supPw: "1234" },
  DEV01: { admin: "https://escm-api01.dev.kurly.services", escm: "https://escm-api01.dev.kurly.services", rms: "https://inbound-api.rms.dev.kurly.services",
    empEmail: "seahui.jang@kurlycorp.com", rmsId: "seahui.jang", rmsPw: "tpgmlqkqh12!", supId: "vd3596.01", supPw: "1234" },
  DEV02: { admin: "https://escm-api02.dev.kurly.services", escm: "https://escm-api02.dev.kurly.services", rms: "https://inbound-api.rms.dev.kurly.services",
    empEmail: "seahui.jang@kurlycorp.com", rmsId: "seahui.jang", rmsPw: "tpgmlqkqh12!", supId: "vd3596.01", supPw: "1234" },
  DEV03: { admin: "https://escm-api03.dev.kurly.services", escm: "https://escm-api03.dev.kurly.services", rms: "https://inbound-api.rms.dev.kurly.services",
    empEmail: "seahui.jang@kurlycorp.com", rmsId: "seahui.jang", rmsPw: "tpgmlqkqh12!", supId: "vd3596.01", supPw: "1234" },
  DEV04: { admin: "https://escm-api04.dev.kurly.services", escm: "https://escm-api04.dev.kurly.services", rms: "https://inbound-api.rms.dev.kurly.services",
    empEmail: "seahui.jang@kurlycorp.com", rmsId: "seahui.jang", rmsPw: "tpgmlqkqh12!", supId: "vd3596.01", supPw: "1234" },
  DEV05: { admin: "https://escm-api05.dev.kurly.services", escm: "https://escm-api05.dev.kurly.services", rms: "https://inbound-api.rms.dev.kurly.services",
    empEmail: "seahui.jang@kurlycorp.com", rmsId: "seahui.jang", rmsPw: "tpgmlqkqh12!", supId: "vd3596.01", supPw: "1234" },
};

export function getPoEnv(name?: string): PoEnv {
  return PO_ENVS[(name as PoEnvName)] || PO_ENVS.STG;
}

const PARTNER_ORIGIN = "https://partner.stg.kurly.com";
export function empHeaders(token: string): Record<string, string> {
  return { accept: "application/json", authorization: "Bearer " + token, "content-type": "application/json;charset=UTF-8", origin: PARTNER_ORIGIN, referer: PARTNER_ORIGIN + "/" };
}
export function supHeaders(token: string): Record<string, string> {
  return { accept: "application/json", authorization: token, "content-type": "application/json;charset=UTF-8", origin: PARTNER_ORIGIN, referer: PARTNER_ORIGIN + "/" };
}
export function bearerHeaders(token: string): Record<string, string> {
  return { accept: "application/json", authorization: "Bearer " + token, "content-type": "application/json" };
}

export interface ApiResp { status: number; data: any }
/** fetch 래퍼 — 원본 api() 와 동일. body는 객체면 JSON 직렬화. */
export async function api(url: string, o?: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<ApiResp> {
  o = o || {};
  const res = await fetch(url, {
    method: o.method || "GET",
    headers: Object.assign({ "Content-Type": "application/json" }, o.headers || {}),
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  const t = await res.text();
  let data: any; try { data = JSON.parse(t); } catch { data = { _raw: t }; }
  return { status: res.status, data };
}

export function decodeJwt(token: string): any {
  try { const seg = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(Buffer.from(seg, "base64").toString("utf-8")); }
  catch { return null; }
}
export function dateStr(off: number): string {
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 임직원 fake-signin (공용)
export async function empLogin(env: PoEnv, email: string): Promise<{ token: string; name: string; code: string }> {
  const res = await fetch(`${env.admin}/api-authorization/supervisor/v1/employee/fake-signin/email/${encodeURIComponent(email)}`, { method: "GET", headers: { accept: "application/json" } });
  const json: any = await res.json().catch(() => ({}));
  if (!json.token) throw new Error(`임직원 로그인 실패 (토큰 없음, HTTP ${res.status})`);
  const p = decodeJwt(json.token) || {};
  return { token: json.token, name: p.name || email, code: p.emplCode || "" };
}

// 입고지 도크 로드 (clusterCode → docks[])
export async function loadDocks(env: PoEnv, empToken: string): Promise<Record<string, any[]>> {
  const res = await fetch(`${env.escm}/api/v2/loadingdocks`, { method: "GET", headers: empHeaders(empToken) });
  const json: any = await res.json().catch(() => ({}));
  const list: any[] = json.result || [];
  const byCenter: Record<string, any[]> = {};
  for (const d of list) { const cc = d.clusterCode || ""; if (!cc) continue; (byCenter[cc] ??= []).push(d); }
  return byCenter;
}
