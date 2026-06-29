import Link from "next/link";
import Product3pForm from "./form";

export const dynamic = "force-dynamic";

export default function Product3pPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🤝 3P 상품 등록</h1>
        <p className="mt-2 text-sm text-neutral-600">
          파트너 상품 자동 등록 — OpenAPI 등록 → 어드민 승인 → La-CMS 전시/재고 셋업까지 12단계 체인.
        </p>
        <div className="mt-3 rounded-lg bg-violet-50 p-3 text-xs text-violet-900 leading-relaxed">
          ⏱ <strong>1건당 15~20초</strong> (단계 간 의존성 + 폴링) · 10건 ≈ 2~3분
          <br />
          🔑 <strong>인증 3종</strong>: OpenAPI Bearer (고정 기본값) / 어드민 ID-PW / La-CMS 계정
          <br />
          📦 <strong>일반(택배)</strong>: 출고지·반품지·배송사 자동 조회 → 등록 / <strong>컬리배송</strong>: 별도 조회 없이 등록
        </div>
      </div>

      <Product3pForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data/product" className="text-kurly-500 underline">← 상품 등록 메뉴</Link>
      </div>
    </div>
  );
}
