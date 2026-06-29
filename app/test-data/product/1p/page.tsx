import Link from "next/link";
import Product1pForm from "./form";

export const dynamic = "force-dynamic";

export default function Product1pPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🏬 1P 상품 등록 (Kurly 직매입)</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Kurly 직매입 상품 자동 등록 — PMS 마스터 → 콘텐츠 → 재고 세팅 4단계 체인.
        </p>
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900 leading-relaxed">
          🔐 <strong>lacms 이메일/패스워드만 입력</strong> — 서버에서 OAuth 로그인 후 토큰 자동 발급
          <br />
          ⏱ <strong>1건당 약 2~3초</strong> (3P 대비 매우 빠름 — 어드민 승인 단계 없음)
          <br />
          📦 마스터 / 콘텐츠 / 재고 단계는 개별 ON/OFF 가능
        </div>
      </div>

      <Product1pForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data/product" className="text-kurly-500 underline">← 상품 등록 메뉴</Link>
      </div>
    </div>
  );
}
