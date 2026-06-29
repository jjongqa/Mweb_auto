import Link from "next/link";
import { CouponTabs } from "./tabs";

export const dynamic = "force-dynamic";

export default function CouponCreatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🎟️ 쿠폰 생성 (발행 / 쿠폰팩)</h1>
        <p className="mt-2 text-sm text-neutral-600">
          쿠폰 N건 발행, 또는 발행한 쿠폰들을 묶어 쿠폰팩 생성. <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">/v3/admin/coupon-publishes · /coupon-packs</code>
        </p>
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
          🔐 <strong>lacms 이메일/패스워드만 입력하면 끝</strong> — 서버에서 OAuth 로그인 후 JWT 자동 발급.
          <br />
          이메일은 브라우저에 저장되고, 패스워드만 매번 입력하면 됩니다. (JWT 만료 걱정 없음)
        </div>
      </div>

      <CouponTabs />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
