import { NextRequest } from "next/server";
import { listDriveAssets } from "@/lib/drive-sync";

export const dynamic = "force-dynamic";

// GET /api/drive-prompts — Drive 자산 트리(기능테스트 프롬프트 + TC 스킬 + 마스터정책)를 읽기 전용 그룹으로 반환.
// 기본은 캐시(매 진입마다 Drive 안 침). ?force=1 이면 캐시 무시하고 새로 조회.
export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const assets = await listDriveAssets(force);
  return Response.json(assets);
}
