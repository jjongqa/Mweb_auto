import Link from "next/link";
import MembershipForm from "./form";

export const dynamic = "force-dynamic";

export default function MembershipPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🎫 멤버스 강제 구독 / 해지</h1>
        <p className="mt-2 text-sm text-neutral-600">
          기존 회원에게 멤버스 강제 구독 또는 해지 처리. 탭 전환으로 모드 변경.
        </p>
        <div className="mt-3 rounded-lg bg-fuchsia-50 p-3 text-xs text-fuchsia-900 leading-relaxed">
          🎫 <strong>강제 구독</strong> — <code>POST /membership-internal/v1/admin/subscriptions/tickets/vip/subscribe</code> · 인증 불필요
          <br />
          ✂️ <strong>강제 해지</strong> — <code>DELETE /admin/member-membership/v1/cms/members/{`{memberNo}`}/subscriptions</code> · lacms 이메일/패스워드 OAuth 필요
          <br />
          👥 <strong>여러 회원 동시 처리</strong> — 한 줄에 하나씩 또는 쉼표 구분 (최대 100명)
        </div>
      </div>

      <MembershipForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
