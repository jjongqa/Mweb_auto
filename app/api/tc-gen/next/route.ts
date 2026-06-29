import { NextRequest } from "next/server";
import { claimNextTcGenJob } from "@/lib/tc-gen";

export const dynamic = "force-dynamic";

// GET /api/tc-gen/next?worker=NAME — 가장 오래된 pending TC설계/작성 잡을 워커에 배정.
// 반환: { job: { id, kind, prompt, model } } 또는 { job: null }.
// 워커는 prompt 로 claude -p 를 로컬 실행(=그 워커 claude 토큰) 후 /api/tc-gen/:id/result 로 회신.
export async function GET(req: NextRequest) {
  const worker = (req.nextUrl.searchParams.get("worker") ?? "").trim();
  if (!worker) return Response.json({ error: "worker 파라미터 필수" }, { status: 400 });
  try {
    const job = claimNextTcGenJob(worker);
    return Response.json({ job });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
