// 3P 파트너오피스 OpenAPI 카탈로그 — third-party-external-api.stg.kurly.com/docs 에서 추출(56개).
// 자동 추출(워크플로우) + destructive 보정. OpenAPI 콘솔(/test-data/3p-console)이 소비.
// 인증: 모든 호출 Authorization: Bearer <accessToken>. 토큰은 _stg-defaults(STG_OPENAPI_ACCESS_TOKEN) 단일 소스.

export const OPENAPI_BASE = "https://third-party-external-api.stg.kurly.com";

export interface ThreePParam {
  name: string;
  required?: boolean;
  example?: string;
  desc?: string;
}

export interface ThreePOp {
  id: string;                         // `${method}:${path}` — 고유
  group: string;                      // 공통/상품/주문/배송/취소/반품/픽업
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;                       // /open-api/v1/... ({id} 플레이스홀더)
  pathParams: ThreePParam[];
  queryParams: ThreePParam[];
  requestBodyExample: string;         // write 계열만, 트림된 예시
  category: "read" | "write";
  destructive: boolean;              // 삭제·강제취소·취소완료/거절 → 빨간 경고
  supported: boolean;                 // false=콘솔 미지원(예: multipart 파일업로드)
  notes: string;
  dedicatedTool?: { href: string; label: string }; // 콘솔 대신 쓸 전용 도구(있으면)
  editLoadFrom?: { path: string; idParam: string; keepKeys: string[]; mode?: string; label?: string }; // 본문 prefill(상세조회). mode: copyKeys(기본)=현재 값 복사 / stockSkeleton=재고 옵션 골격
  // '주문 담기' — order-sheets에서 대상 상태 주문 다중선택 → 본문 배열(orderItemNos/reservations/invoices) 생성
  bodyPicker?: { orderStatus: string; arrayKey: string; itemShape: "id" | "object"; itemTemplate?: Record<string, string>; label: string };
}

export const THREEP_CATALOG: ThreePOp[] = [
  {
    "id": "POST:/open-api/v1/files/upload",
    "group": "공통",
    "name": "파일 업로드",
    "method": "POST",
    "path": "/open-api/v1/files/upload",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "multipart/form-data; file=@test.png (Content-Type: image/png)",
    "category": "write",
    "destructive": false,
    "supported": false,
    "notes": "png/jpg/jpeg, 파일명 최대 100자, 5MB 이하. 본문은 multipart 파일 파트(file)"
  },
  {
    "id": "GET:/open-api/v1/partner-products/couriers",
    "group": "공통",
    "name": "배송사 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/partner-products/couriers",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "GET:/open-api/v1/partner-products/store-addresses",
    "group": "공통",
    "name": "파트너사 출고지 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/partner-products/store-addresses",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "GET:/open-api/v1/partner-stores/return-shipping-addresses",
    "group": "공통",
    "name": "파트너사 반품지 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/partner-stores/return-shipping-addresses",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "클레임 프로젝트. 반품배송비 미설정 시 returnShippingCost null 반환"
  },
  {
    "id": "GET:/open-api/v1/orders/{orderItemNo}/detail",
    "group": "공통",
    "name": "상품주문정보 조회",
    "method": "GET",
    "path": "/open-api/v1/orders/{orderItemNo}/detail",
    "pathParams": [
      {
        "name": "orderItemNo",
        "example": "3542",
        "desc": "주문상품번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "3p 주문번호 하위의 주문 정보 조회. 응답에 주문상태(NEW_ORDER/READY_FOR_SHIPMENT/IN_TRANSIT/DELIVERED 등) 포함"
  },
  {
    "id": "GET:/open-api/v2/orders/{orderItemNo}/detail",
    "group": "공통",
    "name": "상품주문정보 조회 V2",
    "method": "GET",
    "path": "/open-api/v2/orders/{orderItemNo}/detail",
    "pathParams": [
      {
        "name": "orderItemNo",
        "example": "3542",
        "desc": "주문상품번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "V1 대비 회원번호(memberNo) 추가"
  },
  {
    "id": "GET:/open-api/v3/orders/{orderItemNo}/detail",
    "group": "공통",
    "name": "상품주문정보 조회 V3",
    "method": "GET",
    "path": "/open-api/v3/orders/{orderItemNo}/detail",
    "pathParams": [
      {
        "name": "orderItemNo",
        "example": "3542",
        "desc": "주문상품번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "V2 대비 수취인 정보(Receiver) 추가. 주문자명/ID/연락처 포함"
  },
  {
    "id": "GET:/open-api/v1/cmds-product-categories",
    "group": "상품",
    "name": "분류 카테고리 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/cmds-product-categories",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "⚠ STG 서버 500(S500 내부오류) 응답 중 — 2026-06 실측. 컬리 담당자 문의 필요(콘솔/토큰 문제 아님)"
  },
  {
    "id": "GET:/open-api/v1/cmds-product-categories/{categoryId}",
    "group": "상품",
    "name": "분류 카테고리 하위 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/cmds-product-categories/{categoryId}",
    "pathParams": [
      {
        "name": "categoryId",
        "example": "3",
        "desc": "카테고리 식별번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "GET:/open-api/v1/merchandisers",
    "group": "상품",
    "name": "MD 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/merchandisers",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "GET:/open-api/v1/codes/notice-templates",
    "group": "상품",
    "name": "상품고시등록정보 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/codes/notice-templates",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "Origin: 3p-internal 헤더 사용"
  },
  {
    "id": "GET:/open-api/v1/codes/notice-templates/{templateId}",
    "group": "상품",
    "name": "상품고시등록정보 하위 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/codes/notice-templates/{templateId}",
    "pathParams": [
      {
        "name": "templateId",
        "example": "624e770f8d62d962dc3df428",
        "desc": "고시 템플릿 식별번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "Origin: 3p-internal 헤더 사용"
  },
  {
    "id": "GET:/open-api/v1/codes/sale-restriction-area",
    "group": "상품",
    "name": "판매제한지역 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/codes/sale-restriction-area",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "GET:/open-api/v1/product/category-notice-policies",
    "group": "상품",
    "name": "카테고리별 강제 상품정보제공고시 템플릿 매핑 조회",
    "method": "GET",
    "path": "/open-api/v1/product/category-notice-policies",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "응답 캐시화, 1시간 주기 갱신. 매핑된 카테고리는 해당 templateId 외 사용 불가"
  },
  {
    "id": "GET:/open-api/v1/partner-stores/after-sale-service-templates",
    "group": "상품",
    "name": "A/S 템플릿 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/partner-stores/after-sale-service-templates",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "POST:/open-api/v1/partner-products",
    "group": "상품",
    "name": "상품 등록",
    "method": "POST",
    "path": "/open-api/v1/partner-products",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "{\n  \"namespace\": {\n    \"name\": \"허니몬 마켓 상품A\",\n    \"description\": \"2023 힙 아이템\",\n    \"searchTexts\": \"허니몬마켓,상품A,2023,힙,아이템,컬리\"\n  },\n  \"base\": {\n    \"categoryIds\": [2, 3, 4, 5, 6],\n    \"mainCategoryId\": 3,\n    \"productDivisionType\": \"NORMAL_PARCEL\",\n    \"mdNo\": 1234,\n    \"commissionRate\": 0.01\n  },\n  \"meta\": {\n    \"manufacturer\": \"허니몬 마켓\",\n    \"originType\": \"REFERENCE_PRODUCT_DETAIL\",\n    \"minorSaleApprovalType\": \"APPROVAL\",\n    \"storageTemperatureType\": \"ETC\",\n    \"brandId\": 1\n  },\n  \"sale\": {\n    \"saleCompletionType\": \"MANUAL\",\n    \"taxType\": \"FREE\",\n    \"saleMinQuantity\": 1,\n    \"saleMaxQuantity\": 100\n  },\n  \"detail\": { \"optionType\": \"MULTI\", \"imageUseType\": \"USE_REPRESENT\", \"detailOptions\": [] }\n}",
    "category": "write",
    "destructive": false,
    "supported": false,
    "notes": "본문 방대 + 선행 데이터(카테고리 전체경로 categoryFullPath·업로드 이미지 fileId·KC인증·옵션 등) 필요 → 콘솔로 직접 호출 부적합. 전용 도구가 출고지·반품지·이미지·카테고리·승인까지 자동 처리.",
    "dedicatedTool": { "href": "/test-data/product", "label": "상품 등록 도구로" }
  },
  {
    "id": "PUT:/open-api/v1/partner-products/{partnerProductId}/request-update",
    "group": "상품",
    "name": "상품 수정",
    "method": "PUT",
    "path": "/open-api/v1/partner-products/{partnerProductId}/request-update",
    "pathParams": [
      {
        "name": "partnerProductId",
        "example": "9223372036854775807",
        "desc": "파트너상품 번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "{\n  \"namespace\": {\n    \"name\": \"허니몬 마켓 상품A-updated\",\n    \"description\": \"2023 힙 아이템-updated\",\n    \"searchTexts\": \"허니몬마켓,상품A,2023,힙,아이템,컬리\"\n  },\n  \"base\": {\n    \"categoryIds\": [2, 3, 14, 15, 16],\n    \"mainCategoryId\": 3,\n    \"productDivisionType\": \"NORMAL_PARCEL\",\n    \"mdNo\": 12345,\n    \"commissionRate\": 0.02\n  },\n  \"meta\": {\n    \"manufacturer\": \"허니몬 마켓 2nd\",\n    \"originType\": \"REFERENCE_PRODUCT_DETAIL\",\n    \"minorSaleApprovalType\": \"APPROVAL\",\n    \"storageTemperatureType\": \"ETC\",\n    \"brandId\": 1\n  },\n  \"sale\": {\n    \"saleCompletionType\": \"MANUAL\",\n    \"taxType\": \"FREE\",\n    \"saleMinQuantity\": 1,\n    \"saleMaxQuantity\": 100\n  },\n  \"detail\": { \"optionType\": \"SINGLE\", \"imageUseType\": \"USE_REPRESENT\", \"detailOptions\": [] }\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "수정요청 본문 = 등록과 동일 DTO. partnerProductId 넣고 '현재 값 불러오기'로 상세조회 결과를 본문에 채운 뒤, 원하는 값만 고쳐 PUT 하세요. (수정요청 → 승인 절차)",
    "editLoadFrom": { "path": "/open-api/v1/partner-products/{partnerProductId}", "idParam": "partnerProductId", "keepKeys": ["namespace", "base", "meta", "sale", "detail", "notice", "delivery", "afterSaleService"] }
  },
  {
    "id": "GET:/open-api/v1/partner-products/{partnerProductId}",
    "group": "상품",
    "name": "상품 상세 조회",
    "method": "GET",
    "path": "/open-api/v1/partner-products/{partnerProductId}",
    "pathParams": [
      {
        "name": "partnerProductId",
        "example": "2",
        "desc": "파트너상품 번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "GET:/open-api/v1/partner-products",
    "group": "상품",
    "name": "상품 목록 조회",
    "method": "GET",
    "path": "/open-api/v1/partner-products",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": false,
        "example": "0",
        "desc": "페이징 요청번호 (default: 0)"
      },
      {
        "name": "size",
        "required": false,
        "example": "20",
        "desc": "페이징 크기 (default: 20)"
      },
      {
        "name": "searchType",
        "required": false,
        "example": "PRODUCT_NO",
        "desc": "검색어 타입 (PRODUCT_ID/PRODUCT_NO/SELLER_PRODUCT_CODE/MASTER_PRODUCT_CODE/CONTENTS_PRODUCT_CODE/DEAL_PRODUCT_CODE)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "",
        "desc": "검색어 텍스트"
      },
      {
        "name": "keywordSearchType",
        "required": false,
        "example": "PRODUCT_NAME",
        "desc": "키워드 검색 타입 (PRODUCT_NAME/OPTION_NAME/MANUFACTURER)"
      },
      {
        "name": "keywordText",
        "required": false,
        "example": "상품명",
        "desc": "키워드 텍스트"
      },
      {
        "name": "saleStatusList",
        "required": false,
        "example": "SALE_PENDING,SALE,SALE_PAUSE,SALE_BAN,SOLD_OUT",
        "desc": "판매상태 타입(복수) (SALE_PENDING/SALE/SALE_PAUSE/SALE_BAN/SOLD_OUT/SALE_DISCONTINUED)"
      },
      {
        "name": "statusList",
        "required": false,
        "example": "",
        "desc": "승인상태 타입(복수) (ALL/REQUESTED_APPROVAL/REQUESTED_UPDATE/APPROVED/APPROVED_UPDATE/REJECTED/REJECTED_UPDATE)"
      },
      {
        "name": "categorySearchType",
        "required": false,
        "example": "",
        "desc": "카테고리 검색 타입 (MAIN_CATEGORY_NO/MIDDLE_CATEGORY_NO/SUB_CATEGORY_NO/DETAIL_CATEGORY_NO)"
      },
      {
        "name": "categoryId",
        "required": false,
        "example": "",
        "desc": "카테고리 식별번호"
      },
      {
        "name": "periodSearchType",
        "required": false,
        "example": "PRODUCT_REG_DATE",
        "desc": "기간 검색 타입"
      },
      {
        "name": "searchStartDate",
        "required": false,
        "example": "2023-02-01",
        "desc": "검색 시작일"
      },
      {
        "name": "searchEndDate",
        "required": false,
        "example": "2023-02-12",
        "desc": "검색 종료일"
      },
      {
        "name": "sortSearchType",
        "required": false,
        "example": "MODIFIED_AT",
        "desc": "정렬 타입"
      },
      {
        "name": "deliveryAttributeSearchType",
        "required": false,
        "example": "EXPRESS_DELIVERY",
        "desc": "배송속성 검색 타입"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "PUT:/open-api/v1/partner-products/bulk-change-sale-status",
    "group": "상품",
    "name": "파트너상품 판매상태 일괄변경",
    "method": "PUT",
    "path": "/open-api/v1/partner-products/bulk-change-sale-status",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "{\n  \"partnerProductIds\" : [ 1, 2, 3 ],\n  \"saleStatus\" : \"SALE_PAUSE\"\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "판매상태는 SALE/SALE_PAUSE만 허용. 미지원 카테고리 상품은 변경 실패(failDetails 반환)"
  },
  {
    "id": "PUT:/open-api/v1/partner-products/{partnerProductId}/stock",
    "group": "상품",
    "name": "파트너상품 재고 일괄변경",
    "method": "PUT",
    "path": "/open-api/v1/partner-products/{partnerProductId}/stock",
    "pathParams": [
      {
        "name": "partnerProductId",
        "example": "123",
        "desc": "파트너상품 식별번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "{\n  \"quantities\" : [ {\n    \"detailOptionId\" : 63967,\n    \"operationQuantity\" : -1\n  }, {\n    \"detailOptionId\" : 63965,\n    \"operationQuantity\" : 5\n  } ]\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "operationQuantity는 증감분(0 이외 값만, 0 입력 불가). 예시 본문의 detailOptionId는 placeholder — partnerProductId 넣고 '옵션 불러오기'로 이 상품의 실제 옵션 id를 채운 뒤 증감분만 입력하세요.",
    "editLoadFrom": { "path": "/open-api/v1/partner-products/{partnerProductId}", "idParam": "partnerProductId", "keepKeys": [], "mode": "stockSkeleton", "label": "옵션 불러오기" }
  },
  {
    "id": "DELETE:/open-api/v1/partner-products/{partnerProductId}",
    "group": "상품",
    "name": "파트너상품 삭제",
    "method": "DELETE",
    "path": "/open-api/v1/partner-products/{partnerProductId}",
    "pathParams": [
      {
        "name": "partnerProductId",
        "example": "123",
        "desc": "파트너상품 식별번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "write",
    "destructive": true,
    "supported": true,
    "notes": "삭제는 되돌릴 수 없음"
  },
  {
    "id": "GET:/open-api/v1/partner-products/brands/{brandId}",
    "group": "상품",
    "name": "브랜드 상세 조회",
    "method": "GET",
    "path": "/open-api/v1/partner-products/brands/{brandId}",
    "pathParams": [
      {
        "name": "brandId",
        "example": "2",
        "desc": "브랜드 번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "GET:/open-api/v2/partner-products/brands",
    "group": "상품",
    "name": "브랜드 검색",
    "method": "GET",
    "path": "/open-api/v2/partner-products/brands",
    "pathParams": [],
    "queryParams": [
      {
        "name": "cursor",
        "required": false,
        "example": "2.2256:6100",
        "desc": "커서 페이징 요청 값 (초기엔 미제공/빈값, 이후 응답의 nextCursor 사용)"
      },
      {
        "name": "size",
        "required": false,
        "example": "3",
        "desc": "커서 페이징 크기 (default: 200)"
      },
      {
        "name": "brandKeyword",
        "required": false,
        "example": "브랜드",
        "desc": "브랜드 검색어"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "v2 경로. 커서 페이지네이션(nextCursor/hasNext 활용), 동일 size·검색조건 유지 필요"
  },
  {
    "id": "GET:/open-api/v1/orders",
    "group": "주문",
    "name": "주문통합검색 목록조회",
    "method": "GET",
    "path": "/open-api/v1/orders",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": true,
        "example": "0",
        "desc": "페이징 요청번호"
      },
      {
        "name": "size",
        "required": true,
        "example": "50",
        "desc": "페이징 크기"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "productDivisionType",
        "required": true,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입(ALL/NORMAL_PARCEL/ACCOMMODATION/INSTALLATION_DELIVERY/ONLINE_TICKET/AIRLINE_TICKET/SELF_PICKUP_WINE/KURLY_PARCEL/KURLY_PARCEL_LIQUOR/GOURMET_DELIVERY/QUICK_DELIVERY/KURLY_NOW/INTEGRATION)"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "장소ID"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "요청받은 파트너 스토어 기준 조회. Origin: 3p-internal"
  },
  {
    "id": "GET:/open-api/v1/orders/excel",
    "group": "주문",
    "name": "주문통합검색 엑셀다운로드",
    "method": "GET",
    "path": "/open-api/v1/orders/excel",
    "pathParams": [],
    "queryParams": [
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "productDivisionType",
        "required": true,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입(ALL/NORMAL_PARCEL/ACCOMMODATION 등)"
      },
      {
        "name": "fileName",
        "required": true,
        "example": "20230330_와인주문데이터",
        "desc": "엑셀 파일명"
      },
      {
        "name": "password",
        "required": true,
        "example": "q123456789",
        "desc": "엑셀 파일 비밀번호"
      },
      {
        "name": "downloadReason",
        "required": true,
        "example": "오늘의 주문 데이터 확인",
        "desc": "다운로드 사유"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "장소ID"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "목록조회와 동일 검색기준으로 엑셀 다운로드. fileName/password/downloadReason 필수"
  },
  {
    "id": "GET:/open-api/v1/order-sheets",
    "group": "주문",
    "name": "발주(주문)확인/발송관리 주문목록 조회",
    "method": "GET",
    "path": "/open-api/v1/order-sheets",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": true,
        "example": "0",
        "desc": "페이징 요청번호"
      },
      {
        "name": "size",
        "required": true,
        "example": "50",
        "desc": "페이징 크기"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "orderStatusSearchType",
        "required": true,
        "example": "ALL",
        "desc": "주문상태(ALL/NEW_ORDER(신규주문)/CONFIRMED_ORDER(발주확인)). 실측상 필수"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "productDivisionType",
        "required": false,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입(ALL/NORMAL_PARCEL/ACCOMMODATION/INSTALLATION_DELIVERY/ONLINE_TICKET 등)"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "장소ID"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "발주/발송정보 조회. 실측 필수값: searchType·orderStatusSearchType. 조회기간(searchStartAt~searchEndAt)은 3개월 이내만 허용"
  },
  {
    "id": "GET:/open-api/v1/order-sheets/excel",
    "group": "주문",
    "name": "발주(주문)확인/발송관리 엑셀다운로드",
    "method": "GET",
    "path": "/open-api/v1/order-sheets/excel",
    "pathParams": [],
    "queryParams": [
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "orderStatusSearchType",
        "required": true,
        "example": "CONFIRMED_ORDER",
        "desc": "주문상태(ALL/NEW_ORDER(신규주문)/CONFIRMED_ORDER(발주확인))"
      },
      {
        "name": "fileName",
        "required": true,
        "example": "20230330_와인주문데이터",
        "desc": "엑셀 파일명"
      },
      {
        "name": "password",
        "required": true,
        "example": "q123456789",
        "desc": "엑셀 파일 비밀번호"
      },
      {
        "name": "downloadReason",
        "required": true,
        "example": "오늘의 주문 데이터 확인",
        "desc": "다운로드 사유"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "productDivisionType",
        "required": false,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "장소ID"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹"
      },
      {
        "name": "expressDeliveryClassSearchType",
        "required": false,
        "example": "EXPRESS_DELIVERY",
        "desc": "빠른배송 구분 검색 타입"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "발주확인/발송관리 목록조회와 동일 검색기준으로 엑셀 다운로드. fileName/password/downloadReason 필수"
  },
  {
    "id": "PUT:/open-api/v1/order-sheets/preparing-delivery",
    "group": "주문",
    "name": "발주확인처리",
    "method": "PUT",
    "path": "/open-api/v1/order-sheets/preparing-delivery",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "{\n  \"orderItemNos\" : [ 398, 399, 400 ]\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "주문완료 → 배송준비중으로 상태 변경. 주문완료 상태 주문상품 필요",
    "bodyPicker": { "orderStatus": "NEW_ORDER", "arrayKey": "orderItemNos", "itemShape": "id", "label": "주문완료 주문 담기 (→ 배송준비중)" }
  },
  {
    "id": "PUT:/open-api/v1/order-sheets/confirmed-reservation",
    "group": "주문",
    "name": "예약확정처리",
    "method": "PUT",
    "path": "/open-api/v1/order-sheets/confirmed-reservation",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "{\n  \"reservations\" : [ {\n    \"orderItemNo\" : 398,\n    \"reservationDate\" : \"2026-06-21\"\n  }, {\n    \"orderItemNo\" : 399,\n    \"reservationDate\" : \"2026-06-21\"\n  } ]\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "주문완료 → 배송준비중으로 상태 변경. reservationDate 형식 yyyy-MM-dd",
    "bodyPicker": { "orderStatus": "NEW_ORDER", "arrayKey": "reservations", "itemShape": "object", "itemTemplate": { "reservationDate": "" }, "label": "주문완료 주문 담기 (예약확정)" }
  },
  {
    "id": "GET:/open-api/v1/confirmed-orders",
    "group": "주문",
    "name": "구매확정내역 주문목록 조회",
    "method": "GET",
    "path": "/open-api/v1/confirmed-orders",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": true,
        "example": "0",
        "desc": "페이징 요청번호"
      },
      {
        "name": "size",
        "required": true,
        "example": "50",
        "desc": "페이징 크기"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED/CANCEL_COMPLETED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": false,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "productDivisionType",
        "required": false,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입(ALL/NORMAL_PARCEL/ACCOMMODATION/INSTALLATION_DELIVERY/ONLINE_TICKET/AIRLINE_TICKET/SELF_PICKUP_WINE/KURLY_PARCEL/KURLY_PARCEL_LIQUOR/GOURMET_DELIVERY 등)"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "픽업매장번호"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹명"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "요청받은 파트너 스토어 기준 조회"
  },
  {
    "id": "GET:/open-api/v1/confirmed-orders/excel",
    "group": "주문",
    "name": "구매확정내역 엑셀다운로드",
    "method": "GET",
    "path": "/open-api/v1/confirmed-orders/excel",
    "pathParams": [],
    "queryParams": [
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED/CANCEL_COMPLETED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": false,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "fileName",
        "required": true,
        "example": "20230330_와인주문데이터",
        "desc": "엑셀 파일명"
      },
      {
        "name": "password",
        "required": true,
        "example": "q123456789",
        "desc": "엑셀 파일 비밀번호"
      },
      {
        "name": "downloadReason",
        "required": true,
        "example": "오늘의 주문 데이터 확인",
        "desc": "다운로드 사유"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "productDivisionType",
        "required": false,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입(ALL/NORMAL_PARCEL/ACCOMMODATION 등)"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "픽업매장번호"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹명"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "주문목록조회 검색기준 그대로 사용. fileName/password/downloadReason 필수"
  },
  {
    "id": "PUT:/open-api/v1/order-sheets/delivering",
    "group": "배송",
    "name": "발송처리",
    "method": "PUT",
    "path": "/open-api/v1/order-sheets/delivering",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "{\n  \"invoices\" : [ {\n    \"orderItemNo\" : 123,\n    \"trackingNo\" : \"33274585912\",\n    \"productDivisionCd\" : \"0\",\n    \"courierName\" : \"CJ대한통운\",\n    \"courierId\" : \"04\"\n  }, {\n    \"orderItemNo\" : 234,\n    \"trackingNo\" : \"9898989898\",\n    \"productDivisionCd\" : \"0\",\n    \"courierName\" : \"CJ대한통운\",\n    \"courierId\" : \"04\"\n  } ]\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "배송준비중 → 배송중으로 상태 변경. productDivisionCd: 0=일반택배~11=옵션연동상품",
    "bodyPicker": { "orderStatus": "CONFIRMED_ORDER", "arrayKey": "invoices", "itemShape": "object", "itemTemplate": { "trackingNo": "", "productDivisionCd": "0", "courierName": "", "courierId": "" }, "label": "배송준비중 주문 담기 (→ 발송)" }
  },
  {
    "id": "GET:/open-api/v1/delivery",
    "group": "배송",
    "name": "배송현황 목록조회",
    "method": "GET",
    "path": "/open-api/v1/delivery",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": true,
        "example": "0",
        "desc": "페이징 요청번호"
      },
      {
        "name": "size",
        "required": true,
        "example": "50",
        "desc": "페이징 크기"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER 신규주문일/ORDER_CONFIRMED 발주확인일/ORDER_SHIPPED 발송처리일/DELIVERY_COMPLETED 배송완료일/RESERVATION_CONFIRMED 예약확정일/INSTALLATION_COMPLETED 설치및사용완료일/PURCHASE_CONFIRMED 구매확정일)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME 수취인명/ORDERER_NAME 주문자명/ORDER_NUMBER 개별주문번호/PARENT_ORDER_NO 대표주문번호/PARTNER_PRODUCT_NO 상품번호/PARTNER_PRODUCT_OPTION_NO 상품옵션번호/DEAL_PRODUCT_NUMBER 딜코드/PRODUCT_NAME 상품명)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "deliveryStatus",
        "required": true,
        "example": "DELIVERED",
        "desc": "주문상태(ALL/IN_TRANSIT 배송중/DELIVERED 배송완료/CONFIRMED_RESERVATION 예약확정/INSTALLATION_COMPLETE 설치사용완료)"
      },
      {
        "name": "issueType",
        "required": false,
        "example": "DELIVERY",
        "desc": "우선처리 타입(DELIVERY 배송문제건/INSTALLATION 예약처리문제건)"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "productDivisionType",
        "required": false,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "픽업지 ID"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": ""
  },
  {
    "id": "GET:/open-api/v1/delivery/excel",
    "group": "배송",
    "name": "배송현황 엑셀다운로드",
    "method": "GET",
    "path": "/open-api/v1/delivery/excel",
    "pathParams": [],
    "queryParams": [
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "deliveryStatus",
        "required": true,
        "example": "DELIVERED",
        "desc": "주문상태(ALL/IN_TRANSIT/DELIVERED/CONFIRMED_RESERVATION/INSTALLATION_COMPLETE)"
      },
      {
        "name": "issueType",
        "required": false,
        "example": "DELIVERY",
        "desc": "우선처리 타입(DELIVERY/INSTALLATION)"
      },
      {
        "name": "fileName",
        "required": true,
        "example": "20230330_와인주문데이터",
        "desc": "엑셀 파일명"
      },
      {
        "name": "password",
        "required": true,
        "example": "q123456789",
        "desc": "엑셀 파일 비밀번호"
      },
      {
        "name": "downloadReason",
        "required": true,
        "example": "오늘의 주문 데이터 확인",
        "desc": "다운로드 사유"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "productDivisionType",
        "required": false,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "픽업지 ID"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹"
      },
      {
        "name": "expressDeliveryClassSearchType",
        "required": false,
        "example": "NORMAL",
        "desc": "배송클래스 검색 타입"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "목록조회와 동일 검색기준 사용. 다운로드 사유·파일비밀번호 필수"
  },
  {
    "id": "PUT:/open-api/v1/delivery/installation-completion",
    "group": "배송",
    "name": "배송현황 설치 사용완료 처리",
    "method": "PUT",
    "path": "/open-api/v1/delivery/installation-completion",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "{\n  \"completeInstallations\" : [ {\n    \"orderItemNo\" : 398\n  }, {\n    \"orderItemNo\" : 399\n  } ]\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "설치 사용완료 신청할 주문상품번호(orderItemNo) 필요"
  },
  {
    "id": "PUT:/open-api/v1/delivery/invoice/{orderItemNo}",
    "group": "배송",
    "name": "배송현황 송장업데이트",
    "method": "PUT",
    "path": "/open-api/v1/delivery/invoice/{orderItemNo}",
    "pathParams": [
      {
        "name": "orderItemNo",
        "example": "400",
        "desc": "주문상품번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "{\n  \"trackingNo\" : \"123456\",\n  \"courierId\" : \"04\",\n  \"courierName\" : \"CJ대한통운\"\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "운송장번호·택배사ID·택배사명 필수"
  },
  {
    "id": "GET:/open-api/v1/canceled-orders",
    "group": "취소",
    "name": "취소주문목록 조회",
    "method": "GET",
    "path": "/open-api/v1/canceled-orders",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": true,
        "example": "0",
        "desc": "페이징 요청번호"
      },
      {
        "name": "size",
        "required": true,
        "example": "50",
        "desc": "페이징 크기"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED/CANCEL_COMPLETED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": false,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "productDivisionType",
        "required": true,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입(NORMAL_PARCEL/ACCOMMODATION/INSTALLATION_DELIVERY/ONLINE_TICKET/AIRLINE_TICKET/SELF_PICKUP_WINE/KURLY_PARCEL/KURLY_PARCEL_LIQUOR/GOURMET_DELIVERY/QUICK_DELIVERY/KURLY_NOW/INTEGRATION)"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "픽업매장번호"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹명"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "요청받은 파트너 스토어 기준 조회. productDivisionType 필수"
  },
  {
    "id": "GET:/open-api/v1/canceled-orders/excel",
    "group": "취소",
    "name": "취소주문목록 엑셀다운로드",
    "method": "GET",
    "path": "/open-api/v1/canceled-orders/excel",
    "pathParams": [],
    "queryParams": [
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED/CANCEL_COMPLETED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": false,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "productDivisionType",
        "required": true,
        "example": "ALL",
        "desc": "상품구분 타입"
      },
      {
        "name": "fileName",
        "required": true,
        "example": "20230330_와인주문데이터",
        "desc": "엑셀 파일명"
      },
      {
        "name": "password",
        "required": true,
        "example": "q123456789",
        "desc": "엑셀 파일 비밀번호"
      },
      {
        "name": "downloadReason",
        "required": true,
        "example": "오늘의 주문 데이터 확인",
        "desc": "다운로드 사유"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "픽업매장번호"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹명"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "취소주문목록조회 검색기준 그대로 사용. fileName/password/downloadReason 필수"
  },
  {
    "id": "GET:/open-api/v2/refunded-orders",
    "group": "취소",
    "name": "환불내역 조회",
    "method": "GET",
    "path": "/open-api/v2/refunded-orders",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": true,
        "example": "0",
        "desc": "페이징 요청번호"
      },
      {
        "name": "size",
        "required": true,
        "example": "50",
        "desc": "페이징 크기"
      },
      {
        "name": "partnerStoreNo",
        "required": false,
        "example": "037167fd-36ae-44e6-839c-ade1be4bb99e",
        "desc": "파트너 스토어 번호"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED/CANCEL_COMPLETED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": false,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME/CLAIM_ID)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "productDivisionType",
        "required": true,
        "example": "SELF_PICKUP_WINE",
        "desc": "상품구분 타입(NORMAL_PARCEL/ACCOMMODATION/INSTALLATION_DELIVERY/ONLINE_TICKET/AIRLINE_TICKET/SELF_PICKUP_WINE/KURLY_PARCEL/KURLY_PARCEL_LIQUOR/GOURMET_DELIVERY/QUICK_DELIVERY/KURLY_NOW/INTEGRATION)"
      },
      {
        "name": "subCategoryIds",
        "required": false,
        "example": "123,456",
        "desc": "세분류 카테고리 리스트 (,로 구분)"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "픽업매장번호"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹명"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "v2 경로. 요청받은 파트너 스토어 기준 조회. searchType에 CLAIM_ID 추가됨"
  },
  {
    "id": "GET:/open-api/v2/refunded-orders/excel",
    "group": "취소",
    "name": "환불내역 엑셀다운로드",
    "method": "GET",
    "path": "/open-api/v2/refunded-orders/excel",
    "pathParams": [],
    "queryParams": [
      {
        "name": "partnerStoreNo",
        "required": false,
        "example": "037167fd-36ae-44e6-839c-ade1be4bb99e",
        "desc": "파트너 스토어 번호"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "NEW_ORDER",
        "desc": "기간 검색 타입(NEW_ORDER/ORDER_CONFIRMED/ORDER_SHIPPED/DELIVERY_COMPLETED/RESERVATION_CONFIRMED/INSTALLATION_COMPLETED/PURCHASE_CONFIRMED/CANCEL_COMPLETED)"
      },
      {
        "name": "searchStartAt",
        "required": true,
        "example": "2023-02-01T03:10:00",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndAt",
        "required": true,
        "example": "2023-02-12T08:30:00",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": false,
        "example": "PRODUCT_NAME",
        "desc": "검색어 타입(ALL/RECIPIENT_NAME/ORDERER_NAME/ORDER_NUMBER/PARENT_ORDER_NO/PARTNER_PRODUCT_NO/PARTNER_PRODUCT_OPTION_NO/DEAL_PRODUCT_NUMBER/PRODUCT_NAME/CLAIM_ID)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "로소",
        "desc": "검색어 텍스트"
      },
      {
        "name": "productDivisionType",
        "required": true,
        "example": "ALL",
        "desc": "상품구분 타입(NORMAL_PARCEL/ACCOMMODATION/.../INTEGRATION)"
      },
      {
        "name": "subCategoryIds",
        "required": false,
        "example": "123,456",
        "desc": "세분류 카테고리 리스트 (,로 구분)"
      },
      {
        "name": "fileName",
        "required": true,
        "example": "20230330_와인주문데이터",
        "desc": "엑셀 파일명"
      },
      {
        "name": "password",
        "required": true,
        "example": "q123456789",
        "desc": "엑셀 파일 비밀번호"
      },
      {
        "name": "downloadReason",
        "required": true,
        "example": "오늘의 주문 데이터 확인",
        "desc": "다운로드 사유"
      },
      {
        "name": "partnerName",
        "required": false,
        "example": "아티제",
        "desc": "브랜드명"
      },
      {
        "name": "shopName",
        "required": false,
        "example": "역삼점",
        "desc": "픽업매장명"
      },
      {
        "name": "placeId",
        "required": false,
        "example": "16",
        "desc": "픽업매장번호"
      },
      {
        "name": "pickupGroup",
        "required": false,
        "example": "artise",
        "desc": "픽업그룹명"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "v2 경로. 환불내역조회 검색기준 그대로 사용. fileName/password/downloadReason 필수"
  },
  {
    "id": "PUT:/open-api/v1/canceled-orders/{orderItemNo}",
    "group": "취소",
    "name": "강제 주문 취소",
    "method": "PUT",
    "path": "/open-api/v1/canceled-orders/{orderItemNo}",
    "pathParams": [
      {
        "name": "orderItemNo",
        "example": "3542",
        "desc": "주문상품번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "{\n  \"quantity\" : 1,\n  \"reason\" : \"CUSTOMER_SELF_CANCEL\",\n  \"cancelCost\" : 100,\n  \"memo\" : \"취소 메모\",\n  \"costMethodType\" : \"DEDUCTION\"\n}",
    "category": "write",
    "destructive": true,
    "supported": true,
    "notes": "3p 주문번호 하위 주문 강제취소. reason enum(CUSTOMER_SELF_CANCEL/OUT_OF_STOCK 등), costMethodType(DEDUCTION/DIRECT_TRANSFER/NONE)"
  },
  {
    "id": "GET:/open-api/v1/cancel-claims",
    "group": "취소",
    "name": "취소목록 조회",
    "method": "GET",
    "path": "/open-api/v1/cancel-claims",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": false,
        "example": "0",
        "desc": "페이지 번호"
      },
      {
        "name": "size",
        "required": false,
        "example": "50",
        "desc": "페이지 크기 - 최대 사이즈 100 권장"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "CANCEL_REQUESTED",
        "desc": "조회 기간 유형: CANCEL_REQUESTED(취소요청일)/CANCEL_COMPLETED(취소완료일)/ORDER_COMPLETED(주문완료일)/ORDER_CONFIRMATION(발주확인일)"
      },
      {
        "name": "searchStartDate",
        "required": true,
        "example": "2024-08-17T00:46:59",
        "desc": "검색 시작일자(yyyy-MM-dd'T'HH:mm:ss)"
      },
      {
        "name": "searchEndDate",
        "required": true,
        "example": "2024-08-17T23:59:59",
        "desc": "검색 종료일자(yyyy-MM-dd'T'HH:mm:ss)"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "ALL",
        "desc": "검색어 유형: ALL(전체)/CUSTOMER_NAME(수취인명)/PRODUCT_OPTION_NO(상품옵션번호)/DEAL_CODE(딜코드)/SELLER_PRODUCT_CODE(판매자상품코드)/PARENT_ORDER_NO(대표주문번호)/ORDER_NO(개별주문번호)/CLAIM_NO(클레임번호)"
      },
      {
        "name": "searchText",
        "required": false,
        "desc": "검색어"
      },
      {
        "name": "claimItemStatusSearchType",
        "required": true,
        "example": "ALL",
        "desc": "취소 클레임 상태 유형: ALL(전체)/REQUESTED_RETURN(취소요청)/PROGRESS_RECALL(취소완료)/COMPLETED_RECALL(취소거절)/PENDING_REFUND(취소철회)"
      },
      {
        "name": "cancelReasonSearchType",
        "required": true,
        "example": "ALL",
        "desc": "취소 사유 유형: ALL(전체)/USER_CHANGE_MIND(단순변심)/SYSTEM_ERROR(시스템 오류)/EXPIRATION_DATE_EXPIRED(유효기간 만료)/SUPPLIER_FAULT(판매사 귀책)/OUT_OF_STOCK(품절/결품)/ETC(기타)"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "취소요청/취소완료/취소거절/취소철회 상태 목록 조회. 총 건수는 클레임(claim) 기준"
  },
  {
    "id": "GET:/open-api/v1/cancel-claims/{claimId}",
    "group": "취소",
    "name": "취소 상세 조회",
    "method": "GET",
    "path": "/open-api/v1/cancel-claims/{claimId}",
    "pathParams": [
      {
        "name": "claimId",
        "example": "670247",
        "desc": "취소 클레임 ID"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "클레임ID를 path variable로 받음"
  },
  {
    "id": "GET:/open-api/v1/cancel-claims/{claimId}/complete",
    "group": "취소",
    "name": "취소완료를 위한 상세 조회",
    "method": "GET",
    "path": "/open-api/v1/cancel-claims/{claimId}/complete",
    "pathParams": [
      {
        "name": "claimId",
        "example": "123",
        "desc": "취소 클레임 ID"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "취소완료 처리 전 상세 조회. cancelCost는 시스템 자동계산, costMethodSelectors는 선택가능 수수료 결제방법"
  },
  {
    "id": "PUT:/open-api/v1/cancel-claims/{claimId}/complete",
    "group": "취소",
    "name": "취소완료 처리",
    "method": "PUT",
    "path": "/open-api/v1/cancel-claims/{claimId}/complete",
    "pathParams": [
      {
        "name": "claimId",
        "example": "123",
        "desc": "취소 클레임 ID"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "{\n  \"costMethodType\" : \"DEDUCTION\",\n  \"claimItems\" : [ {\n    \"claimItemNo\" : 1001,\n    \"cancelCost\" : 1000\n  }, {\n    \"claimItemNo\" : 1002,\n    \"cancelCost\" : 2000\n  } ],\n  \"memo\" : \"취소 완료 처리하였습니다.\"\n}",
    "category": "write",
    "destructive": true,
    "supported": true,
    "notes": "취소요청 상태 주문 필요. costMethodType: DEDUCTION(환불금에서 차감)/DIRECT_TRANSFER(계좌송금)/NONE. cancelCost는 10원 단위"
  },
  {
    "id": "GET:/open-api/v1/cancel-claims/{claimId}/reject",
    "group": "취소",
    "name": "취소거절을 위한 상세 조회",
    "method": "GET",
    "path": "/open-api/v1/cancel-claims/{claimId}/reject",
    "pathParams": [
      {
        "name": "claimId",
        "example": "123",
        "desc": "취소 클레임 ID"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "취소거절 처리 전 레이어 구성용. rejectCauses(거절사유 리스트), isInvoiceRequired(운송장 입력 필요 여부), defaultCauseType 반환"
  },
  {
    "id": "PUT:/open-api/v1/cancel-claims/{claimId}/reject",
    "group": "취소",
    "name": "취소거절 처리",
    "method": "PUT",
    "path": "/open-api/v1/cancel-claims/{claimId}/reject",
    "pathParams": [
      {
        "name": "claimId",
        "example": "123",
        "desc": "취소 클레임 ID"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "{\n  \"cancelRejectCauseType\" : \"USED_PRODUCT\",\n  \"memo\" : \"이미 발송된 상품입니다.\"\n}",
    "category": "write",
    "destructive": true,
    "supported": true,
    "notes": "취소요청 상태 주문 필요. isInvoiceRequired=true && 사유=DELIVERED_PRODUCT면 productDeliveryDate/courierId/courierName/trackingNo 필수. 사유=ETC면 memo 공백제외 10자 이상 필수"
  },
  {
    "id": "GET:/open-api/v1/return-claims",
    "group": "반품",
    "name": "반품목록 조회",
    "method": "GET",
    "path": "/open-api/v1/return-claims",
    "pathParams": [],
    "queryParams": [
      {
        "name": "page",
        "required": false,
        "example": "0",
        "desc": "페이징 요청번호 (default: 0)"
      },
      {
        "name": "size",
        "required": false,
        "example": "20",
        "desc": "페이징 크기 (default: 20)"
      },
      {
        "name": "periodSearchType",
        "required": true,
        "example": "RETURN_REQUESTED",
        "desc": "조회 기간: RETURN_REQUESTED(반품요청일)/RECALL_COMPLETED(회수완료일)/RETURN_COMPLETED(반품완료일)"
      },
      {
        "name": "searchStartDate",
        "required": false,
        "example": "2024-08-17T00:46:59",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndDate",
        "required": false,
        "example": "2024-08-17T23:59:59",
        "desc": "조회 종료일시"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "ALL",
        "desc": "상세검색: ALL/CUSTOMER_NAME(수취인명)/PRODUCT_OPTION_NO(상품옵션번호)/DEAL_CODE(딜코드)/SELLER_PRODUCT_CODE(판매자상품코드)/PARENT_ORDER_NO(대표주문번호)/ORDER_NO(개별주문번호)/CLAIM_NO(클레임번호)"
      },
      {
        "name": "searchText",
        "required": false,
        "example": "",
        "desc": "상세검색어"
      },
      {
        "name": "returnClaimItemStatusSearchType",
        "required": true,
        "example": "ALL",
        "desc": "처리상태: ALL/REQUESTED_RETURN(반품 요청)/PROGRESS_RECALL(회수 진행 중)/COMPLETED_RECALL(회수 완료)/PENDING_REFUND(환불 보류)/COMPLETED_RETURN(반품 완료)/REJECTED_RETURN(반품 거절)/DROP_RETURN(반품 철회)/AUTO_PENDING_REFUND(자동 환불 대기)/DELAY_REFUND(반품 지연)"
      },
      {
        "name": "returnReasonSearchType",
        "required": true,
        "example": "ALL",
        "desc": "반품사유: ALL/USER_CHANGE_MIND(단순 변심)/PRODUCT_DEFECT(상품 불량)/PRODUCT_DESTROYED(상품 파손)/PRODUCT_MISDELIVERY(오배송)/MISSING_DELIVERY(상품 누락)"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "총 건수는 claimItems가 아닌 claim 기준으로 제공"
  },
  {
    "id": "GET:/open-api/v1/return-claims/excel",
    "group": "반품",
    "name": "반품목록 엑셀 다운로드",
    "method": "GET",
    "path": "/open-api/v1/return-claims/excel",
    "pathParams": [],
    "queryParams": [
      {
        "name": "periodSearchType",
        "required": true,
        "example": "RETURN_REQUESTED",
        "desc": "조회 기간"
      },
      {
        "name": "searchStartDate",
        "required": false,
        "example": "2024-08-17T00:46:59",
        "desc": "조회 시작일시"
      },
      {
        "name": "searchEndDate",
        "required": false,
        "example": "2024-08-17T23:59:59",
        "desc": "조회 종료일시"
      },
      {
        "name": "returnClaimItemStatusSearchType",
        "required": true,
        "example": "ALL",
        "desc": "처리상태"
      },
      {
        "name": "returnReasonSearchType",
        "required": true,
        "example": "ALL",
        "desc": "반품사유"
      },
      {
        "name": "searchType",
        "required": true,
        "example": "ALL",
        "desc": "상세검색"
      },
      {
        "name": "fileName",
        "required": false,
        "example": "2024_반품관리",
        "desc": "다운로드 파일명"
      },
      {
        "name": "password",
        "required": false,
        "example": "q123456789",
        "desc": "엑셀 파일 비밀번호"
      },
      {
        "name": "downloadReason",
        "required": false,
        "example": "오늘의 반품 데이터 확인",
        "desc": "다운로드 사유"
      }
    ],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "최대 조회기간 3개월. 데이터 과다 시 요청시간 초과로 400 반환"
  },
  {
    "id": "GET:/open-api/v1/return-claims/{claimId}",
    "group": "반품",
    "name": "반품 상세 조회",
    "method": "GET",
    "path": "/open-api/v1/return-claims/{claimId}",
    "pathParams": [
      {
        "name": "claimId",
        "example": "10023",
        "desc": "클레임 고유번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "주문 상세는 open-api/v2/orders에서 searchType=ORDER_NUMBER 또는 PARENT_ORDER_NO로 별도 조회"
  },
  {
    "id": "GET:/open-api/v1/return-claims/{claimId}/pending-refund",
    "group": "반품",
    "name": "환불보류 내역 조회",
    "method": "GET",
    "path": "/open-api/v1/return-claims/{claimId}/pending-refund",
    "pathParams": [
      {
        "name": "claimId",
        "example": "10023",
        "desc": "클레임 고유번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "해당 클레임에서 진행된 환불보류 내역 조회"
  },
  {
    "id": "GET:/open-api/v1/return-claims/{claimId}/reject",
    "group": "반품",
    "name": "반품거절 내역 조회",
    "method": "GET",
    "path": "/open-api/v1/return-claims/{claimId}/reject",
    "pathParams": [
      {
        "name": "claimId",
        "example": "10023",
        "desc": "클레임 고유번호"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "",
    "category": "read",
    "destructive": false,
    "supported": true,
    "notes": "반품 거절 처리된 클레임 대상 내역 조회"
  },
  {
    "id": "POST:/open-api/v1/pickup-places",
    "group": "픽업",
    "name": "픽업지 등록",
    "method": "POST",
    "path": "/open-api/v1/pickup-places",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "{\n  \"shopName\" : \"역삼점\",\n  \"shopPhoneNumber\" : \"02-539-0456\",\n  \"shopPlace\" : \"서울특별시 강남구 테헤란로51길 10, (역삼동)\",\n  \"pickupShopUrl\" : \"naver.me/GSX2Elen\",\n  \"latitude\" : 37.504767,\n  \"longitude\" : 127.04699,\n  \"externalStoreCode\" : \"30499\",\n  \"isCloseWeekend\" : true,\n  \"isUse\" : true\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "매장명·매장주소·위경도·전화번호·파트너매장코드(externalStoreCode) 필수"
  },
  {
    "id": "PUT:/open-api/v1/pickup-places/{externalStoreCode}",
    "group": "픽업",
    "name": "픽업지 수정",
    "method": "PUT",
    "path": "/open-api/v1/pickup-places/{externalStoreCode}",
    "pathParams": [
      {
        "name": "externalStoreCode",
        "example": "30499",
        "desc": "파트너매장코드"
      }
    ],
    "queryParams": [],
    "requestBodyExample": "{\n  \"shopName\" : \"역삼점\",\n  \"shopPhoneNumber\" : \"02-539-0456\",\n  \"shopPlace\" : \"서울특별시 강남구 테헤란로51길 10, (역삼동)\",\n  \"pickupShopUrl\" : \"naver.me/GSX2Elen\",\n  \"latitude\" : 37.504767,\n  \"longitude\" : 127.04699,\n  \"isCloseWeekend\" : true,\n  \"isUse\" : false\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "등록된 픽업지(파트너매장코드) 필요. 모든 필드 선택값"
  },
  {
    "id": "POST:/open-api/v1/pickup-places/pickup-date",
    "group": "픽업",
    "name": "픽업 일자 등록",
    "method": "POST",
    "path": "/open-api/v1/pickup-places/pickup-date",
    "pathParams": [],
    "queryParams": [],
    "requestBodyExample": "{\n  \"externalOrderDate\" : \"2023-12-05\",\n  \"pickupStartDate\" : \"2023-12-12\"\n}",
    "category": "write",
    "destructive": false,
    "supported": true,
    "notes": "발주일(externalOrderDate)·픽업일(pickupStartDate) 필수"
  }
];

export const THREEP_GROUPS: string[] = Array.from(new Set(THREEP_CATALOG.map((o) => o.group)));

export function findOp(id: string): ThreePOp | undefined {
  return THREEP_CATALOG.find((o) => o.id === id);
}
