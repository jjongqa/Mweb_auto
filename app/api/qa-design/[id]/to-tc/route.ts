import { NextRequest } from "next/server";
import { createTcFromDesign, createTcGroupFromDesign, getTcGenJob } from "@/lib/tc-gen";
import { getGroupAgentsIfMulti } from "@/lib/agents";
import { sanitizePocs } from "@/lib/pocs";
import { getBuiltinWorkerName } from "@/lib/workers";

export const dynamic = "force-dynamic";

// POST /api/qa-design/:id/to-tc — 확정된 QA 설계를 반영한 TC 생성 잡 생성.
// body: { pocs: string[] } — 대상 POC(시트분류), 최소 1개.
// 설계 잡의 워커가 '작성(write)' 그룹 멀티면 → 작성 에이전트별 병렬 생성(분석 seed 공유 + 각자 지시) + 합본.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let pocs: string[] = [];
    let engine: string | null = null;
    try {
      const body = await req.json();
      pocs = sanitizePocs(body?.pocs);
      if (body?.engine === "harness" || body?.engine === "legacy") engine = body.engine;
    } catch { /* 빈 바디 → 아래 검증에서 막힘 */ }
    if (pocs.length === 0) {
      return Response.json({ error: "대상 POC(시트분류)를 1개 이상 선택해 주세요" }, { status: 400 });
    }
    // 작성 분할(멀티)은 legacy 엔진에서만 — 하네스는 holistic 파이프라인이라 외부 분할이 우회/충돌(과거 하네스 우회 버그 방지).
    const d = getTcGenJob(id);
    const writeWorker = d?.target_worker || getBuiltinWorkerName();
    const agents = engine === "legacy" ? getGroupAgentsIfMulti(writeWorker, "write") : [];
    if (agents.length >= 2) {
      const { groupId, ids } = createTcGroupFromDesign(id, pocs, agents.map((a) => ({ nickname: a.nickname, instruction: a.instruction })), engine);
      return Response.json({ ok: true, group_id: groupId, ids });
    }
    const tc = createTcFromDesign(id, pocs, engine);
    return Response.json({ ok: true, id: tc.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
