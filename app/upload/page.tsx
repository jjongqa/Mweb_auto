import { UploadForm } from "./form";
import { avgSecPerTcByDomain } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  // 도메인별 실측 평균(초/건) — 폼의 예상 실행시간 추정에 사용
  const domainAvgSec = avgSecPerTcByDomain();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">기능테스트</h1>
        <p className="mt-1 text-sm text-neutral-600">
          TC CSV를 업로드하면 도메인·플랫폼을 자동 분석해 추천해줍니다.
        </p>
      </div>
      <UploadForm domainAvgSec={domainAvgSec} />
    </div>
  );
}
