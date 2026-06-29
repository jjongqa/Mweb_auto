import Link from "next/link";
import WorkTypeForm from "./form";

export const dynamic = "force-dynamic";

export default function WorkTypeTestPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🧪 근무유형별 테스트</h1>
        <p className="mt-2 text-sm text-neutral-600">
          근무유형 마스터(48종)별 프리셋 계정을 만들고, 그룹·쿼터에 따라 예상 출퇴근 시각을 계산해 일괄 생성·검증합니다.
        </p>
        <div className="mt-3 rounded-lg bg-indigo-50 p-3 text-xs text-indigo-900 leading-relaxed">
          🔄 계정당: 회원가입 → 모바일 로그인 → 상용직 전환 → 근무계획 생성 → (근무인정 계정만) 출근 → 퇴근
          <br />
          ⚙ 계정 ID는 <code>kurlyqa8801~</code> 자동 매핑 · 근무인정 계정 22개만 출퇴근 처리 · 컬리로 QA 내부망 필요.
        </div>
      </div>

      <WorkTypeForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
