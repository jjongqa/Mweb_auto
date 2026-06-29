import Link from "next/link";
import FullScenarioForm from "./form";

export const dynamic = "force-dynamic";

export default function FullScenarioPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🛒 주문 생성 (상품 생성 → 주문 풀체인)</h1>
        <p className="mt-2 text-sm text-neutral-600">
          1P / 3P 상품을 N건 생성한 직후 → 그 상품으로 적립금 주문까지 한 번에. End-to-End 시나리오.
        </p>
        <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-900 leading-relaxed">
          🔄 <strong>흐름</strong>: 상품 생성 (재고 + 전시 포함) → dealProductNo 자동 추출 → 회원으로 주문 (적립금 결제)
          <br />
          ⚠ <strong>회원 적립금이 결제예정금액보다 충분해야 통과</strong> · 배송지·센터코드는 회원 기본배송지에서 자동
        </div>
      </div>

      <FullScenarioForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
