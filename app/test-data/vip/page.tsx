import Link from "next/link";
import VipForm from "./form";

export const dynamic = "force-dynamic";

export default function VipPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">👑 VIP / VVIP 강제 세팅</h1>
        <p className="mt-2 text-sm text-neutral-600">
          회원에게 VIP/VVIP 등급을 DB 직접 적용으로 강제 부여. <code>kurlydotcom.mk_member_vip</code> 테이블.
        </p>
        <div className="mt-3 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-900 leading-relaxed">
          👑 <strong>등급 부여</strong> — <code>mk_member_vip</code> UPSERT (member_no 기준: 있으면 갱신, 없으면 추가) · 인증 불필요(STG DB 직접)
          <br />
          📅 <strong>유효기간</strong> — started_at ~ expired_at 직접 지정 · updated_at/created_at 은 NOW() 자동
          <br />
          👥 <strong>여러 회원 동시 처리</strong> — 한 줄에 하나씩 또는 쉼표 구분 (최대 100명)
        </div>
      </div>

      <VipForm />

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
