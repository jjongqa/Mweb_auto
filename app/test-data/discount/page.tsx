import Link from "next/link";
import { DiscountForm } from "./form";

export const dynamic = "force-dynamic";

export default function DiscountPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🏷️ 상품 할인 적용</h1>
        <p className="mt-2 text-sm text-neutral-600">
          생성한 딜상품(dealProductNo)에 stg 할인을 일괄 등록. 정률/정액 · 조건수량 · 기간 · 센터별.
        </p>
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed">
          🔗 <strong>흐름</strong>: lacms 로그인(쿠폰과 동일 SSO) → JWT 자동 발급 → dealProductNo × 센터코드 단위로 할인 등록
          <br />
          ⚠ 할인은 <strong>센터(clusterCenterCode)별</strong>이라, 주문할 회원의 <strong>기본배송지 센터</strong>(예 CC02)에 걸어야 그 회원 주문에 할인가가 보입니다.
        </div>
      </div>

      <DiscountForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
