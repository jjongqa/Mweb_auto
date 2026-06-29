import Link from "next/link";
import OrderTabs from "./order-tabs";

export const dynamic = "force-dynamic";

export default function LogisticsOrderPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📦 물류 주문 생성</h1>
        <p className="mt-2 text-sm text-neutral-600">
          <strong>1P 컬리몰</strong> 또는 <strong>KLS(3PL)</strong> 주문을 온도대·센터·권역별로 자동 생성합니다.
        </p>
        <div className="mt-3 rounded-lg bg-sky-50 p-3 text-xs text-sky-900 leading-relaxed">
          🛒 <strong>1P 컬리몰</strong>: 로그인 → 주문서 → 적립금 전액 결제 → (옵션)OMS 전송·출고요청번호 → (옵션)Kafka TMS 발행(운송장). 계정 적립금 충분해야 통과.
          <br />
          🏭 <strong>KLS(3PL)</strong>: 이행계획 검증 → 주문 등록(x-owner-code) → 출고번호 조회. 로그인/적립금 불필요, 화주사·판매처 코드 필요.
          <br />
          ⚙ 공통: STG 내부망 필요 · 주소 풀(센터/권역) 공유.
        </div>
      </div>

      <OrderTabs />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
