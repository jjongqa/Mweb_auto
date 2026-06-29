import Link from "next/link";
import Delivery1pForm from "./form";

export const dynamic = "force-dynamic";

export default function Delivery1pPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🚚 1P 배송완료 처리</h1>
        <p className="mt-2 text-sm text-neutral-600">
          컬리배송(샛별/하루, 1P·FBK) 주문을 <strong>배송완료/배송중</strong>으로 전환. Kafka <code>MSG-OMS-KURLY-BOX-TRACKING</code> 발행.
        </p>
        <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-900 leading-relaxed">
          🚚 <strong>대표주문번호만 입력</strong> → 카프카 발행 → 컬리몰 상태 전환. (3P와 달리 발주확인·발송처리·DB조회 불필요)
          <br />
          ✅ <strong>주문완료 상태</strong>부터 가능. orderCode(대표주문번호)로 매칭되며 출고요청번호/운송장은 자동 생성값.
          <br />
          👥 <strong>여러 건 동시</strong> — 한 줄에 하나씩 또는 쉼표/공백 구분 (최대 100건)
        </div>
      </div>

      <Delivery1pForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
