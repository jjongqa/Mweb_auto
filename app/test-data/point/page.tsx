import Link from "next/link";
import PointForm from "./form";

export const dynamic = "force-dynamic";

export default function PointPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">💰 적립금 / 🪙 컬리캐시 지급</h1>
        <p className="mt-2 text-sm text-neutral-600">
          stg 환경에서 회원에게 적립금/컬리캐시 강제 지급. 상단 토글로 선택.
          <code className="ml-1 rounded bg-neutral-100 px-1 py-0.5 text-xs">free/publish</code> · <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">cash/publish</code>
        </p>
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900 leading-relaxed">
          🎁 <strong>인증 불필요</strong> — stg test 전용 API (적립금 point.stg.kurlypay.services / 컬리캐시 point.stg.kurlypay.co.kr)
          <br />
          ⏱ <strong>1건당 즉시 처리</strong> · 100건까지 일괄 가능
          <br />
          💡 주문 자동화 테스트 시 적립금/캐시 부족 문제 해결용
        </div>
      </div>

      <PointForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
