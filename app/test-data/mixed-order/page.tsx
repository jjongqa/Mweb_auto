import Link from "next/link";
import MixedOrderForm from "./form";

export const dynamic = "force-dynamic";

export default function MixedOrderPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🧩 혼합 주문 (1P + 3P 유형 자유)</h1>
        <p className="mt-2 text-sm text-neutral-600">
          1P + 3P(유형 자유 조합) 상품을 자동 생성하고 <strong>한 주문(groupOrderNo)</strong>에 묶어 주문합니다. 컬리몰이 배송그룹을 자동 분리해요.
        </p>
        <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-900 leading-relaxed">
          🧩 <strong>혼합 조합</strong> — 1P + 3P 유형별(일반택배·컬리배송·주류·설치·미식·퀵·숙박·항공·온라인티켓·셀프픽업) 개수를 자유롭게. 예) 1P 1 + 일반택배 1 + 컬리배송 1
          <br />
          🔑 <strong>인증</strong> — La-CMS 이메일/PW 공통 필수(전시 있어야 주문 가능). 3P 포함 시 OpenAPI 토큰 + 어드민 ID/PW 추가
          <br />
          🚚 <strong>배송완료 자동화</strong> — 3P가 전부 일반(택배)일 때만 지원(발송처리가 일반택배 배치)
          <br />
          ⏱ <strong>소요</strong> — 3P는 전시→goods 반영에 상품당 최대 ~84초 폴링. 다건이면 시간 걸릴 수 있어요. 비물류 유형은 주문서 진입이 안 될 수 있어요.
        </div>
      </div>

      <MixedOrderForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
