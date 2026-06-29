import Link from "next/link";
import { listSuites } from "@/lib/suites";
import { SuitesList } from "./suites-list";

export const dynamic = "force-dynamic";

export default function SuitesPage() {
  const suites = listSuites();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">회귀 스위트</h1>
        <p className="mt-1 text-sm text-neutral-600">
          자주 돌리는 잡 설정을 저장해 두고 한 번에 재실행합니다. 잡 상세 페이지에서 <strong>스위트로 저장</strong> 버튼으로 추가하세요.
        </p>
      </div>

      <SuitesList suites={suites} />

      <Link href="/history" className="btn-ghost text-sm">← 히스토리</Link>
    </div>
  );
}
