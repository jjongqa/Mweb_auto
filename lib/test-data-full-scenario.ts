/**
 * End-to-End 시나리오: 상품 생성 → 그 상품으로 주문 (적립금 결제)
 *
 * 흐름:
 *   1. 상품 생성 (1P: createProducts1pBatch / 3P: createProducts3pBatch)
 *   2. 생성된 상품마다 dealProductNo 추출
 *   3. 각 상품으로 주문 1건 생성 (적립금 결제)
 */

import { createProducts1pBatch, type Product1pInput } from "./test-data-product-1p";
import { createProducts3pBatch, resolveDealProductNoFromGoods, type Product3pInput, type ProductType } from "./test-data-product-3p";
import { placeOrderBatch, type OrderCreateInput } from "./test-data-order";
import { runFull3pDelivery } from "./test-data-3p-delivery";
import { produce1pDelivery } from "./test-data-1p-delivery";

export type ProductFlavor = "1P" | "3P";

export interface FullScenarioInput {
  flavor: ProductFlavor;
  // 주문 — 게이트웨이 + memberNo (쿠키리스). 기본 배송지·센터코드 자동 조회.
  memberNo: number | string;   // 필수 — 주문 인증 (X-KURLY-MEMBER-NO)
  // 1P 옵션
  lacmsEmail?: string;
  lacmsPassword?: string;
  basePrice?: number;
  stockQuantity?: number;
  // 3P 옵션
  openapiAccessToken?: string;
  adminId?: string;
  adminPw?: string;
  productType3p?: ProductType;
  // 공통
  count: number;
  namePrefix?: string;
  // 주문 옵션
  paymentGatewayId?: string;
  usingFreePoint?: number;
  centerCode?: string;
  quantity?: number;
  ordersPerProduct?: number;   // 각 상품당 주문 횟수 (동일 상품 N회 주문). default 1
  receiverName?: string;
  receiverPhoneNumber?: string;
  address?: string;
  addressDetail?: string;
  zipCode?: string;
  memo?: string;
  // 주문 직후 배송완료까지 자동 처리. 3P=발주확인→발송처리→배송완료(TRACE), 1P=주문완료→Kafka(BOX-TRACKING) 배송완료.
  markDelivered?: boolean;
}

export interface FullScenarioStep {
  type: "phase" | "product";
  phase?: "PRODUCT" | "ORDER" | "DELIVERED";
  productIndex?: number;
  ok: boolean;
  message: string;
}

export interface FullScenarioResult {
  index: number;
  orderSeq?: number;            // 같은 상품의 몇 번째 주문 (N회 주문 시)
  productOk: boolean;
  masterCode?: string | null;
  contentsNo?: string | number | null;
  partnerProductNo?: string | null;
  dealProductNo?: string | number | null;
  contentsRawData?: any;
  productError?: string;
  orderOk?: boolean;
  groupOrderNo?: string | number | null;
  paymentToken?: string | null;
  orderRawResponse?: any;
  orderError?: string;
  delivered?: boolean;              // 3P 배송완료 처리 성공(발주확인·발송처리·TRACE 발행 모두)
  deliveryConfirmed?: boolean;      // PARTNER3P DB 배송완료 실제 반영 확인 (best-effort, undefined=확인불가)
  deliveryError?: string;
}

export async function runFullScenario(
  input: FullScenarioInput,
  onProgress?: (e: FullScenarioStep) => void
): Promise<FullScenarioResult[]> {
  const emit = (e: FullScenarioStep) => onProgress?.(e);
  const total = Math.max(1, Math.min(20, input.count | 0 || 1));
  const ordersPer = Math.max(1, Math.min(50, input.ordersPerProduct ?? 1));
  const productRows: FullScenarioResult[] = [];

  // ============== 1단계: 상품 생성 ==============
  emit({ type: "phase", phase: "PRODUCT", ok: true, message: `${input.flavor} 상품 ${total}건 생성 시작` });

  if (input.flavor === "1P") {
    if (!input.lacmsEmail || !input.lacmsPassword) {
      throw new Error("1P: lacms 이메일/패스워드 필수");
    }
    const p1Input: Product1pInput = {
      lacmsEmail: input.lacmsEmail,
      lacmsPassword: input.lacmsPassword,
      count: total,
      namePrefix: input.namePrefix ?? "QA자동화상품",
      basePrice: input.basePrice ?? 5000,
      storageType: "AMBIENT_TEMPERATURE",
      stockQuantity: input.stockQuantity ?? 10000,
      doMaster: true,
      doContents: true,
      doStock: true,
      doDisplay: true,
    };
    const productResults = await createProducts1pBatch(p1Input, (e) => {
      emit({
        type: e.type === "product" ? "product" : "phase",
        phase: "PRODUCT",
        productIndex: e.productIndex,
        ok: e.ok,
        message: e.message,
      });
    });
    for (const pr of productResults) {
      productRows.push({
        index: pr.index,
        productOk: !pr.error && !!pr.masterCode,
        masterCode: pr.masterCode,
        contentsNo: pr.contentsNo,
        dealProductNo: pr.dealProductNo,
        contentsRawData: pr.contentsRawData,
        productError: pr.error,
      });
    }
  } else {
    // 3P
    if (!input.openapiAccessToken || !input.adminId || !input.adminPw) {
      throw new Error("3P: OpenAPI 토큰 + 어드민 ID/PW 필수");
    }
    const p3Input: Product3pInput = {
      openapiBase: "https://third-party-external-api.stg.kurly.com",
      adminHost: "https://third-party-partner-gateway.stg.kurly.com",
      cmsHost: "https://gateway.cloud.stg.kurly.services",
      accessToken: input.openapiAccessToken,
      adminId: input.adminId,
      adminPw: input.adminPw,
      cmsUsername: input.lacmsEmail,
      cmsPassword: input.lacmsPassword,
      productType: input.productType3p ?? "NORMAL_PARCEL",
      count: total,
      includeLacms: !!(input.lacmsEmail && input.lacmsPassword),
      doDisplay: true,
      doStock: true,
    };
    const r3 = await createProducts3pBatch(p3Input, (e) => {
      emit({
        type: e.type === "product" ? "product" : "phase",
        phase: "PRODUCT",
        productIndex: e.productIndex,
        ok: e.ok,
        message: e.message,
      });
    });
    for (const pr of r3.results) {
      productRows.push({
        index: pr.index,
        productOk: pr.approved,
        partnerProductNo: pr.partnerProductNo,
        // 3P 응답에서 dealProductNo 위치가 다양해 step6 검색에서 여러 후보 키로 추출 시도.
        // 그래도 못 찾으면 contentsRawData 에 응답 일부 + 키 목록 보존 → UI raw 패널 / 다음 fix 단서.
        dealProductNo: pr.dealProductNo ?? null,
        contentsRawData: pr.dealProductNo == null && (pr.searchRawSample || pr.searchRawTopKeys)
          ? { topKeys: pr.searchRawTopKeys, sample: pr.searchRawSample }
          : undefined,
        productError: pr.error,
      });
    }
  }

  // ============== 2단계: 주문 생성 (성공한 상품만) — 상품당 ordersPer 회 ==============
  emit({ type: "phase", phase: "ORDER", ok: true, message: `주문 생성 시작 (적립금 결제)${ordersPer > 1 ? ` · 상품당 ${ordersPer}회` : ""}` });

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
  const results: FullScenarioResult[] = [];   // 주문 1건당 한 행 (N회 주문이면 상품당 N행)
  const productFields = (p: FullScenarioResult) => ({
    index: p.index, productOk: p.productOk, masterCode: p.masterCode, contentsNo: p.contentsNo,
    partnerProductNo: p.partnerProductNo, dealProductNo: p.dealProductNo,
    contentsRawData: p.contentsRawData, productError: p.productError,
  });

  for (const p of productRows) {
    if (!p.productOk || !p.dealProductNo) {
      const skipMsg = !p.productOk
        ? "상품 생성 실패로 주문 스킵"
        : (() => {
            const dbg = (p.contentsRawData as { topKeys?: string[] } | undefined);
            const keysMsg = dbg?.topKeys?.length ? ` / 응답 키: ${dbg.topKeys.slice(0, 10).join(", ")}` : "";
            return `dealProductNo 추출 실패로 주문 스킵${keysMsg}`;
          })();
      results.push({ ...productFields(p), orderSeq: 1, orderError: skipMsg });
      emit({ type: "product", phase: "ORDER", productIndex: p.index, ok: false, message: `[#${p.index}] 주문 스킵: ${skipMsg}` });
      continue;
    }

    // 3P: 컨텐츠코드 → 진짜 딜코드 변환 (상품당 1회만, 전시→goods 반영 대기 폴링).
    let orderDealNo: number | string = p.dealProductNo!;
    if (input.flavor === "3P") {
      const MAX_TRY = 12;  // 7초 × 12 ≈ 84초 (성공 시 조기 종료)
      let resolved = await resolveDealProductNoFromGoods(p.dealProductNo!);
      for (let a = 1; !resolved.dealProductNo && a <= MAX_TRY; a++) {
        emit({ type: "product", phase: "ORDER", productIndex: p.index, ok: true,
          message: `[#${p.index}] 딜코드 변환 대기 ${a}/${MAX_TRY} (전시→goods 반영 ~7초)…` });
        await sleep(7000);
        resolved = await resolveDealProductNoFromGoods(p.dealProductNo!);
      }
      if (resolved.dealProductNo) {
        orderDealNo = resolved.dealProductNo;
        emit({ type: "product", phase: "ORDER", productIndex: p.index, ok: true,
          message: `[#${p.index}] 딜코드 변환 ${p.dealProductNo}(컨텐츠) → ${resolved.dealProductNo}(딜)${resolved.deals && resolved.deals.length > 1 ? ` · 옵션 ${resolved.deals.length}개 중 첫번째` : ""}` });
      } else {
        const errMsg = `딜코드 변환 실패(goods 미반영): ${resolved.error}`;
        emit({ type: "product", phase: "ORDER", productIndex: p.index, ok: false,
          message: `[#${p.index}] 딜코드 변환 실패(${resolved.error}) — 전시 반영이 ${MAX_TRY * 7}초 내 안 됨. 잠시 후 재실행 권장` });
        results.push({ ...productFields(p), orderSeq: 1, orderError: errMsg });
        continue;
      }
    }

    // 같은 상품을 ordersPer 회 주문 (적립금 전액 결제는 order lib 가 결제예정금액으로 자동 산정).
    const quantity = input.quantity ?? 1;
    for (let k = 1; k <= ordersPer; k++) {
      const tag = ordersPer > 1 ? `${p.index}-${k}` : `${p.index}`;
      const orderInput: OrderCreateInput = {
        memberNo: input.memberNo,
        dealProductNo: orderDealNo,
        count: 1,
        quantity,
        paymentGatewayId: input.paymentGatewayId,
        receiverName: input.receiverName,
        receiverPhoneNumber: input.receiverPhoneNumber,
        address: input.address,
        addressDetail: input.addressDetail,
        zipCode: input.zipCode,
        clusterCenterCode: input.centerCode,
        memo: input.memo,
      };
      const orderResults = await placeOrderBatch(orderInput, () => {});
      const o = orderResults[0];
      const row: FullScenarioResult = {
        ...productFields(p),
        orderSeq: k,
        orderOk: o.ok,
        groupOrderNo: o.groupOrderNo,
        orderRawResponse: o.rawResponse,
        orderError: o.error,
      };
      emit({ type: "product", phase: "ORDER", productIndex: p.index, ok: o.ok,
        message: o.ok ? `[#${tag}] 주문 성공 groupOrderNo=${o.groupOrderNo}` : `[#${tag}] 주문 실패: ${o.error}` });

      // ===== 3단계(선택): 배송완료 자동 처리 — 주문 1건마다 =====
      if (input.markDelivered && o.ok && o.groupOrderNo != null) {
        if (input.flavor === "3P") {
          // 3P: 발주확인 → 발송처리 → 배송완료(TRACE). OpenAPI 토큰, 일반(택배)만 발송처리 가능.
          emit({ type: "product", phase: "DELIVERED", productIndex: p.index, ok: true,
            message: `[#${tag}] 배송 처리 시작 (발주확인→발송처리→배송완료, 대표 ${o.groupOrderNo})` });
          const fd = await runFull3pDelivery(o.groupOrderNo, input.openapiAccessToken!, {
            onProgress: (msg, ok) => emit({ type: "product", phase: "DELIVERED", productIndex: p.index, ok, message: `[#${tag}] ${msg}` }),
          });
          row.delivered = fd.ok;
          row.deliveryConfirmed = fd.deliveryConfirmed;
          if (!fd.ok) row.deliveryError = fd.error ?? "배송 처리 일부 실패";
          const confirmNote = fd.deliveryConfirmed === true ? " — DB 반영 확인됨 ✅"
            : fd.deliveryConfirmed === false ? " — 발행 OK(DB 반영 지연 가능, la-cms 확인)"
            : " — 컬리몰·la-cms 반영";
          emit({ type: "product", phase: "DELIVERED", productIndex: p.index, ok: fd.ok,
            message: fd.ok ? `[#${tag}] ✅ 배송완료까지 처리 완료${confirmNote}` : `[#${tag}] 배송 처리 실패: ${row.deliveryError}` });
        } else {
          // 1P: 대표주문번호로 Kafka(MSG-OMS-KURLY-BOX-TRACKING) 배송완료 한 방.
          emit({ type: "product", phase: "DELIVERED", productIndex: p.index, ok: true,
            message: `[#${tag}] 배송완료 처리 (Kafka, 대표 ${o.groupOrderNo})` });
          const r1 = await produce1pDelivery({ parentOrderNo: o.groupOrderNo, status: "DELIVERED" });
          row.delivered = r1.ok;
          if (!r1.ok) row.deliveryError = r1.error ?? "배송완료 발행 실패";
          emit({ type: "product", phase: "DELIVERED", productIndex: p.index, ok: r1.ok,
            message: r1.ok ? `[#${tag}] ✅ 배송완료 Kafka 발행 완료 (컬리몰 수 초 내 반영)` : `[#${tag}] 배송완료 발행 실패: ${row.deliveryError}` });
        }
      }

      results.push(row);
    }
  }

  return results;
}
