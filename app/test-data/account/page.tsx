import Link from "next/link";
import { AccountCreateForm } from "./form";

export const dynamic = "force-dynamic";

export default function AccountCreatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">👤 회원 계정 생성</h1>
        <p className="mt-2 text-sm text-neutral-600">
          stg 환경에 회원 계정 N건을 자동 생성. <strong>SMS 인증 mock</strong> (01011111111 / 111111 고정) 으로 같은 번호 N건 가능.
        </p>
        <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
          <strong>호출 흐름</strong>: <code>send-auth-code → verify-auth-code → join</code> 3단계 (병렬 처리)
          <br />
          <strong>예상 시간</strong>: 100건 ≈ 30~60초 (concurrency=10 기준)
        </div>
      </div>

      <AccountCreateForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
