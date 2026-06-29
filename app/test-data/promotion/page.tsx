import Link from "next/link";
import PromotionForm from "./form";

export const dynamic = "force-dynamic";

export default function PromotionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🎯 프로모션 확정</h1>
        <p className="mt-2 text-sm text-neutral-600">
          이미 등록되어 있는 <strong>프로모션 코드</strong>를 확정 처리합니다. (lacms2 화면 진입 없이 API로 일괄)
        </p>
        <div className="mt-3 rounded-lg bg-cyan-50 p-3 text-xs text-cyan-900 leading-relaxed">
          🔄 <strong>흐름</strong>: lacms OAuth 로그인 → 프로모션 코드별 검색 (-240일 ~ +120일 4창) → <code className="rounded bg-white/70 px-1 py-0.5">promotionId</code> 추출 → <code className="rounded bg-white/70 px-1 py-0.5">PUT /v1/promotions/confirm</code>
          <br />
          ⏱ 확정 후 <strong>5분 경과</strong> → 공급사 판촉합의서 날인 가능
          <br />
          🔐 권한: <code className="rounded bg-white/70 px-1 py-0.5">Marketing_ALL</code> (없으면 403)
        </div>
      </div>

      <PromotionForm />

      <div className="card p-4 text-xs text-neutral-500 space-y-1">
        <div><strong>참고</strong>: STG <code className="bg-neutral-100 px-1">gateway.cloud.stg.kurly.services/admin/partner-promotion</code></div>
        <div><strong>제약</strong>: 같은 코드라도 promotionId는 매번 다름 → 1) 코드로 검색 → 2) id로 확정 두 단계 필요</div>
        <div><strong>코드 검색 범위</strong>: 시작일 기준 4개 90일 창 (-60~+30, -150~-60, -240~-150, +30~+120). 더 멀면 못 찾음.</div>
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
