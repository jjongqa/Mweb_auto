/**
 * 테스트 데이터 — 물류 발주(Purchase Order) 생성
 *
 * 원본: fulfillment_sqe_studio `src/test_purchase_gen/purchase_order_gen.html` (클라이언트 도구) 포팅.
 *   브라우저가 STG API를 직접 호출하던 것을 서버(fetch)로 옮겨 CORS 무관하게 동작.
 *
 * 흐름 (Kurly Partner Portal STG):
 *   0. 임직원 fake-signin (이메일만, 비밀번호 없음) → empToken + emplCode/name (JWT 디코드)
 *   1. 발주상품 조회 (검색어)                       → goodsIds
 *   2. 입고지/견적 조회 (goods/purchase)            → 센터별 창고·도크·견적
 *   3. purchaseOrderRegisterItems payload 조립      → 센터 × 상품
 *   4. 발주그룹 등록 (POST, approvalStatus=TEMP)
 *   5. 발주그룹 조회 (AWAITING_PURCHASE)            → purchaseGroupId/Code
 *   6. 발주서 일괄생성 (PATCH create-purchase-orders)
 *   7. 발주서 조회                                   → purchaseOrderIds
 *   8. 공급사 로그인 → 발주서별 GET → 발주확정 PUT (APPROVED + 제조/유통기한)
 *
 * 인증: 임직원=Bearer empToken / 공급사=토큰값만(Bearer 접두사 없음, 원본 그대로).
 * 호스트는 env 오버라이드 가능(KURLY_ESCM_ADMIN / KURLY_ESCM_API).
 */

import { getPoEnv } from "./logistics-po-env";
// 호스트는 환경(envName)별로 해석 — getPoEnv(envName).admin/.escm. (STG 기본)
const PARTNER_ORIGIN = "https://partner.stg.kurly.com";

// 입고지(센터) — 원본 allCenters 그대로. code → 라벨 / 견적응답 필드 매핑.
export const PO_CENTERS: { code: string; label: string }[] = [
  { code: "WH02", label: "김포(WH02)" },
  { code: "WH03", label: "평택(WH03)" },
  { code: "WH04", label: "창원(WH04)" },
  { code: "MCWH01", label: "1MC" },
  { code: "MCWH02", label: "2MC" },
  { code: "MCWH03", label: "3MC" },
  { code: "MCWH04", label: "4MC" },
];
const CENTER_TO_FIELD: Record<string, string> = {
  WH02: "goodsReceivings2cc", WH03: "goodsReceivings3cc", WH04: "goodsReceivings4cc",
  MCWH01: "goodsReceivings1mc", MCWH02: "goodsReceivings2mc",
  MCWH03: "goodsReceivings3mc", MCWH04: "goodsReceivings4mc",
};

export interface PoDock { dockCode: string; dockName: string }
export interface PoPrepareResult {
  ok: boolean;
  empName?: string;
  empCode?: string;
  docksByCenter?: Record<string, PoDock[]>;  // 센터코드 → 도크 목록
  error?: string;
}

export interface PoRunInput {
  envName?: string;
  empEmail: string;
  searchWord: string;
  groupName: string;
  receivingEstimateDate?: string;   // "YYYY-MM-DD" — 미지정 시 내일
  boxQnty: number;
  selectedCenters: string[];
  selectedDockByCenter?: Record<string, string | null>;  // 센터 → dockCode(null=상품 기본값)
  skipApplyStock: boolean;
  supLoginId: string;
  supPassword: string;
}

export interface PoProgressEvent { type: "step"; ok: boolean; level: "info" | "ok" | "err" | "warn" | "sub"; message: string }

export interface PoRunResult {
  ok: boolean;
  registrantName?: string;
  registrantEmployeeCode?: string;
  groupName?: string;
  purchaseGroupId?: number | string;
  purchaseGroupCode?: string;
  receivingEstimateDate?: string;
  purchaseOrderIds?: (number | string)[];
  okCount?: number;        // 발주확정 성공 건수
  failCount?: number;
  total?: number;          // 발주서 수
  error?: string;
}

// ── 유틸 ──────────────────────────────────────────────
function empHeaders(token: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    authorization: "Bearer " + token,
    "content-type": "application/json;charset=UTF-8",
    origin: PARTNER_ORIGIN,
    referer: PARTNER_ORIGIN + "/",
  };
}
function supHeaders(token: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    authorization: token,   // ⚠ 공급사는 Bearer 접두사 없음 (원본 그대로)
    "content-type": "application/json;charset=UTF-8",
    origin: PARTNER_ORIGIN,
    referer: PARTNER_ORIGIN + "/",
  };
}

function decodeJwt(token: string): { emplCode?: string; name?: string } | null {
  try {
    const seg = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(seg, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dateToISO(ymd: string): string {
  return ymd + "T00:00:00.000Z";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 0. 임직원 로그인 (fake-signin) ─────────────────────
async function empLogin(email: string, admin: string): Promise<{ token: string; emplCode: string; name: string }> {
  const url = `${admin}/api-authorization/supervisor/v1/employee/fake-signin/email/${encodeURIComponent(email)}`;
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`임직원 로그인 HTTP ${res.status}`);
  const json: any = await res.json();
  const token = json.token || (json.result && json.result.token);
  if (!token) throw new Error("임직원 토큰 없음");
  const p = decodeJwt(token);
  return { token, emplCode: (p && p.emplCode) || "", name: (p && p.name) || email };
}

// ── 도크 조회 ─────────────────────────────────────────
async function fetchDocks(token: string, escm: string): Promise<Record<string, PoDock[]>> {
  const res = await fetch(`${escm}/api/v2/loadingdocks`, {
    method: "GET",
    headers: {
      ...empHeaders(token),
      routepath: `${PARTNER_ORIGIN}/#/purchaseOrder/group/v3/add`,
    },
  });
  if (!res.ok) throw new Error(`도크 조회 HTTP ${res.status}`);
  const json: any = await res.json();
  let list: any[] = [];
  if (Array.isArray(json)) list = json;
  else if (Array.isArray(json.result)) list = json.result;
  else if (json.result && Array.isArray(json.result.data)) list = json.result.data;

  const byCenter: Record<string, PoDock[]> = {};
  for (const d of list) {
    const cc = d.centerCode || d.clusterCode || d.warehouseCode || d.center || "";
    if (!cc) continue;
    const dockCode = d.dockCode || d.code || d.id || "";
    const dockName = d.dockName || d.name || d.description || dockCode;
    if (!byCenter[cc]) byCenter[cc] = [];
    byCenter[cc].push({ dockCode: String(dockCode), dockName: String(dockName) });
  }
  return byCenter;
}

/** prepare: 이메일로 로그인 검증 + 도크 목록 반환 (폼이 도크 선택 UI를 그리기 위함). */
export async function preparePo(email: string, envName?: string): Promise<PoPrepareResult> {
  try {
    if (!email.trim()) return { ok: false, error: "임직원 이메일 필수" };
    const e = getPoEnv(envName);
    const { emplCode, name, token } = await empLogin(email.trim(), e.admin);
    let docksByCenter: Record<string, PoDock[]> = {};
    try {
      docksByCenter = await fetchDocks(token, e.escm);
    } catch {
      docksByCenter = {};  // 도크 실패는 치명적 아님 — 상품 기본값 사용
    }
    return { ok: true, empName: name, empCode: emplCode, docksByCenter };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── purchaseOrderRegisterItems 조립 (원본 payload 그대로) ──
function buildItems(
  dataArr: any[], selectedCenters: string[], boxQnty: number, skipVal: boolean,
  receivingEstimateDate: string, selectedDockByCenter?: Record<string, string | null>
): any[] {
  const items: any[] = [];
  for (const g of dataArr) {
    const est = g.currentGoodsEstimate || {};
    const bpq = (est.boxPerQnty != null ? est.boxPerQnty : null) || (g.boxPerQnty != null ? g.boxPerQnty : null) || 1;
    const totalQnty = boxQnty * bpq;
    const waypointMap: Record<string, string> = {};
    (g.supplierGoodsByClusters || []).forEach((c: any) => { waypointMap[c.clusterCode] = c.wayPointCode || "N"; });
    const mdCode = (g.kurlyManagerMd && g.kurlyManagerMd.employeeCode) || "";

    for (const center of selectedCenters) {
      const field = CENTER_TO_FIELD[center];
      const list: any[] = (field && g[field]) || [];
      let def: any = null;
      for (let i = 0; i < list.length; i++) { if (list[i].defaultWarehouse) { def = list[i]; break; } }
      if (!def) def = list[0] || {};
      const wh = def.warehouse || "";
      // 사용자가 선택한 도크 우선, 없으면 API 기본값
      const sel = selectedDockByCenter ? selectedDockByCenter[center] : undefined;
      const dock = sel !== undefined && sel !== null ? sel : (def.dockCode || null);
      const gri = def.goodsReceivingId || 0;

      items.push({
        supplierName: g.supplierName, goodsId: g.goodsId, goodsCode: g.goodsCode,
        goodsName: g.goodsName, supplierId: g.supplierId,
        taxation: g.taxation || est.taxation || "TAXED", unit: g.unit || est.unit || "EA",
        boxQnty: String(boxQnty), totalQnty, receivingEstimateTotQnty: 0,
        receivingCenter: center, dockCode: dock, releaseAddress: "", releaseDetailAddress: "",
        remarks: g.remarks || "", skipApplyStock: skipVal, giftYn: false,
        goodsEstimateViews: [{ value: est.goodsEstimateId || 0, text: "일반-" + (est.price || 0) + "원",
          price: est.price || 0, taxPrice: est.taxPrice || 0, totalPrice: est.totalPrice || 0,
          taxation: est.taxation || "TAXED", type: est.estimateType || "NORMAL" }],
        receivings: [{ goodsReceivingId: gri, goodsId: 0, center, warehouse: wh, dockCode: dock, defaultWarehouse: true }],
        goodsEstimates: [{ goodsEstimateId: est.goodsEstimateId || 0, estimateId: est.estimateId || 0,
          goodsId: g.goodsId, goodsName: g.goodsName, goodsCode: g.goodsCode,
          netWeight: (est.netWeight != null ? est.netWeight : g.netWeight) || 1,
          grossWeight: (est.grossWeight != null ? est.grossWeight : g.grossWeight) || 1,
          unit: est.unit || g.unit || "EA", boxPerQnty: bpq,
          taxation: est.taxation || "TAXED", estimateType: est.estimateType || "NORMAL",
          price: est.price || 0, taxPrice: est.taxPrice || 0, totalPrice: est.totalPrice || 0,
          approvalStatus: est.approvalStatus || "APPROVED",
          priceFromDate: est.priceFromDate || null, priceToDate: est.priceToDate || null }],
        checkCo: true, checked: false,
        poGoodsStock: { centerCd: null, d1Cnt: null, d2Cnt: null, d3Cnt: null, day7AvgCnt: null,
          day28AvgCnt: null, dcRatio: null, cmsStockDays: null, wmsDisposalQnty: null,
          cntDisposedDt: null, cntRunoutDt: null, sellAvailableDate: null, nextDayStock: null,
          currentStock: null, cmsGoodsPrice: null, promotionOrderAvgCnt: 0,
          receivingInfoList: [], purchaseRate: "", totalStockDays: null },
        wayPointCode: waypointMap[center] || "N", shelfLifeType: g.shelfLifeType || "USE_DATE",
        averagePurchaseQuantity: g.averagePurchaseQuantity || null, expectedStockDay: null,
        mainCategoryCode: g.mainCategoryCode || null, promotionOrderAverage: 0,
        boxPerQnty: bpq, moq: g.moq || 1,
        goodsReleaseCode: g.releaseCode || "DIRECT_DELIVERY", releaseCode: g.releaseCode || "DIRECT_DELIVERY",
        mdEmployeeCode: mdCode, goodsEstimateId: est.goodsEstimateId || 0,
        grossWeight: (g.grossWeight != null ? g.grossWeight : est.grossWeight) || 1,
        deliveryType: g.deliveryType || "225", orderType: "NORMAL",
        stockSafeDate: g.stockSafeDate || 0,
        receivingEstimateDate,
        normalGoodsEstimates: g.normalGoodsEstimates || [], eventGoodsEstimates: g.eventGoodsEstimates || [],
        receivingWareHouseType: "", receivingWarehouse: wh,
        originReceivingWarehouse: wh, originDockCode: dock,
        storageFrom: g.storageFrom || "00:00:00", sellingType: g.sellingType || "SALES_FIRST",
        poGoodsOrders: [], estimateType: est.estimateType || "NORMAL",
        price: est.price || 0, taxPrice: est.taxPrice || 0, totalPrice: est.totalPrice || 0,
      });
    }
  }
  return items;
}

/** run: 발주 8단계 전체 실행 (SSE 진행 콜백). */
export async function runPo(input: PoRunInput, onProgress?: (e: PoProgressEvent) => void): Promise<PoRunResult> {
  const emit = (level: PoProgressEvent["level"], message: string, ok = level !== "err" && level !== "warn") =>
    onProgress?.({ type: "step", ok, level, message });

  const searchWord = input.searchWord.trim() || "세희";
  const groupName = input.groupName.trim() || "세희발주테스트";
  const boxQnty = Math.max(1, input.boxQnty | 0 || 1);
  const supLoginId = input.supLoginId.trim();
  const supPassword = input.supPassword.trim();
  const selectedCenters = input.selectedCenters.length ? input.selectedCenters : ["WH02"];

  const receivingEstimateDateDisplay = input.receivingEstimateDate || dateStr(1);
  const receivingEstimateDate = dateToISO(receivingEstimateDateDisplay);

  if (!supLoginId || !supPassword) return { ok: false, error: "공급사 로그인 ID / 비밀번호 필수" };

  const todayStr = dateStr(0);
  const now = new Date();
  const todayDatetime = `${todayStr}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;

  const _env = getPoEnv(input.envName);
  const ESCM_ADMIN = _env.admin, ESCM_API = _env.escm;  // 환경별 호스트 (runPo 내 모든 ${ESCM_*} 참조)

  try {
    // 0. 임직원 로그인
    emit("info", `임직원 로그인... (${input.empEmail})`);
    const { token: empToken, emplCode, name } = await empLogin(input.empEmail.trim(), ESCM_ADMIN);
    emit("ok", `✓ 임직원 로그인 — ${name} (${emplCode})`);

    // 1. 발주상품 조회
    emit("info", `[발주그룹 등록] ① 발주상품 조회 (검색어: ${searchWord})`);
    const pgRes = await fetch(
      `${ESCM_ADMIN}/api-purchase/supervisor/v1/purchase-group-management/purchase-goods` +
      `?sort=REG_DESC&limit=50&currentPage=1&searchField=goodsName` +
      `&searchWord=${encodeURIComponent(searchWord)}` +
      `&onlyGoodsCode=false&supplierSearchField=supplierName&dateOptionType=REG&isFolded=false`,
      { method: "GET", headers: empHeaders(empToken) }
    );
    if (!pgRes.ok) throw new Error(`purchase-goods HTTP ${pgRes.status}`);
    const pgJson: any = await pgRes.json();
    const goodsList = pgJson?.result?.data;
    if (!Array.isArray(goodsList) || !goodsList.length) throw new Error("조회된 상품 없음");
    const goodsIds = goodsList.map((g: any) => Number(g.goodsId));
    emit("ok", `✓ 상품 ${goodsIds.length}개 조회 완료`);

    // 2. 입고지/견적 조회
    emit("info", "② 입고지/견적 정보 조회...");
    const gpRes = await fetch(
      `${ESCM_API}/api/v3/goods/purchase` +
      `?sort=REG_DESC&limit=${goodsIds.length}&currentPage=1` +
      `&searchField=goodsName&onlyGoodsCode=false&supplierSearchField=supplierName` +
      `&goodsCodes=&approvalStatus=ORDER&useStatus=Y&isFolded=false&dateType=REG&supplierDealYn=true` +
      `&goodsIds=${encodeURIComponent(goodsIds.join(","))}`,
      { method: "GET", headers: empHeaders(empToken) }
    );
    if (!gpRes.ok) throw new Error(`goods/purchase HTTP ${gpRes.status}`);
    const gpJson: any = await gpRes.json();
    const dataArr = gpJson?.result?.data;
    if (!Array.isArray(dataArr) || !dataArr.length) throw new Error("견적 정보 없음");
    emit("ok", `✓ 견적 정보 ${dataArr.length}개 조회 완료`);

    // 3. payload 조립
    emit("info", `③ payload 조립 (센터: ${selectedCenters.join(", ")})`);
    emit("sub", `입고예정일: ${receivingEstimateDateDisplay}`);
    const items = buildItems(dataArr, selectedCenters, boxQnty, input.skipApplyStock, receivingEstimateDate, input.selectedDockByCenter);

    // 4. 발주그룹 등록
    emit("info", "④ 발주그룹 등록 POST...");
    const postPayload = {
      purchaseGroupCode: "", purchaseGroupName: groupName,
      purchaseCenter: "ALL", purchaseCenterList: selectedCenters, orderType: "NORMAL",
      registrantEmployeeCode: emplCode, registrantName: name,
      merchandiserName: "", merchandiserNames: [], purchaseOrders: [],
      purchaseOrderRegisterItems: items, isReorder: false, approvalStatus: "TEMP",
    };
    const postRes = await fetch(
      `${ESCM_ADMIN}/api-purchase/supervisor/v1/purchase-group-management/purchase-group`,
      { method: "POST", headers: empHeaders(empToken), body: JSON.stringify(postPayload) }
    );
    const postJson: any = await postRes.json().catch(() => ({}));
    if (!postRes.ok) throw new Error(`발주그룹 등록 실패 ${postRes.status} | ${JSON.stringify(postJson).slice(0, 150)}`);
    emit("ok", `✓ 발주그룹 등록 완료 (HTTP ${postRes.status})`);

    // 5. 발주그룹 조회 → ID
    emit("info", "[발주서 생성] ⑤ 발주그룹 조회 (AWAITING_PURCHASE)...");
    await sleep(1500);
    const grpRes = await fetch(
      `${ESCM_ADMIN}/api-purchase/supervisor/v1/purchase-group-management/purchase-group` +
      `?sort=REG_DESC&limit=50&currentPage=1&searchField=purchaseGroupName` +
      `&searchWord=${encodeURIComponent(groupName)}` +
      `&onlyGoodsCode=false&supplierSearchField=supplierName&dateOptionType=REG` +
      `&fromDate=${todayStr}&toDate=${todayStr}&dateFrom=${todayStr}&dateTo=${todayStr}`,
      { method: "GET", headers: empHeaders(empToken) }
    );
    if (!grpRes.ok) throw new Error(`발주그룹 조회 HTTP ${grpRes.status}`);
    const grpJson: any = await grpRes.json();
    const grpRows: any[] = grpJson?.result?.data || [];
    const target = grpRows.find((r) => r.purchaseGroupStatus === "AWAITING_PURCHASE");
    if (!target) throw new Error(`AWAITING_PURCHASE 상태 발주그룹 없음 (조회 ${grpRows.length}개)`);
    const purchaseGroupId = target.purchaseGroupId;
    const purchaseGroupCode = target.purchaseGroupCode;
    emit("ok", `✓ 발주그룹 확인 — ID: ${purchaseGroupId} / CODE: ${purchaseGroupCode}`);

    // 6. 발주서 일괄생성
    emit("info", "⑥ 발주서 일괄생성 (PATCH)...");
    const patchRes = await fetch(
      `${ESCM_ADMIN}/api-purchase/supervisor/v1/purchase-group-management/purchase-group/create-purchase-orders`,
      { method: "PATCH", headers: empHeaders(empToken), body: JSON.stringify([purchaseGroupId]) }
    );
    if (!patchRes.ok) throw new Error(`발주서 일괄생성 HTTP ${patchRes.status}`);
    emit("ok", `✓ 발주서 일괄생성 완료 (HTTP ${patchRes.status})`);
    await sleep(1500);

    // 7. 발주서 조회
    emit("info", "⑦ 발주서 조회 (ID 수집)...");
    const poRes = await fetch(
      `${ESCM_API}/api/v2/purchaseorders` +
      `?sort=PURCHASE_DESC&limit=50&currentPage=1&searchField=purchaseGroupCode` +
      `&searchWord=${encodeURIComponent(purchaseGroupCode)}` +
      `&onlyGoodsCode=false&supplierSearchField=supplierName&goodsCodes=&purchaseOrderCodes=` +
      `&purchaseOrderGroupCodes=&dateType=PURCHASE_ORDER&isFolded=false` +
      `&dateFrom=${todayStr}T00%3A00%3A00&dateTo=${todayStr}T23%3A59%3A59`,
      { method: "GET", headers: empHeaders(empToken) }
    );
    if (!poRes.ok) throw new Error(`발주서 조회 HTTP ${poRes.status}`);
    const poJson: any = await poRes.json();
    const poRows: any[] = poJson?.result?.data || [];
    const purchaseOrderIds = Array.from(new Set(
      poRows.map((r) => r.purchaseOrderId).filter((id) => id != null)
    ));
    if (!purchaseOrderIds.length) throw new Error("발주서 ID 없음");
    emit("ok", `✓ 발주서 ${purchaseOrderIds.length}개 ID 수집`);

    // 8a. 공급사 로그인
    emit("info", `[공급사 로그인] ⑧ 공급사 로그인 (${supLoginId})`);
    const supLoginRes = await fetch(`${ESCM_API}/api/v2/user/login`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json;charset=UTF-8", origin: PARTNER_ORIGIN },
      body: JSON.stringify({ loginId: supLoginId, password: supPassword }),
    });
    if (!supLoginRes.ok) throw new Error(`공급사 로그인 HTTP ${supLoginRes.status}`);
    const supLoginJson: any = await supLoginRes.json();
    const supToken = supLoginJson.token || (supLoginJson.result && supLoginJson.result.token);
    if (!supToken) throw new Error("공급사 토큰 없음");
    emit("ok", "✓ 공급사 로그인 완료");

    // 8b. 발주확정 (건별 GET → PUT)
    emit("info", `[발주확정] 총 ${purchaseOrderIds.length}건`);
    let okCount = 0, failCount = 0;
    for (let i = 0; i < purchaseOrderIds.length; i++) {
      const poId = purchaseOrderIds[i];
      try {
        const detailRes = await fetch(`${ESCM_API}/api/v2/purchaseorders/${poId}`, { method: "GET", headers: supHeaders(supToken) });
        if (!detailRes.ok) throw new Error(`GET HTTP ${detailRes.status}`);
        const detailJson: any = await detailRes.json();
        const body = detailJson?.result;
        if (!body) throw new Error("result 없음");

        body.approvalStatus = "APPROVED";
        body.scheduledArrivalTime = "10:00 ~ 10:59";
        body.isChangedScheduledArrivalTime = true;
        body.modifyExpirationAndManufactureDateYn = true;
        if (Array.isArray(body.purchaseOrderItemDTOList)) {
          body.purchaseOrderItemDTOList = body.purchaseOrderItemDTOList.map((item: any) =>
            Object.assign({}, item, { manufactureDate: todayDatetime, expirationAndManufactureDate: todayDatetime })
          );
        }
        const putRes = await fetch(`${ESCM_API}/api/v2/purchaseorders`, { method: "PUT", headers: supHeaders(supToken), body: JSON.stringify(body) });
        if (!putRes.ok) throw new Error(`PUT HTTP ${putRes.status}`);
        okCount++;
        emit("sub", `✓ [${i + 1}/${purchaseOrderIds.length}] ID ${poId} → HTTP ${putRes.status}`);
      } catch (e2) {
        failCount++;
        emit("warn", `✗ [${i + 1}/${purchaseOrderIds.length}] ID ${poId} 실패: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
    }
    emit("ok", `✓ 발주확정 완료 — 성공 ${okCount}건 / 실패 ${failCount}건`);

    return {
      ok: true, registrantName: name, registrantEmployeeCode: emplCode, groupName,
      purchaseGroupId, purchaseGroupCode, receivingEstimateDate: receivingEstimateDateDisplay,
      purchaseOrderIds, okCount, failCount, total: purchaseOrderIds.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit("err", `❌ 오류: ${msg}`);
    return { ok: false, error: msg };
  }
}
