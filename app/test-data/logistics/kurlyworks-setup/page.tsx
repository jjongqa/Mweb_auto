import Link from "next/link";
import KurlyworksForm from "./form";

export const dynamic = "force-dynamic";

export default function KurlyworksSetupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">⚙️ Kurlyworks 작업자 세팅</h1>
        <p className="mt-2 text-sm text-neutral-600">
          컬리웍스(근무조·계약서·전자계약 문서) + 컬리로(센터 근무시간대) 마스터 데이터를 브라우저 자동화로 세팅합니다.
        </p>
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed">
          🧪 <strong>실험적 / 미검증</strong> — 공개 API가 없어 어드민 UI를 Playwright로 직접 조작합니다. 라이브 UI 셀렉터에 의존하므로 UI 변경 시 단계가 깨질 수 있습니다.
          <br />
          ⚙ 서버에 chromium 필요(<code>npx playwright install chromium</code>) · 컬리웍스/컬리로 어드민 계정 + 내부망 필요. 이 마스터 세팅은 보통 <strong>1회성</strong>이며, 이후 Kurlyro API/근무유형 테스트가 재사용합니다.
        </div>
      </div>

      <KurlyworksForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
