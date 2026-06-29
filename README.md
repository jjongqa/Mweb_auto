# Kurly QA E2E 커머스 어드민

Kurly SQE팀 E2E 테스트 지원 도구. 상품 생성부터 주문·배송완료까지 STG 테스트데이터를 자동 생성하고, TC 생성·실행·분석을 한 곳에서 처리합니다.

## 구성

```
kurly_sqe_e2e_commerce/
├── (Next.js 어드민 앱 — 루트)   ← 여기 설치·실행
└── external-worker/             ← 분산 워커 (각 QA 머신에서 별도 실행)
```

## 어드민 앱 실행

### 요구사항
- Node.js 18+
- 사내망 접속 (STG DB / Kafka / 게이트웨이)

### 설치 및 실행

```bash
npm install
npm run dev        # http://localhost:3000
```

프로덕션 배포:
```bash
npm run build
npm start
```

---

## 주요 기능

### 테스트 데이터

| 경로 | 기능 |
|---|---|
| `/test-data/order` | 상품 생성 → 주문 풀체인 (1P / 3P). 3P는 발주확인→발송처리→배송완료 자동화 옵션 포함 |
| `/test-data/product/1p` | 1P 상품 단독 생성 (PMS 마스터 → 콘텐츠 → 재고 → 전시) |
| `/test-data/product/3p` | 3P 상품 단독 생성 (OpenAPI → 어드민 승인 → La-CMS 전시/재고) |
| `/test-data/discount` | 할인 적용 (SINGLE / BUNDLE / REPEAT 등) |
| `/test-data/coupon` | 쿠폰 발급 |
| `/test-data/point` | 적립금 지급 |
| `/test-data/membership` | 멤버십 설정 |
| `/test-data/account` | 계정 생성/설정 |
| `/test-data/promotion` | 프로모션 설정 |

### TC 생성 및 실행

| 경로 | 기능 |
|---|---|
| `/tc-gen` | Claude로 TC 자동 생성 (POC별 분류, 이어쓰기 모드) |
| `/qa-design` | 설계 문서 기반 TC 생성 |
| `/jobs` | TC 실행 잡 목록 및 상태 |
| `/compare` | 잡 결과 비교 |
| `/suites` | 회귀 스위트 저장/재실행 |
| `/analytics` | 실행 분석 대시보드 (flaky 탐지, duration 분포) |
| `/history` | 실행 이력 |
| `/workers` | 워커 플릿 상태 |

---

## 3P 배송완료 자동화

`/test-data/order`에서 3P + "🚚 배송완료까지 자동 처리" 체크 시 아래 플로우가 자동 실행됩니다:

1. **발주확인** — `PUT /open-api/v1/order-sheets/preparing-delivery`
2. **발송처리** — `PUT /open-api/v1/order-sheets/delivering` (운송장 자동 생성)
3. **배송완료** — `MSG-3P-ORDER-DELIVERY-TRACE-DATA` Kafka 발행

인증: 상품 생성에 사용한 OpenAPI accessToken과 동일. 일반택배 상품만 지원.

---

## 외부 워커 (분산 실행)

여러 대의 QA 머신에서 TC를 병렬 실행하려면 각 머신에서 external-worker를 실행합니다.

```bash
cd external-worker
npm install
node src/index.js
```

워커는 어드민 앱에 자동 등록되고 `/workers` 페이지에서 상태를 확인할 수 있습니다.

자세한 설치 방법: [external-worker/INSTALL.md](external-worker/INSTALL.md)

---

## 기술 스택

- **프레임워크**: Next.js 15 (App Router)
- **DB**: SQLite (better-sqlite3)
- **스타일**: Tailwind CSS
- **언어**: TypeScript
