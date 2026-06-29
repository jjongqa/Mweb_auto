import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { getAgentOfficeInsights } from "@/lib/agent-insights";
import type { Agent } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MODEL = process.env.AGENT_TUNE_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function runClaude(prompt: string): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    let proc;
    try {
      proc = spawn(CLAUDE_BIN, ["-p", "--model", MODEL, "--dangerously-skip-permissions"], {
        cwd: process.cwd(),
        env: { ...process.env },
      });
    } catch (e) {
      resolve({ ok: false, output: "", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    const timer = setTimeout(() => {
      if (!done) {
        try { proc.kill("SIGKILL"); } catch {}
      }
    }, 90_000);
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => { out += c; });
    proc.stderr.on("data", (c) => { err += c; });
    proc.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, output: out, error: e.message });
    });
    proc.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, output: out, error: code === 0 ? undefined : err || `claude exited ${code}` });
    });
    proc.stdin.end(prompt);
  });
}

function extractJson(text: string): { proposed_instruction?: string; summary?: string } | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const id = Number(body.id);
  if (!id) return json({ error: "id 필수" }, 400);

  const agent = db.prepare(`SELECT * FROM worker_agents WHERE id=?`).get(id) as Agent | undefined;
  if (!agent) return json({ error: "에이전트를 찾을 수 없습니다." }, 404);
  if (!["design", "write", "main"].includes(agent.grp)) return json({ error: "설계/작성/메인 에이전트만 튜닝할 수 있습니다." }, 400);

  const insights = getAgentOfficeInsights(agent.worker_name);
  const insight = insights.byNickname[`${agent.grp}:${agent.nickname}`] ?? null;
  const issueLines = insight?.topIssues?.map((i) => `- ${i.code}: ${i.count}`).join("\n") || "- 아직 반복 이슈 데이터가 적음";
  const ruleSuggestions = insight?.suggestions?.map((s) => `- ${s}`).join("\n") || "- 없음";

  const prompt = `너는 QA AI Hub의 에이전트 지시사항 튜닝 담당이다.

목표:
- 현재 에이전트 지시사항을 완전히 갈아엎지 말고, 기존 역할은 유지한다.
- 최근 반복 품질 이슈를 줄이도록 지시사항을 더 구체적이고 실행 가능하게 재작성한다.
- 다른 에이전트 담당 영역을 침범하지 않도록 역할 경계를 분명히 한다.
- 한국어로 작성한다.
- 최종 결과는 JSON만 출력한다.

에이전트:
- 그룹: ${agent.grp}
- 이름: ${agent.nickname}

현재 지시사항:
${agent.instruction?.trim() || "(비어 있음)"}

최근 반복 품질 이슈:
${issueLines}

기존 규칙 기반 개선 힌트:
${ruleSuggestions}

출력 형식:
{
  "summary": "무엇을 왜 바꿨는지 한 문장",
  "proposed_instruction": "개선된 전체 지시사항"
}

주의:
- proposed_instruction에는 전체 지시사항을 넣는다. 일부 패치만 쓰지 않는다.
- 2000자 이내로 쓴다.
- CSV, TC 본문, 마크다운 설명은 출력하지 않는다. JSON만 출력한다.`;

  const result = await runClaude(prompt);
  if (!result.ok) return json({ error: `AI 개선안 생성 실패: ${result.error || "unknown"}` }, 500);

  const parsed = extractJson(result.output);
  const proposed = parsed?.proposed_instruction?.trim();
  if (!proposed) return json({ error: "AI 응답에서 개선 지시사항을 찾지 못했습니다.", raw: result.output.slice(0, 1000) }, 500);

  return json({
    ok: true,
    id,
    model: MODEL,
    summary: parsed?.summary || "반복 품질 이슈를 줄이도록 지시사항을 보강했습니다.",
    current_instruction: agent.instruction || "",
    proposed_instruction: proposed.slice(0, 2000),
  });
}
