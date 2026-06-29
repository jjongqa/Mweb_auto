import Link from "next/link";
import MembershipTicketForm from "./form";

export const dynamic = "force-dynamic";

export default function MembershipTicketPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🎟️ 멤버스 이용권 등록</h1>
        <p className="mt-2 text-sm text-neutral-600">
          기존 회원에게 멤버스 무료이용권을 직접 등록합니다. <code>POST /membership-internal/v1/admin/subscriptions/tickets</code>
        </p>
        <div className="mt-3 rounded-lg bg-fuchsia-50 p-3 text-xs text-fuchsia-900 leading-relaxed">
          🎟️ <strong>이용권 등록</strong> — 회원에게 이용권(ticketMetaId) + 등록기간 부여 · 인증 불필요(stg internal)
          <br />
          👥 <strong>여러 회원 동시 처리</strong> — 한 줄에 하나씩 또는 쉼표 구분 (최대 100명)
          <br />
          ℹ️ 강제 <strong>구독</strong>(<Link href="/test-data/membership" className="underline">멤버스 강제 구독/해지</Link>)과는 다른 엔드포인트예요 — 이쪽은 이용권 직접 등록.
        </div>
      </div>

      <MembershipTicketForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
