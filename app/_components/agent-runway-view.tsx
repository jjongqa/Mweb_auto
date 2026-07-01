"use client";

import { PixelAgent } from "@/app/agents/pixel-agent";

export type RunwayAgent = {
  nickname: string;
  hat: string;
  exp: string;
  color_c: string;
  color_b: string;
  color_s: string;
};

function phaseCopy(phase: "design" | "write" | "exec") {
  if (phase === "design") return { title: "설계 에이전트 질주 중", done: "요구사항 지도를 거의 다 그렸어요", label: "설계 중" };
  if (phase === "write") return { title: "작성 에이전트 질주 중", done: "TC 결승선이 보여요", label: "작성 중" };
  return { title: "수행 에이전트 질주 중", done: "거의 다 왔어요. 헥헥...", label: "수행 중" };
}

export function AgentRunwayView({
  agents,
  progress = 35,
  phase,
  status = "running",
  compact = false,
}: {
  agents: RunwayAgent[];
  progress?: number;
  phase: "design" | "write" | "exec";
  status?: "pending" | "running";
  compact?: boolean;
}) {
  if (agents.length === 0) return null;
  const copy = phaseCopy(phase);
  const clamped = Math.max(4, Math.min(96, progress));
  const almostDone = clamped >= 85;
  const active = status === "running";
  const motion = active ? (almostDone ? "exhausted" : "run") : "hop";

  return (
    <section className={`card overflow-hidden border-violet-200 bg-violet-50/60 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-violet-950">
            {active ? copy.title : `${copy.label} 대기선`}
          </div>
          <div className="mt-0.5 text-xs text-violet-700">
            {active ? (almostDone ? copy.done : "에이전트들이 각자 맡은 구간을 달리는 중이에요") : "워커가 잡을 잡으면 바로 출발합니다"}
          </div>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200">
          {active ? `${Math.round(clamped)}%` : "READY"}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
        <div className="relative h-20 overflow-hidden rounded-lg bg-gradient-to-r from-white via-violet-50 to-white">
          <div className={`absolute bottom-5 left-0 right-0 h-2 rounded-full bg-violet-100 ${active ? "agent-track-moving" : ""}`} />
          <div className="absolute bottom-2 left-2 text-[10px] font-medium text-violet-300">START</div>
          <div className="absolute bottom-2 right-2 text-[10px] font-medium text-violet-400">GOAL</div>
          {agents.slice(0, 4).map((agent, index) => {
            const offset = agents.length === 1 ? 0 : (index - (agents.length - 1) / 2) * 8;
            const left = Math.max(6, Math.min(88, clamped + offset));
            return (
              <div
                key={`${agent.nickname}-${index}`}
                className="absolute bottom-5 flex -translate-x-1/2 flex-col items-center transition-[left] duration-700 ease-out"
                style={{ left: `${left}%` }}
              >
                <div className="relative">
                  <PixelAgent
                    hat={agent.hat}
                    exp={almostDone ? "focused" : agent.exp}
                    c={agent.color_c}
                    b={agent.color_b}
                    s={agent.color_s}
                    size={compact ? 38 : 46}
                    motion={motion}
                  />
                  {almostDone && active && (
                    <span className="absolute -right-4 -top-2 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-rose-500 shadow-sm ring-1 ring-rose-100">
                      헥
                    </span>
                  )}
                </div>
                <span className="mt-1 max-w-[72px] truncate rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-violet-800 ring-1 ring-violet-100">
                  {agent.nickname}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
