import type { Agent, AgentGroup } from "@/lib/agents";
import { getOrSeedWorkerAgents, listAgents } from "@/lib/agents";
import { getBuiltinWorkerName } from "@/lib/workers";
import { AgentRunwayView, type RunwayAgent } from "./agent-runway-view";

type AgentLite = Pick<Agent, "nickname" | "hat" | "exp" | "color_c" | "color_b" | "color_s" | "grp" | "sort_order">;

function agentsFor(workerName: string | null | undefined): Agent[] {
  const worker = workerName || getBuiltinWorkerName();
  const existing = listAgents(worker);
  return existing.length > 0 ? existing : getOrSeedWorkerAgents(worker).agents;
}

export function getRunwayAgents(input: {
  workerName?: string | null;
  group: AgentGroup;
  nicknames?: (string | null | undefined)[];
  fallbackCount?: number;
}): AgentLite[] {
  const all = agentsFor(input.workerName);
  const names = (input.nicknames || []).filter((n): n is string => !!n && n.trim().length > 0);
  if (names.length > 0) {
    const picked = names
      .map((name) => all.find((a) => a.nickname === name))
      .filter((a): a is Agent => !!a);
    if (picked.length > 0) return picked;
  }
  const groupAgents = all.filter((a) => a.grp === input.group);
  if (groupAgents.length > 0) return groupAgents.slice(0, input.fallbackCount ?? 3);
  const main = all.find((a) => a.grp === "main");
  return main ? [main] : [];
}

export function AgentRunway({
  agents,
  progress = 35,
  phase,
  status = "running",
  compact = false,
}: {
  agents: AgentLite[];
  progress?: number;
  phase: "design" | "write" | "exec";
  status?: "pending" | "running";
  compact?: boolean;
}) {
  if (agents.length === 0) return null;
  return (
    <AgentRunwayView
      agents={agents as RunwayAgent[]}
      progress={progress}
      phase={phase}
      status={status}
      compact={compact}
    />
  );
}
