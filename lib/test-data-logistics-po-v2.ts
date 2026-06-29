/**
 * 테스트 데이터 — 물류 발주 V2 (CAPA 기반 발주계획→발주검사→공급사확정→거래명세서)
 *
 * 원본: seahuijang/jangsehui index.html 의 발주 V2 runAll() 포팅.
 * 흐름: 임직원 로그인 → 상품 조회/상세 → 발주계획 등록 → planGoodsIds 추출(재시도/페이지네이션)
 *       → 중복체크 → 발주검사/생성 → 공급사 로그인 → CREATED 조회 → 수령시간 매칭 → 확정(PATCH)
 *       → 거래명세서 생성(merge-check → 사용자 선택: 신규/병합).
 */

import { getPoEnv, empHeaders, api, empLogin, loadDocks, dateStr, sleep, type PoEnv } from "./logistics-po-env";

// 고정 센터 (clusterCode 기준)
export const PO_FIXED_CENTERS: { code: string; label: string }[] = [
  { code: "WH02", label: "김포" }, { code: "WH03", label: "평택" }, { code: "WH04", label: "창원" },
  { code: "MCWH01", label: "DMC점" }, { code: "MCWH02", label: "도곡점" },
];

export interface V2Dock { dockCode: string; dockName: string; fulfillmentCenterCode: string }
export interface V2Goods {
  goodsId: number; masterCode: string; goodsName: string; supplierCode: string; supplierName: string;
  quantityPerUnit: number; unit: string; shippingProcess: string;
  // detail
  waypoint: string; salesProcess: string; detailShippingProcess: string;
  goodsEstimateId: number; goodsEstimateType: string; goodsEstimatePrice: number; goodsEstimateTaxation: string;
}

export interface V2PrepareResult { ok: boolean; empName?: string; empCode?: string; docksByCenter?: Record<string, V2Dock[]>; error?: string }
export interface V2SearchResult { ok: boolean; goods?: V2Goods[]; error?: string }
export interface V2ProgressEvent { type: "step"; ok: boolean; level: "info" | "ok" | "err"; message: string }
export interface V2ExistingStatement { code: string; goodsCount: string | number; status: string }
export interface V2MergeChoice { mode: "new" | "merge"; codes: string[] }
export interface V2RunResult {
  ok: boolean; error?: string;
  registrant?: string; recvDate?: string; goodsCount?: number; centers?: string; confirmedCount?: number;
  planGoodsCodes?: string[]; statementCodes?: string[];
}

export interface V2RunInput {
  envName: string; empEmail: string; supId: string; supPw: string;
  goods: V2Goods[];                       // 선택된 상품 (search 결과에서 선택)
  selectedCenters: string[];
  selectedDockByCenter?: Record<string, string | null>;
  releaseProcess?: string;                // "" = 상품 기본값
  waypoint?: string;                       // "" = 상품 기본값
  quantity: number;
  recvDate?: string;
  skipApplyStock?: boolean;
  poType?: "NORMAL" | "EMERGENCY";
}

function dockFc(d: any): string { return d.fulfillmentCenterCode || d.fulfillmentCenter || ""; }

/** prepare: 임직원 로그인 + 도크 로드 */
export async function preparePoV2(envName: string, empEmail: string): Promise<V2PrepareResult> {
  try {
    if (!empEmail.trim()) return { ok: false, error: "임직원 이메일 필수" };
    const env = getPoEnv(envName);
    const { name, code, token } = await empLogin(env, empEmail.trim());
    const raw = await loadDocks(env, token);
    const docksByCenter: Record<string, V2Dock[]> = {};
    for (const cc of Object.keys(raw)) {
      docksByCenter[cc] = raw[cc].map((d: any) => ({ dockCode: d.dockCode, dockName: d.dockName || d.dockCode, fulfillmentCenterCode: dockFc(d) }));
    }
    return { ok: true, empName: name, empCode: code, docksByCenter };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** search: 발주 가능 상품 조회 + 상세 병합 */
export async function searchPoV2(envName: string, empEmail: string, supplierName: string, goodsName: string, centers: string[]): Promise<V2SearchResult> {
  try {
    const env = getPoEnv(envName);
    const { token } = await empLogin(env, empEmail.trim());
    const q = new URLSearchParams({ currentPage: "1", limit: "200", masterCodes: "" });
    if (supplierName.trim()) q.set("supplierName", supplierName.trim());
    if (goodsName.trim()) q.set("goodsName", goodsName.trim());
    const gr = await api(`${env.admin}/api-purchase/supervisor/v2/purchase-order-available-goods?${q}`, { headers: { Authorization: "Bearer " + token } });
    const goodsArr: any[] = (gr.data && gr.data.data) || [];
    if (!goodsArr.length) return { ok: true, goods: [] };
    const ids = goodsArr.map((g) => g.goodsId).join(",");
    const dr = await api(`${env.admin}/api-purchase/supervisor/v2/purchase-order-available-goods/detail?goodsIds=${encodeURIComponent(ids)}&clusterCenters=${encodeURIComponent(centers.join(","))}`, { headers: { Authorization: "Bearer " + token } });
    const detailArr: any[] = (dr.data && dr.data.data) || [];
    const detById: Record<string, any> = {};
    for (const d of detailArr) detById[String(d.goodsId)] = d;
    const goods: V2Goods[] = goodsArr.map((g) => {
      const d = detById[String(g.goodsId)] || {};
      const est = (d.goodsEstimates && d.goodsEstimates[0]) || {};
      return {
        goodsId: Number(g.goodsId), masterCode: g.masterCode || "", goodsName: g.goodsName || "",
        supplierCode: g.supplierCode || "", supplierName: g.supplierName || "",
        quantityPerUnit: Number(g.quantityPerUnit || 1), unit: g.unit || "EA", shippingProcess: g.shippingProcess || "",
        waypoint: d.waypoint || "N", salesProcess: d.salesProcess || "SALES_FIRST", detailShippingProcess: d.shippingProcess || "",
        goodsEstimateId: Number(est.goodsEstimateId || 0), goodsEstimateType: est.estimateType || "NORMAL",
        goodsEstimatePrice: Number(est.price || 0), goodsEstimateTaxation: est.taxation || "TAXED",
      };
    });
    return { ok: true, goods };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** run: V2 전체 플로우 */
export async function runPoV2(
  input: V2RunInput,
  onProgress?: (e: V2ProgressEvent) => void,
  onMergePrompt?: (statements: V2ExistingStatement[]) => Promise<V2MergeChoice>,
): Promise<V2RunResult> {
  const emit = (level: V2ProgressEvent["level"], message: string) => onProgress?.({ type: "step", ok: level !== "err", level, message });
  const env = getPoEnv(input.envName);
  const sDate = input.recvDate || dateStr(1);
  const today = dateStr(0);
  const qty = Math.max(1, input.quantity | 0 || 1);
  const poType = input.poType === "EMERGENCY" ? "EMERGENCY" : "NORMAL";
  if (!input.goods.length) return { ok: false, error: "상품 미선택" };
  if (!input.selectedCenters.length) return { ok: false, error: "입고지(센터) 미선택" };
  if (!input.supId || !input.supPw) return { ok: false, error: "공급사 로그인 정보 필요" };

  try {
    emit("info", `임직원 로그인...`);
    const { token: empToken, name: empName } = await empLogin(env, input.empEmail.trim());
    const docksByCenter = await loadDocks(env, empToken);

    // selFD: 센터별 fc/dock
    const selFD: { cc: string; fc: string; dock: string }[] = [];
    for (const cc of input.selectedCenters) {
      const ds = docksByCenter[cc] || [];
      const sd = input.selectedDockByCenter?.[cc];
      if (sd) { const f = ds.find((x: any) => x.dockCode === sd); if (f) selFD.push({ cc, fc: dockFc(f), dock: sd }); }
      else if (ds.length) selFD.push({ cc, fc: dockFc(ds[0]), dock: ds[0].dockCode });
    }
    if (!selFD.length) return { ok: false, error: "선택 센터의 도크를 찾을 수 없음" };

    emit("info", `[발주계획] 상품 ${input.goods.length}건 / 센터 ${selFD.map((x) => `${x.cc}(${x.fc}/${x.dock})`).join(", ")}`);
    // ① 발주계획 등록
    const items: any[] = [];
    for (const g of input.goods) {
      const qpu = Number(g.quantityPerUnit || 1);
      for (const f of selFD) {
        items.push({
          supplierCode: g.supplierCode, supplierName: g.supplierName, goodsId: Number(g.goodsId), masterCode: g.masterCode, goodsName: g.goodsName,
          scheduledReceivingDate: sDate, clusterCenter: f.cc, fulfillmentCenter: f.fc, dock: f.dock,
          waypoint: input.waypoint || g.waypoint || "N", purchaseOrderType: poType, giftYn: false,
          unit: g.unit, quantityPerUnit: qpu, quantity: qty, totalQuantity: qty * qpu,
          salesProcess: g.salesProcess || "SALES_FIRST",
          shippingProcess: input.releaseProcess || g.detailShippingProcess || g.shippingProcess || "DIRECT_DELIVERY",
          skipApplyStockYn: !!input.skipApplyStock,
          goodsEstimateId: Number(g.goodsEstimateId || 0), goodsEstimateType: g.goodsEstimateType || "NORMAL",
          goodsEstimatePrice: Number(g.goodsEstimatePrice || 0), goodsEstimateTaxation: g.goodsEstimateTaxation || "TAXED",
          kurlyRemarks: "",
        });
      }
    }
    const pr = await api(`${env.admin}/api-purchase/supervisor/v2/purchase-order-plan-goods`, { method: "POST", headers: { Authorization: "Bearer " + empToken }, body: { neoPurchaseOrderPlanGoodsList: items } });
    if (pr.status !== 200) throw new Error(`발주계획 등록 실패 ${pr.status}: ${JSON.stringify(pr.data).slice(0, 200)}`);
    emit("ok", `✓ 발주계획 ${items.length}건 등록`);

    // ② planGoodsIds 추출 (재시도 + 페이지네이션)
    emit("info", "planGoodsIds 추출...");
    const rIds = input.goods.map((g) => Number(g.goodsId));
    const email = input.empEmail.trim();
    let regDate = today, pgIds: any[] = [], pd: any[] = [];
    for (let retry = 0; retry < 5; retry++) {
      if (retry > 0) emit("info", `   재시도 ${retry}/4...`);
      await sleep(retry === 0 ? 1500 : 2000);
      const grp = await api(`${env.admin}/api-purchase/supervisor/v2/purchase-order-plan-goods/groups?purchaseOrderRegisterDateFrom=${regDate}&purchaseOrderRegisterDateTo=${regDate}&purchaseOrderManagerEmail=${encodeURIComponent(email)}&currentPage=1&limit=20`, { headers: { Authorization: "Bearer " + empToken } });
      let gdd: any = grp.data && grp.data.data; if (gdd && !Array.isArray(gdd)) gdd = gdd.content || []; if (!Array.isArray(gdd)) gdd = [];
      if (gdd.length) regDate = gdd[0].purchaseOrderManagerRegisterDate || regDate;
      pd = []; let pg = 1, more = true;
      while (more) {
        const ptc = await api(`${env.admin}/api-purchase/supervisor/v2/purchase-order-plan-goods/particular-group?purchaseOrderRegisterDate=${regDate}&purchaseOrderManagerEmail=${encodeURIComponent(email)}&neoPurchaseOrderPlanGoodsStatuses=SCHEDULED&currentPage=${pg}&limit=500`, { headers: { Authorization: "Bearer " + empToken } });
        const raw: any = ptc.data && ptc.data.data; let page = Array.isArray(raw) ? raw : (raw && (raw.goodsList || raw.content || raw.goods || [])); if (!Array.isArray(page)) page = [];
        pd = pd.concat(page);
        const total = (raw && (raw.totalElements || raw.totalCount || raw.total)) || 0;
        more = page.length === 500 && pd.length < total; pg++;
      }
      pgIds = pd.filter((i) => rIds.indexOf(Number(i.goodsId)) > -1 && i.scheduledReceivingDate === sDate).map((i) => i.neoPurchaseOrderPlanGoodsId);
      if (!pgIds.length) pgIds = pd.filter((i) => rIds.indexOf(Number(i.goodsId)) > -1).map((i) => i.neoPurchaseOrderPlanGoodsId);
      if (pgIds.length > 0) break;
    }
    if (!pgIds.length) throw new Error("SCHEDULED 항목을 찾을 수 없음 (발주계획 등록됨, 조회 지연)");
    emit("ok", `✓ planGoodsIds ${pgIds.length}건`);

    // ③ 발주검사
    emit("info", "[발주검사]");
    await api(`${env.admin}/api-purchase/supervisor/v2/purchase-order-inspection/selections/duplicate-check`, { method: "POST", headers: { Authorization: "Bearer " + empToken }, body: { neoPurchaseOrderPlanGoodsIds: pgIds } });
    const ins = await api(`${env.admin}/api-purchase/supervisor/v2/purchase-order-inspection/selections`, { method: "POST", headers: { Authorization: "Bearer " + empToken }, body: { neoPurchaseOrderPlanGoodsIds: pgIds } });
    if (ins.status !== 200) throw new Error(`발주생성 실패 ${ins.status}: ${JSON.stringify(ins.data).slice(0, 300)}`);
    emit("ok", "✓ 발주검사+생성 완료");

    // ④ 공급사 로그인 + CREATED 조회
    emit("info", "[공급사 확정]");
    const sl = await api(`${env.escm}/api/v2/user/login`, { method: "POST", body: { loginId: input.supId, password: input.supPw } });
    if (!sl.data.token) throw new Error("공급사 토큰 없음");
    const supToken = sl.data.token;
    emit("ok", `✓ 공급사 로그인 (${sl.data.name || input.supId})`);

    let cr: any[] = [];
    for (let c = 0; c < 5; c++) {
      if (c > 0) emit("info", `   CREATED 조회 재시도 ${c}/4...`);
      await sleep(c === 0 ? 2000 : 2500);
      let gl: any[] = [], sp = 1, smore = true;
      while (smore) {
        const sd2 = await api(`${env.escm}/api-purchase/v2/purchase-order-plan-goods/particular-group?scheduledReceivingDate=${sDate}&sortType=FULFILLMENT_CENTER_ASC&currentPage=${sp}&limit=500`, { headers: { Authorization: "Bearer " + supToken } });
        const sg = (sd2.data && sd2.data.data && sd2.data.data.goodsList) || []; gl = gl.concat(sg);
        const st = (sd2.data && sd2.data.data && (sd2.data.data.totalElements || sd2.data.data.totalCount || sd2.data.data.total)) || 0;
        smore = sg.length === 500 && gl.length < st; sp++;
      }
      // 디버그: 전체 조회 결과 상태 분포
      const statusMap: Record<string, number> = {};
      gl.forEach((i) => { const s = i.neoPurchaseOrderPlanGoodsStatus || "UNKNOWN"; statusMap[s] = (statusMap[s] || 0) + 1; });
      emit("info", `   조회 ${gl.length}건 — 상태: ${Object.entries(statusMap).map(([k, v]) => `${k}:${v}`).join(", ") || "없음"}`);
      cr = gl.filter((i) => i.neoPurchaseOrderPlanGoodsStatus === "CREATED");
      if (cr.length) break;
    }
    if (!cr.length) throw new Error("CREATED 없음 (5회 재시도 후에도 조회 실패)");

    // 수령시간 매칭 → 확정 PATCH
    const tr = await api(`${env.escm}/api-purchase/v2/purchase-order-plan-goods/receiving-times?scheduledReceivingDate=${sDate}`, { headers: { Authorization: "Bearer " + supToken } });
    const rt = (tr.data && tr.data.data && tr.data.data.receivingTime) || {};
    const at: any[] = [];
    for (const fc of Object.keys(rt)) for (const dk of Object.keys(rt[fc])) (rt[fc][dk] || []).forEach((t: any) => at.push({ fc, dock: dk, id: t.rmsOperationTimeId, from: t.receivingTimeFrom, to: t.receivingTimeTo, wp: t.hasWaypoint, parcel: t.parcelYn }));
    const ul = cr.map((c: any) => {
      const fc = c.fulfillmentCenter, dk = c.dock, wp = c.waypoint || "N";
      const mt = at.filter((t) => t.fc === fc && t.dock === dk && ((wp === "Y" || wp === "WAY1") ? t.wp : !t.wp) && !t.parcel);
      const ti = mt[0] || at.find((t) => t.fc === fc && t.dock === dk) || { id: 0, from: "00:00", to: "23:59" };
      return { neoPurchaseOrderPlanGoodsId: Number(c.neoPurchaseOrderPlanGoodsId), neoPurchaseOrderPlanGoodsCode: c.neoPurchaseOrderPlanGoodsCode, pallets: null, meatTraceNumber: null, supplierRemarks: null, quantity: qty, receivingTimeFrom: ti.from, receivingTimeTo: ti.to, rmsOperationTimeId: ti.id, shippingProcess: c.shippingProcess, shippingCategory: "A", manufactureDate: today, useDate: null, requiredApprovalDateYn: false, waypoint: wp, quantityChangeReason: null, version: c.version };
    });
    const cfm = await api(`${env.escm}/api-purchase/v2/purchase-order-plan-goods`, { method: "PATCH", headers: { Authorization: "Bearer " + supToken }, body: { updateGoodsList: ul, scheduledReceivingDate: sDate } });
    if (cfm.status !== 200) throw new Error(`확정 실패 ${cfm.status}: ${JSON.stringify(cfm.data).slice(0, 300)}`);
    emit("ok", `✓ 확정 ${ul.length}건`);

    // ⑤ 거래명세서
    emit("info", "[거래명세서]");
    await sleep(500);
    let allConf: any[] = [], cp = 1, cmore = true;
    while (cmore) {
      const cd = await api(`${env.escm}/api-purchase/v2/purchase-order-plan-goods/particular-group?scheduledReceivingDate=${sDate}&sortType=FULFILLMENT_CENTER_ASC&currentPage=${cp}&limit=500`, { headers: { Authorization: "Bearer " + supToken } });
      const cg = (cd.data && cd.data.data && cd.data.data.goodsList) || []; allConf = allConf.concat(cg);
      const ct = (cd.data && cd.data.data && (cd.data.data.totalElements || cd.data.data.totalCount || cd.data.data.total)) || 0;
      cmore = cg.length === 500 && allConf.length < ct; cp++;
    }
    const confirmed = allConf.filter((i) => i.neoPurchaseOrderPlanGoodsStatus === "CONFIRMED");
    const cIds = confirmed.map((i) => i.neoPurchaseOrderPlanGoodsId);

    // 발주확정 후 merge-check → 사용자 선택 (신규/병합)
    const mc = await api(`${env.escm}/api-purchase/v2/purchase-order-statement/selections/merge-check`, { method: "POST", headers: { Authorization: "Bearer " + supToken }, body: { neoPurchaseOrderPlanGoodsIds: cIds } });
    let mcData: any = (mc.data && mc.data.data) || mc.data || []; if (!Array.isArray(mcData)) mcData = mcData.goods || mcData.goodsList || mcData.statements || mcData.content || []; if (!Array.isArray(mcData)) mcData = [];
    const existMap = new Map<string, V2ExistingStatement>();
    mcData.forEach((g: any) => { let stmts = g.statements || g.neoPurchaseOrderStatements || []; if (!Array.isArray(stmts) && g.neoPurchaseOrderStatementCode) stmts = [g]; stmts.forEach((s: any) => { const code = s.neoPurchaseOrderStatementCode || s.statementCode || s.code; if (code && !existMap.has(code)) existMap.set(code, { code, goodsCount: s.goodsCount || s.neoPurchaseOrderPlanGoodsCount || s.count || "-", status: s.neoPurchaseOrderStatementStatus || s.status || "-" }); }); });
    const existStatements = [...existMap.values()];

    let selectedMCodes: string[] = [];
    if (existStatements.length && onMergePrompt) {
      emit("info", `기존 거래명세서 ${existStatements.length}건 발견 → 신규/병합 선택 대기...`);
      const choice = await onMergePrompt(existStatements);
      if (choice.mode === "merge") {
        selectedMCodes = choice.codes;
        emit("ok", `→ 기존 병합 선택: ${selectedMCodes.join(", ")}`);
      } else {
        emit("ok", "→ 신규 생성 선택");
      }
    } else if (existStatements.length) {
      emit("info", `기존 거래명세서 ${existStatements.length}건 발견 → 신규 생성 (기본)`);
    } else {
      emit("info", "기존 거래명세서 없음 → 신규 생성");
    }

    // before/after 스냅샷 diff
    const beforeRes = await api(`${env.escm}/api-purchase/v2/purchase-order-statement?scheduledReceivingDateFrom=${sDate}&scheduledReceivingDateTo=${sDate}&currentPage=1&limit=200`, { headers: { Authorization: "Bearer " + supToken } });
    const beforeCodes = ((beforeRes.data && beforeRes.data.data) || []).map((s: any) => s.neoPurchaseOrderStatementCode);
    await api(`${env.escm}/api-purchase/v2/purchase-order-statement/selections`, { method: "POST", headers: { Authorization: "Bearer " + supToken }, body: { neoPurchaseOrderPlanGoodsIds: cIds, selectedNeoPurchaseOrderStatementCodes: selectedMCodes } });
    await sleep(500);
    const afterRes = await api(`${env.escm}/api-purchase/v2/purchase-order-statement?scheduledReceivingDateFrom=${sDate}&scheduledReceivingDateTo=${sDate}&currentPage=1&limit=200`, { headers: { Authorization: "Bearer " + supToken } });
    const afterCodes = ((afterRes.data && afterRes.data.data) || []).map((s: any) => s.neoPurchaseOrderStatementCode);
    const createdCodes = afterCodes.filter((c: string) => beforeCodes.indexOf(c) < 0);
    emit("ok", `✓ 완료! 거래명세서 ${createdCodes.length}건`);

    return {
      ok: true, registrant: empName, recvDate: sDate, goodsCount: input.goods.length,
      centers: selFD.map((x) => `${x.fc}/${x.dock}`).join(", "), confirmedCount: ul.length,
      planGoodsCodes: confirmed.map((c) => c.neoPurchaseOrderPlanGoodsCode).filter(Boolean),
      statementCodes: createdCodes,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit("err", `❌ ${msg}`);
    return { ok: false, error: msg };
  }
}
