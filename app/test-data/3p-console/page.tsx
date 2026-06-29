import Link from "next/link";
import { THREEP_CATALOG } from "@/lib/threep-openapi-catalog";
import { ThreePConsole } from "./console";

export const dynamic = "force-dynamic";

export default function ThreePConsolePage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/test-data" className="text-sm text-neutral-500 hover:text-kurly-500">← 테스트 데이터</Link>
        <h1 className="mt-1 text-2xl font-bold">🔌 3P 파트너 OpenAPI 콘솔</h1>
        <p className="mt-2 text-sm text-neutral-600">
          3P 파트너오피스 OpenAPI <strong>{THREEP_CATALOG.length}개</strong>를 어드민에서 직접 호출. 토큰은 서버가 주입(STG 파트너 토큰)하고,
          <strong className="text-emerald-600"> 조회는 바로</strong> · <strong className="text-amber-600">변경은 확인 후</strong> 실행합니다.
        </p>
      </div>
      <ThreePConsole catalog={THREEP_CATALOG} />
    </div>
  );
}
