import { NextRequest } from "next/server";
import {
  getOrSeedWorkerAgents,
  renameAgent,
  setGroupMode,
  setAgentInstruction,
  addAgent,
  deleteAgent,
  type AgentGroup,
  type AgentMode,
} from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

// GET /api/agents?worker=NAME — 워커의 에이전트 구성 (없으면 시드)
export async function GET(req: NextRequest) {
  const worker = (req.nextUrl.searchParams.get("worker") || "").trim();
  if (!worker) return json({ error: "worker 필수" }, 400);
  return json(getOrSeedWorkerAgents(worker));
}

// POST /api/agents — { action: rename | mode | add | delete, ... }
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = b.action;

  if (action === "rename") {
    const id = Number(b.id);
    const nickname = String(b.nickname || "");
    if (!id || !nickname.trim()) return json({ error: "id·nickname 필수" }, 400);
    return json({ ok: renameAgent(id, nickname) });
  }

  if (action === "mode") {
    const worker = String(b.worker || "").trim();
    const grp = String(b.grp || "") as AgentGroup;
    const mode = String(b.mode || "") as AgentMode;
    if (!worker || !["design", "write", "exec", "data"].includes(grp) || !["single", "multi"].includes(mode))
      return json({ error: "worker·grp·mode 확인" }, 400);
    setGroupMode(worker, grp, mode);
    return json({ ok: true });
  }

  if (action === "instruct") {
    const id = Number(b.id);
    if (!id) return json({ error: "id 필수" }, 400);
    const instruction = typeof b.instruction === "string" ? b.instruction : "";
    return json({ ok: setAgentInstruction(id, instruction) });
  }

  if (action === "add") {
    const worker = String(b.worker || "").trim();
    const grp = String(b.grp || "") as AgentGroup;
    if (!worker || !["design", "write", "exec", "data"].includes(grp)) return json({ error: "worker·grp 확인" }, 400);
    return json({ ok: true, agent: addAgent(worker, grp) });
  }

  if (action === "delete") {
    const id = Number(b.id);
    if (!id) return json({ error: "id 필수" }, 400);
    return json({ ok: deleteAgent(id) });
  }

  return json({ error: `알 수 없는 action: ${action}` }, 400);
}
