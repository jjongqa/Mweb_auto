import Link from "next/link";
import KurlyroTabs from "./kurlyro-tabs";

export const dynamic = "force-dynamic";

export default function LogisticsCurlyroPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🚛 Kurlyro API (작업자)</h1>
        <p className="mt-2 text-sm text-neutral-600">
          컬리로 작업자 생명주기 — <strong>연속 실행</strong>(상용직/아르바이트) + <strong>기본 API · 아르바이트 · 관리 · 특수건강검진</strong> 단건 API를 순수 HTTP로 실행합니다.
        </p>
        <div className="mt-3 rounded-lg bg-indigo-50 p-3 text-xs text-indigo-900 leading-relaxed">
          🚀 <strong>연속 실행</strong>: 상용직 8단계 / 아르바이트 10단계 (시작~종료 단계 선택)
          <br />
          📋 <strong>기본 API</strong>(회원가입~탈퇴 단건) · 🔧 <strong>아르바이트</strong>(개인정보·근로계약 5단계 등) · ⚙️ <strong>관리</strong>(안전교육·비번·계정초기화) · 🏥 <strong>특수건강검진</strong>(대상자·1/2차·승인/반려)
          <br />
          ⚙ 마스터 근무시간대·전자계약 문서는 <strong>사전 세팅 가정</strong> · 컬리로 QA 내부망 필요.
        </div>
      </div>

      <KurlyroTabs />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
