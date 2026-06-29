/**
 * 테스트 데이터 — 발주 CAPA(수용능력) 관리
 *
 * 원본: seahuijang/jangsehui index.html 의 CAPA 탭(doRmsLogin/checkCapa/regBulkCapa) 포팅.
 * 흐름: 임직원 로그인(daily-capa 조회용) + RMS 로그인(클러스터/창고/입고지 enum, 등록용)
 *       → daily-capa 조회 → (date × fc × dock) 별 CAPA 존재/누락 계산
 *       → 누락 입고지 inbound-operation-time 일괄 등록(코드 충돌 시 _N 재시도).
 */

import { getPoEnv, api, empLogin, dateStr, sleep, type PoEnv } from "./logistics-po-env";

export interface RmsArea { code: string; name: string; warehouse: string; cluster: string; id: number }
export interface RmsWarehouse { code: string; name: string; cluster: string }

export interface CapaRow { fc: string; fcName: string; dock: string; dockName: string; exists: boolean; detail: string }
export interface CapaDay { date: string; rows: CapaRow[] }
export interface CapaMissing { fc: string; fcName: string; dock: string; dockName: string; date: string; weekday: string }
export interface CapaQueryResult {
  ok: boolean; error?: string; empName?: string;
  warehouses?: RmsWarehouse[]; areas?: RmsArea[];
  days?: CapaDay[]; missing?: CapaMissing[];
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]; // getDay() 인덱스

async function rmsLogin(env: PoEnv, id: string, pw: string): Promise<string> {
  const r = await api(`${env.rms}/auth/v1/login`, { method: "POST", body: { loginId: id, password: pw } });
  // RMS는 실패해도 200 + token:null/signIn:false 를 반환
  if (!r.data || !r.data.token) throw new Error(`RMS 로그인 실패 — 계정/비밀번호 확인 (signIn=${r.data && r.data.signIn})`);
  return r.data.token;
}
async function rmsEnumerate(env: PoEnv, token: string): Promise<{ clusters: any[]; warehouses: RmsWarehouse[]; areas: RmsArea[] }> {
  const h = { Authorization: "Bearer " + token };
  const cl = await api(`${env.rms}/common/cluster/v1/clusters`, { headers: h });
  const clusters: any[] = (cl.data && cl.data.clusters) || [];
  const wh = await api(`${env.rms}/common/warehouse/v1/warehouses`, { headers: h });
  const warehouses: RmsWarehouse[] = ((wh.data && wh.data.warehouses) || []).map((w: any) => ({ code: w.code, name: w.name, cluster: w.cluster }));
  const areas: RmsArea[] = [];
  for (const c of clusters) {
    const ar = await api(`${env.rms}/web/v1/inbound-areas?cluster=${encodeURIComponent(c.code)}&useYn=true`, { headers: h });
    ((ar.data && ar.data.list) || []).forEach((a: any) => areas.push({ code: a.code, name: a.name, warehouse: a.warehouse, cluster: c.code, id: a.id }));
  }
  return { clusters, warehouses, areas };
}

/** CAPA 조회 — 임직원+RMS 로그인 후 daily-capa 조회 + 존재/누락 계산. */
export async function capaQuery(input: {
  envName: string; empEmail: string; rmsId: string; rmsPw: string;
  dateFrom: string; dateTo: string; shipFilter: "CAR" | "PARCEL"; wpFilter: string; // wpFilter: "" | "true" | "false"
}): Promise<CapaQueryResult> {
  try {
    const env = getPoEnv(input.envName);
    const emp = await empLogin(env, input.empEmail.trim());
    const rmsToken = await rmsLogin(env, input.rmsId, input.rmsPw);
    const { warehouses, areas } = await rmsEnumerate(env, rmsToken);
    const whNames: Record<string, string> = {}; warehouses.forEach((w) => (whNames[w.code] = w.name));
    const areaByCode: Record<string, RmsArea> = {}; areas.forEach((a) => (areaByCode[a.code] = a));

    // daily-capa 조회
    const r = await api(`${env.admin}/api-purchase/supervisor/v2/purchase-order-plan-goods/receiving/daily-capa?scheduledReceivingDateFrom=${input.dateFrom}&scheduledReceivingDateTo=${input.dateTo}`, { headers: { Authorization: "Bearer " + emp.token } });
    const allCapas: any[] = (r.data && r.data.data && r.data.data.receivingDailyCapas) || [];
    const capas = allCapas.filter((c) => c.rmsShippingProcess === input.shipFilter);
    // byDate[date][fc|dock] = slots[]
    const byDate: Record<string, Record<string, any[]>> = {};
    capas.forEach((c) => { const d = c.scheduledReceivingDate; (byDate[d] ??= {}); const k = c.fulfillmentCenter + "|" + c.dock; (byDate[d][k] ??= []).push(c); });

    // 전체 fc/dock = rmsAreas (warehouse=fc, code=dock)
    const fcDocks = areas.map((a) => ({ fc: a.warehouse, dock: a.code })).sort((a, b) => (a.fc + a.dock).localeCompare(b.fc + b.dock));
    // 날짜 범위
    const dates: string[] = []; const cur = new Date(input.dateFrom), end = new Date(input.dateTo);
    while (cur <= end) { dates.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate() + 1); }

    const days: CapaDay[] = []; const missing: CapaMissing[] = [];
    for (const date of dates) {
      const dd = byDate[date] || {};
      const rows: CapaRow[] = [];
      for (const sel of fcDocks) {
        const k = sel.fc + "|" + sel.dock;
        const slots: any[] = dd[k] || [];
        const filtered = slots.filter((s) => input.wpFilter === "" || String(s.hasWaypoint) === input.wpFilter);
        const exists = filtered.length > 0;
        const fcName = whNames[sel.fc] ? `${whNames[sel.fc]}(${sel.fc})` : sel.fc;
        const dockName = areaByCode[sel.dock] ? `${areaByCode[sel.dock].name}(${sel.dock})` : sel.dock;
        const detail = exists ? filtered.map((s) => `${s.rmsShippingProcess === "PARCEL" ? "택배" : "차량"}·${s.hasWaypoint ? "대행" : "일반"} SKU:${s.availableSkuCapa}/${s.totalSkuCapa} Unit:${s.availableUnitCapa}/${s.totalUnitCapa}`).join(" / ") : (slots.length ? "조건 불일치" : "CAPA 없음");
        rows.push({ fc: sel.fc, fcName, dock: sel.dock, dockName, exists, detail });
        if (!exists) missing.push({ fc: sel.fc, fcName, dock: sel.dock, dockName, date, weekday: WEEKDAYS[new Date(date).getDay()] });
      }
      days.push({ date, rows });
    }
    return { ok: true, empName: emp.name, warehouses, areas, days, missing };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export interface CapaRegisterItem { fc: string; dock: string; date: string }
export interface CapaRegisterSettings {
  prefix: string; partyType: "1P" | "3PL"; releaseGroup: "CAR" | "PARCEL"; xdock: "Y" | "N";
  startSlot: number; endSlot: number; startTime: string; endTime: string;
  sku: Record<string, number>; unit: Record<string, number>; // mon..sun
}
export interface CapaRegisterResult { index: number; fc: string; dock: string; date: string; ok: boolean; code?: string; error?: string }
export interface CapaRegisterProgress { type: "capa"; index: number; ok: boolean; message: string }

/** CAPA 일괄 등록 — 누락 입고지에 inbound-operation-time 등록(코드 충돌 시 _N 재시도). */
export async function capaRegister(
  envName: string, rmsId: string, rmsPw: string, items: CapaRegisterItem[], s: CapaRegisterSettings,
  onProgress?: (e: CapaRegisterProgress) => void
): Promise<{ okCount: number; failCount: number; results: CapaRegisterResult[]; error?: string }> {
  const env = getPoEnv(envName);
  const results: CapaRegisterResult[] = [];
  let token: string;
  let areas: RmsArea[];
  try {
    token = await rmsLogin(env, rmsId, rmsPw);
    ({ areas } = await rmsEnumerate(env, token));
  } catch (e) { return { okCount: 0, failCount: 0, results: [], error: e instanceof Error ? e.message : String(e) }; }
  const areaByCode: Record<string, RmsArea> = {}; areas.forEach((a) => (areaByCode[a.code] = a));
  const isParcel = s.releaseGroup === "PARCEL";
  const startTime = isParcel ? "00:00:00" : s.startTime, endTime = isParcel ? "23:29:59" : s.endTime;
  const startSlot = isParcel ? 1 : s.startSlot, endSlot = isParcel ? 47 : s.endSlot;

  let okCount = 0, failCount = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const ai = areaByCode[it.dock] || ({} as RmsArea);
    const areaId = ai.id || 0;
    const cluster = ai.cluster || "CC02";
    const baseCode = (s.prefix + "_" + it.dock).slice(0, 17);
    let code = baseCode, retry = 0, res: any;
    while (true) {
      const body = {
        cluster, warehouse: it.fc, inboundAreaId: Number(areaId), partyType: s.partyType, releaseGroup: s.releaseGroup, xdockYnValue: s.xdock,
        code, description: "", startDate: it.date, endDate: it.date,
        startTimeSlotNumber: startSlot, endTimeSlotNumber: endSlot, startTime, endTime,
        monSku: s.sku.mon | 0, tueSku: s.sku.tue | 0, wedSku: s.sku.wed | 0, thuSku: s.sku.thu | 0, friSku: s.sku.fri | 0, satSku: s.sku.sat | 0, sunSku: s.sku.sun | 0,
        monUnit: s.unit.mon | 0, tueUnit: s.unit.tue | 0, wedUnit: s.unit.wed | 0, thuUnit: s.unit.thu | 0, friUnit: s.unit.fri | 0, satUnit: s.unit.sat | 0, sunUnit: s.unit.sun | 0,
        xdockYn: s.xdock === "Y",
      };
      res = await api(`${env.rms}/web/v1/inbound-operation-time`, { method: "POST", headers: { Authorization: "Bearer " + token }, body });
      if (res.data && res.data.type === "ALREADY_REGISTERED_CODE" && retry < 20) { retry++; code = (baseCode + "_" + retry).slice(0, 20); continue; }
      break;
    }
    const dup = res.data && res.data.message && String(res.data.message).indexOf("이미 존재") > -1;
    if (res.status === 200 || dup) {
      okCount++; results.push({ index: i + 1, fc: it.fc, dock: it.dock, date: it.date, ok: true, code: dup ? "(이미 존재)" : code });
      onProgress?.({ type: "capa", index: i + 1, ok: true, message: `✓ ${it.fc}/${it.dock} (${it.date}) ${dup ? "이미 존재" : "코드 " + code}` });
    } else {
      failCount++; const err = JSON.stringify(res.data).slice(0, 120);
      results.push({ index: i + 1, fc: it.fc, dock: it.dock, date: it.date, ok: false, error: err });
      onProgress?.({ type: "capa", index: i + 1, ok: false, message: `✗ ${it.fc}/${it.dock}: ${err}` });
    }
    await sleep(200);
  }
  return { okCount, failCount, results };
}
