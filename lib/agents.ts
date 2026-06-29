// 에이전트 오피스 — 워커별 개인 에이전트 구성 (Phase 1: 구성/상태 저장만, 오케스트레이션은 추후).
// 각 워커가 메인 1 + 설계/작성/수행 3씩을 가지며, 그룹별 단일/멀티 토글·이름·캐릭터를 가진다.
import { db } from "./db";

export type AgentGroup = "main" | "design" | "write" | "exec" | "data";
export type AgentMode = "single" | "multi";

export interface Agent {
  id: number;
  worker_name: string;
  grp: AgentGroup;
  nickname: string;
  hat: string; // cap | crown | wizard | helmet | bandana
  exp: string; // smile | neutral | happy | focused | cool
  color_c: string;
  color_b: string;
  color_s: string;
  sort_order: number;
  instruction: string; // 이 에이전트에게 줄 지시 — 멀티 수행 시 프롬프트에 주입 (Phase 2)
}

export interface WorkerAgentState {
  agents: Agent[];
  modes: Record<string, AgentMode>; // design/write/exec/data -> mode
}

// 작성(write) — 멀티 시 '작성 지시기반 병렬'(legacy 엔진 전용; 하네스는 내부 멀티에이전트로 holistic 처리해 외부 분할 불필요).
export const SUB_GROUPS: AgentGroup[] = ["design", "write", "exec", "data"];

export const GROUP_LABEL: Record<AgentGroup, string> = {
  main: "메인",
  design: "설계",
  write: "작성",
  exec: "수행",
  data: "테스트데이터",
};

// 시드 기본 캐릭터 (목업과 동일). instruction 은 빈 값(DEFAULT '')으로 시작.
const SEED: Omit<Agent, "id" | "worker_name" | "instruction">[] = [
  { grp: "main",   nickname: "메인",     hat: "crown",   exp: "happy",   color_c: "#F4C430", color_b: "#7E57C2", color_s: "#F2C49B", sort_order: 0 },
  { grp: "design", nickname: "아키",     hat: "wizard",  exp: "smile",   color_c: "#7E57C2", color_b: "#185FA5", color_s: "#F5C9A0", sort_order: 0 },
  { grp: "design", nickname: "플래너",   hat: "cap",     exp: "neutral", color_c: "#185FA5", color_b: "#1D9E75", color_s: "#D9A066", sort_order: 1 },
  { grp: "design", nickname: "스캐너",   hat: "bandana", exp: "cool",    color_c: "#1D9E75", color_b: "#993C1D", color_s: "#EBB07C", sort_order: 2 },
  { grp: "write",  nickname: "드래프트", hat: "helmet",  exp: "focused", color_c: "#0F6E56", color_b: "#BA7517", color_s: "#C68642", sort_order: 0 },
  { grp: "write",  nickname: "펜",       hat: "wizard",  exp: "smile",   color_c: "#BA7517", color_b: "#534AB7", color_s: "#F2C49B", sort_order: 1 },
  { grp: "write",  nickname: "스크립트", hat: "cap",     exp: "neutral", color_c: "#534AB7", color_b: "#E24B4A", color_s: "#D9A066", sort_order: 2 },
  { grp: "exec",   nickname: "러너",     hat: "bandana", exp: "happy",   color_c: "#993C1D", color_b: "#185FA5", color_s: "#EBB07C", sort_order: 0 },
  { grp: "exec",   nickname: "대시",     hat: "helmet",  exp: "focused", color_c: "#D85A30", color_b: "#0F6E56", color_s: "#C68642", sort_order: 1 },
  { grp: "exec",   nickname: "스프린트", hat: "cap",     exp: "smile",   color_c: "#534AB7", color_b: "#BA7517", color_s: "#F5C9A0", sort_order: 2 },
  { grp: "data",   nickname: "데이터",   hat: "helmet",  exp: "focused", color_c: "#0F6E56", color_b: "#185FA5", color_s: "#F2C49B", sort_order: 0 },
  { grp: "data",   nickname: "셋업",     hat: "cap",     exp: "smile",   color_c: "#1D9E75", color_b: "#BA7517", color_s: "#D9A066", sort_order: 1 },
  { grp: "data",   nickname: "검증",     hat: "wizard",  exp: "cool",    color_c: "#7E57C2", color_b: "#0F6E56", color_s: "#F5C9A0", sort_order: 2 },
];

// 에이전트 추가 시 돌려쓸 캐릭터 변형
const VARIANTS: Pick<Agent, "hat" | "exp" | "color_c" | "color_b" | "color_s">[] = [
  { hat: "cap",     exp: "smile",   color_c: "#378ADD", color_b: "#BA7517", color_s: "#F5C9A0" },
  { hat: "wizard",  exp: "cool",    color_c: "#D85A30", color_b: "#185FA5", color_s: "#D9A066" },
  { hat: "helmet",  exp: "focused", color_c: "#0F6E56", color_b: "#534AB7", color_s: "#EBB07C" },
  { hat: "bandana", exp: "happy",   color_c: "#BA7517", color_b: "#1D9E75", color_s: "#C68642" },
];

export function getOrSeedWorkerAgents(worker: string): WorkerAgentState {
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM worker_agents WHERE worker_name=?`).get(worker) as { n: number };
  if (existing.n === 0) {
    const ins = db.prepare(
      `INSERT INTO worker_agents (worker_name, grp, nickname, hat, exp, color_c, color_b, color_s, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    const seedAll = db.transaction(() => {
      for (const a of SEED) ins.run(worker, a.grp, a.nickname, a.hat, a.exp, a.color_c, a.color_b, a.color_s, a.sort_order);
      const insMode = db.prepare(`INSERT OR IGNORE INTO worker_agent_settings (worker_name, grp, mode) VALUES (?,?, 'single')`);
      for (const g of SUB_GROUPS) insMode.run(worker, g);
    });
    seedAll();
  } else {
    const existingGroups = new Set(
      (db.prepare(`SELECT DISTINCT grp FROM worker_agents WHERE worker_name=?`).all(worker) as { grp: string }[]).map((r) => r.grp)
    );
    const maxOrder = (grp: AgentGroup) =>
      (db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM worker_agents WHERE worker_name=? AND grp=?`).get(worker, grp) as { n: number }).n;
    const ins = db.prepare(
      `INSERT INTO worker_agents (worker_name, grp, nickname, hat, exp, color_c, color_b, color_s, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    const patch = db.transaction(() => {
      for (const g of SUB_GROUPS) {
        db.prepare(`INSERT OR IGNORE INTO worker_agent_settings (worker_name, grp, mode) VALUES (?,?, 'single')`).run(worker, g);
      }
      if (!existingGroups.has("data")) {
        for (const a of SEED.filter((x) => x.grp === "data")) {
          ins.run(worker, a.grp, a.nickname, a.hat, a.exp, a.color_c, a.color_b, a.color_s, maxOrder("data") + 1);
        }
      } else {
        const existingDataNames = new Set(
          (db.prepare(`SELECT nickname FROM worker_agents WHERE worker_name=? AND grp='data'`).all(worker) as { nickname: string }[]).map((r) => r.nickname)
        );
        for (const a of SEED.filter((x) => x.grp === "data" && !existingDataNames.has(x.nickname))) {
          ins.run(worker, a.grp, a.nickname, a.hat, a.exp, a.color_c, a.color_b, a.color_s, maxOrder("data") + 1);
        }
      }
    });
    patch();
  }
  return { agents: listAgents(worker), modes: getModes(worker) };
}

export function listAgents(worker: string): Agent[] {
  return db
    .prepare(`SELECT * FROM worker_agents WHERE worker_name=? ORDER BY grp, sort_order, id`)
    .all(worker) as Agent[];
}

export function getModes(worker: string): Record<string, AgentMode> {
  const rows = db.prepare(`SELECT grp, mode FROM worker_agent_settings WHERE worker_name=?`).all(worker) as {
    grp: string;
    mode: AgentMode;
  }[];
  const out: Record<string, AgentMode> = { design: "single", write: "single", exec: "single", data: "single" };
  for (const r of rows) out[r.grp] = r.mode;
  return out;
}

// Phase 2: 워커의 특정 그룹이 'multi' 모드면 그 그룹의 에이전트들(정렬순)을 반환, 아니면 빈 배열.
// 멀티 분할 수행에서 "이 워커가 이 그룹을 몇 명으로 병렬 돌릴지 + 각자 지시"를 결정하는 데 사용.
export function getGroupAgentsIfMulti(worker: string, grp: AgentGroup): Agent[] {
  if (getModes(worker)[grp] !== "multi") return [];
  return listAgents(worker).filter((a) => a.grp === grp);
}

export function renameAgent(id: number, nickname: string): boolean {
  const name = nickname.trim().slice(0, 24);
  if (!name) return false;
  const r = db.prepare(`UPDATE worker_agents SET nickname=? WHERE id=?`).run(name, id);
  return r.changes > 0;
}

// 에이전트별 지시 저장 — 빈 문자열 허용(지우기). 최대 2000자.
export function setAgentInstruction(id: number, instruction: string): boolean {
  const text = (instruction || "").slice(0, 2000);
  return db.prepare(`UPDATE worker_agents SET instruction=? WHERE id=?`).run(text, id).changes > 0;
}

export function setGroupMode(worker: string, grp: AgentGroup, mode: AgentMode): void {
  db.prepare(
    `INSERT INTO worker_agent_settings (worker_name, grp, mode) VALUES (?,?,?)
     ON CONFLICT(worker_name, grp) DO UPDATE SET mode=excluded.mode`
  ).run(worker, grp, mode);
}

export function addAgent(worker: string, grp: AgentGroup): Agent {
  const cnt = db.prepare(`SELECT COUNT(*) AS n FROM worker_agents WHERE worker_name=? AND grp=?`).get(worker, grp) as {
    n: number;
  };
  const v = VARIANTS[cnt.n % VARIANTS.length];
  const info = db
    .prepare(
      `INSERT INTO worker_agents (worker_name, grp, nickname, hat, exp, color_c, color_b, color_s, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(worker, grp, `새 에이전트`, v.hat, v.exp, v.color_c, v.color_b, v.color_s, cnt.n);
  return db.prepare(`SELECT * FROM worker_agents WHERE id=?`).get(info.lastInsertRowid) as Agent;
}

export function deleteAgent(id: number): boolean {
  const row = db.prepare(`SELECT grp FROM worker_agents WHERE id=?`).get(id) as { grp: string } | undefined;
  if (!row || row.grp === "main") return false; // 메인은 삭제 불가
  return db.prepare(`DELETE FROM worker_agents WHERE id=?`).run(id).changes > 0;
}
