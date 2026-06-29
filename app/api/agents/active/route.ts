import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getBuiltinWorkerName } from "@/lib/workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents/active?worker=NAME — 이 워커에서 지금 수행 중인 에이전트(닉네임) + 메인 활성 여부.
// 멀티 분할 청크 잡은 task_name 끝의 [닉네임] 으로 어떤 exec 에이전트가 도는지 식별.
// 단일(청크 아님) 잡이 돌면 메인이 수행 중인 것으로 본다.
// 테스트데이터 요청 큐는 특정 데이터 에이전트 닉네임을 저장하지 않으므로, 실행 중 요청 수만큼
// 현재 워커의 테스트데이터 에이전트를 sort_order 순서로 활성 표시한다.
export async function GET(req: NextRequest) {
  const worker = (req.nextUrl.searchParams.get("worker") || "").trim();
  if (!worker) return Response.json({ active: [], data: [], main: false });
  const builtin = getBuiltinWorkerName();

  const rows = db
    .prepare(`
      SELECT task_name, chunk_group_id
      FROM jobs
      WHERE status = 'running'
        AND (worker_name = ? OR (? = ? AND worker_name IS NULL))
    `)
    .all(worker, worker, builtin) as { task_name: string | null; chunk_group_id: string | null }[];

  const tcRows = db
    .prepare(`
      SELECT kind, agent_nickname, agent_group_id
      FROM tc_gen_jobs
      WHERE status = 'running'
        AND (worker_name = ? OR target_worker = ? OR (? = ? AND worker_name IS NULL AND target_worker IS NULL))
    `)
    .all(worker, worker, worker, builtin) as { kind: string | null; agent_nickname: string | null; agent_group_id: string | null }[];

  const dataRunning = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM data_requests
      WHERE status = 'running'
        AND claimed_by = ?
    `)
    .get(worker) as { n: number };

  const dataAgents = dataRunning.n > 0
    ? db
      .prepare(`
        SELECT nickname
        FROM worker_agents
        WHERE worker_name = ? AND grp = 'data'
        ORDER BY sort_order, id
        LIMIT ?
      `)
      .all(worker, Math.max(1, dataRunning.n)) as { nickname: string }[]
    : [];

  const active = new Set<string>();
  const design = new Set<string>();
  const write = new Set<string>();
  const data = new Set<string>();
  let main = false;
  for (const r of rows) {
    if (r.chunk_group_id) {
      const m = (r.task_name || "").match(/\[([^\]]+)\]\s*$/);
      if (m) active.add(m[1]);
      main = true; // 멀티 분할 진행 중 = 메인(오케스트레이터)도 지휘 중
    } else {
      main = true; // 단일 수행 = 메인이 직접 수행
    }
  }
  for (const r of tcRows) {
    main = true;
    if (!r.agent_nickname) continue;
    active.add(r.agent_nickname);
    if (r.kind === "design") design.add(r.agent_nickname);
    if (r.kind === "tc") write.add(r.agent_nickname);
  }
  for (const r of dataAgents) {
    if (!r.nickname) continue;
    active.add(r.nickname);
    data.add(r.nickname);
    main = true; // 데이터 큐도 수행 플로우의 보조 오케스트레이션으로 본다.
  }
  return Response.json({ active: [...active], design: [...design], write: [...write], exec: [...active], data: [...data], main });
}
