import Link from "next/link";
import MembershipCancelReserveForm from "./form";

export const dynamic = "force-dynamic";

export default function MembershipCancelReservePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🚪 멤버스 해지예약 전환</h1>
        <p className="mt-2 text-sm text-neutral-600">
          멤버스 구독 중인 회원을 <strong>해지 예약</strong>(구독 종료일에 해지) 상태로 전환합니다. <code>PUT /v1/subscriptions/payments/products/unsubscribe/reserve</code>
        </p>
        <div className="mt-3 rounded-lg bg-fuchsia-50 p-3 text-xs text-fuchsia-900 leading-relaxed">
          🚪 <strong>회원번호만 입력</strong> → 버튼 → 해지 예약(cancelReserved=true) 전환 · 인증 X-KURLY-MEMBER-NO 헤더만(쿠키리스)
          <br />
          🔁 <strong>해지예약 취소</strong>도 같은 화면에서 가능 (전환/취소 선택)
          <br />
          👥 <strong>여러 회원 동시 처리</strong> — 한 줄에 하나씩 또는 쉼표/공백 구분 (최대 100명)
          <br />
          ℹ️ <strong>전제: 이미 멤버스 구독 중</strong>인 회원이어야 합니다(미구독이면 실패). 즉시 해지가 아니라 예약입니다.
        </div>
      </div>

      <MembershipCancelReserveForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
