// 3P 상품 유형 라벨↔enum (3P 상품 등록 폼과 동일). 클라/서버 공용 — 순수 상수(서버 의존 없음).
import type { ProductType } from "./test-data-product-3p";

export const THREEP_TYPES: { value: ProductType; label: string }[] = [
  { value: "NORMAL_PARCEL", label: "일반(택배)" },
  { value: "KURLY_PARCEL", label: "컬리배송(샛별)" },
  { value: "KURLY_PARCEL_LIQUOR", label: "컬리배송(주류)" },
  { value: "INSTALLATION_DELIVERY", label: "설치배송" },
  { value: "GOURMET_DELIVERY", label: "미식딜리버리" },
  { value: "QUICK_DELIVERY", label: "퀵배송" },
  { value: "ACCOMMODATION", label: "숙박" },
  { value: "AIRLINE_TICKET", label: "항공권" },
  { value: "ONLINE_TICKET", label: "온라인 티켓" },
  { value: "SELF_PICKUP_WINE", label: "셀프픽업 (와인)" },
];

export const THREEP_LABEL: Record<string, string> = Object.fromEntries(THREEP_TYPES.map((t) => [t.value, t.label]));

// 혼합 주문에서 허용하는 3P 유형 — 일반(택배)/컬리배송(샛별·주류)만.
// (설치·미식·퀵·숙박·항공·온라인티켓·셀프픽업은 카트/주문서 진입이 안 맞아 제외)
export const MIXED_ORDER_3P_TYPES = THREEP_TYPES.filter((t) =>
  (["NORMAL_PARCEL", "KURLY_PARCEL", "KURLY_PARCEL_LIQUOR"] as ProductType[]).includes(t.value)
);

// 배송완료 자동화(발주확인→발송처리→배송완료) 가능 유형 — 발송처리가 일반택배 배치라 NORMAL_PARCEL 만.
export const DELIVERABLE_3P_TYPES: ProductType[] = ["NORMAL_PARCEL"];
