import Link from "next/link";
import WorkVerifyForm from "./form";

export const dynamic = "force-dynamic";

export default function WorkVerifyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📊 근무관리 검증</h1>
        <p className="mt-2 text-sm text-neutral-600">
          컬리로 근무관리 대시보드의 통계 API ↔ 리스트 집계 ↔ 그래프 필터 조회를 교차 비교해 정합성을 검증합니다.
        </p>
        <div className="mt-3 rounded-lg bg-indigo-50 p-3 text-xs text-indigo-900 leading-relaxed">
          🔄 어드민 로그인 → work-schedules·통계 3종 조회 → 리스트 직접 집계 → 그래프 필터별 재조회 → 통계/집계/필터 교차 비교(PASS/FAIL)
          <br />
          ⚙ <strong>데이터 생성이 아닌 검증/조회 도구</strong> · 컬리로 QA 내부망 필요.
        </div>
      </div>

      <WorkVerifyForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
