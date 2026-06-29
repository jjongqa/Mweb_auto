import Link from "next/link";
import ReviewForm from "./form";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">⭐ 상품 후기 작성</h1>
        <p className="mt-2 text-sm text-neutral-600">
          <strong>배송완료된 주문</strong>에 상품 후기를 자동 작성. <code>GET /v1/writable-reviews</code> → <code>POST /v2/orders/{"{orderNo}"}/deal-products/{"{dealProductNo}"}</code>
        </p>
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed">
          ⭐ <strong>회원번호만 입력</strong> → 작성 가능 후기를 조회해 일괄 작성. 인증 X-KURLY-MEMBER-NO 헤더만(쿠키리스).
          <br />
          ⚠️ <strong>후기는 배송완료 상태에서만 작성 가능</strong> — 작성가능 목록 API가 배송완료된 건만 반환하므로 자동 충족돼요. (먼저 <Link href="/test-data/delivery-1p" className="underline">1P 배송완료</Link>나 주문 풀체인으로 배송완료 처리)
          <br />
          📝 후기 내용은 비우면 기본 문구가 항목마다 회전 적용. 검증(<code>passStatus</code>)은 기본 NONE(금칙어/무의미 검사 skip).
        </div>
      </div>

      <ReviewForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
