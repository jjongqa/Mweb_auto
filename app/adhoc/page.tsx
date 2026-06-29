import { AdhocForm } from "./form";

export const dynamic = "force-dynamic";

export default function AdhocPage() {
  return (
    <div>
      <section className="card p-8">
        <h1 className="text-2xl font-semibold tracking-tight">애드혹 AI 테스트</h1>
        <p className="mt-2 text-sm text-neutral-600">
          기획 문서와 자유 텍스트만 주시면 AI 가 직접 시나리오를 도출해서 탐색적으로 검증합니다.
          미리 정의된 TC 가 없어도 OK.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          결과: <code>summary.csv</code> (시나리오별 PASS/FAIL) + <code>report.md</code> (발견 버그/의문점 리포트)
        </p>
      </section>

      <section className="card mt-6 p-8">
        <AdhocForm />
      </section>
    </div>
  );
}
