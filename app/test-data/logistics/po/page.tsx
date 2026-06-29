import Link from "next/link";
import PoTabs from "./po-tabs";

export const dynamic = "force-dynamic";

export default function LogisticsPoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📋 발주 (CAPA / V2 / V1)</h1>
        <p className="mt-2 text-sm text-neutral-600">
          환경(STG·DEV01~05) 선택 후 <strong>CAPA 관리</strong>·<strong>발주 V2</strong>·<strong>발주 V1</strong>을 자동 처리합니다.
        </p>
        <div className="mt-3 rounded-lg bg-teal-50 p-3 text-xs text-teal-900 leading-relaxed">
          📦 <strong>CAPA</strong>: RMS 수용능력 조회 → 누락 입고지 일괄 등록
          <br />
          🏭 <strong>V2</strong>: 임직원 로그인 → 상품 조회/선택 → 발주계획 → 발주검사/생성 → 공급사 확정 → 거래명세서(신규/병합)
          <br />
          📋 <strong>V1</strong>: 임직원 로그인 → 발주그룹 등록 → 발주서 일괄생성 → 공급사 발주확정
          <br />
          ⚙ 대상 환경에 실제 존재하는 임직원/RMS/공급사 계정 + 내부망 필요. (원본: seahuijang/jangsehui)
        </div>
      </div>

      <PoTabs />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
