// STG OpenAPI 공용 기본값 — 주문(order) / 3P 상품 폼이 공유하는 사전입력 값.
// 토큰 로테이션 시 여기 한 곳만 수정하면 양쪽 폼에 반영 (이전엔 2벌 하드코딩 → drift 위험).
//
// 주의: 이 값은 "use client" 폼의 기본값이라 브라우저 번들에 포함된다.
//   사내 STG 한정 + 외부 노출 없음 전제(인증 미적용 기조와 동일)이므로 수용.
//   번들에서 완전히 빼려면 서버(env / api_secrets)로 옮겨 prop 으로 주입해야 함.
export const STG_OPENAPI_ACCESS_TOKEN =
  "d350caad87aeb7f5cd9753429349f6e4cf82559a7e13b1ce8e9e331e931a1df48704a38733d9f55f0488807b3fbbaefeb4f9ddcb07c84f1c8a3f93649b38d705";
export const STG_DEFAULT_ADMIN_ID = "admin3";
// 3P 파트너 어드민 로그인 PW (third-party-partner-gateway /internal/api/v2/auth/login).
// STG 고정값 — 3P 상품/주문/혼합주문 폼이 공유. 위 노출 정책과 동일하게 수용.
export const STG_DEFAULT_ADMIN_PW = "qwert12345";
