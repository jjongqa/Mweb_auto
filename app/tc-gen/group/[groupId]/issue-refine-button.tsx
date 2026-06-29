"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Issue = {
  severity: "error" | "warn";
  code: string;
  message: string;
  rows?: string[];
};

type AgentTarget = {
  id: string;
  nickname: string;
  score: number;
  error: number;
  warn: number;
};

type RefineResponse = {
  ok?: boolean;
  id?: string;
  error?: string;
};

function buildIssueInstructions(issues: Issue[], groupScore: number, groupTotalRows: number) {
  const issueLines = issues.slice(0, 10).map((issue) => {
    const rows = issue.rows?.length ? ` / 대상 ${issue.code === "MISSING_REQ_COVERAGE" ? "REQ" : "No."}: ${issue.rows.join(", ")}` : "";
    return `- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}${rows}`;
  });

  return `[GROUP_ISSUE_REFINE]

종합 TC 품질 리뷰에서 발견된 이슈만 보정한다.
현재 종합 점수: ${groupScore}/100, 합본 TC: ${groupTotalRows}건

종합 리뷰 이슈:
${issueLines.length ? issueLines.join("\n") : "- 표시된 이슈 없음"}

개선 지시:
- 다른 에이전트 담당 영역의 TC는 새로 작성하지 않는다.
- 기존 REQ-ID 커버리지는 유지한다. Tags/Title에 있던 REQ-ID를 누락하지 않는다.
- 동일 REQ-ID라도 조건, 트리거, 기대결과가 완전히 같은 TC는 만들지 않는다.
- 한 TC에 여러 검증 의도를 섞지 않는다. MULTI_INTENT 대상은 하나의 검증 의도만 남기거나 분리한다.
- DUPLICATE_TITLE/DUPLICATE_INTENT 대상은 제목, 사전조건, 경로, 기대결과의 차이가 드러나게 수정하거나 중복을 제거한다.
- Expected Result는 "정상 노출된다"처럼 쓰지 말고 화면 위치, 문구, 상태, 미노출 조건이 드러나게 작성한다.
- 좋은 TC는 유지하고, 이슈가 있는 행만 수정/삭제/분리/보강한다.
- TC 수를 불필요하게 늘리지 않는다. 새 TC 추가는 중복 제거/검증 의도 분리에 필요한 경우로 제한한다.
- 최종 출력은 전체 CSV만 재출력한다.`;
}

export function GroupIssueRefineButton({
  agents,
  issues,
  groupScore,
  groupTotalRows,
  threshold,
}: {
  agents: AgentTarget[];
  issues: Issue[];
  groupScore: number;
  groupTotalRows: number;
  threshold: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const targets = useMemo(() => {
    const issueTargets = agents.filter((agent) => agent.score < threshold || agent.error > 0 || agent.warn > 0);
    return issueTargets.length > 0 ? issueTargets : agents;
  }, [agents, threshold]);

  if (issues.length === 0 || targets.length === 0) return null;

  async function go() {
    setBusy(true);
    setMsg("");
    const instructions = buildIssueInstructions(issues, groupScore, groupTotalRows);
    try {
      const results = await Promise.all(
        targets.map(async (target): Promise<RefineResponse> => {
          try {
            const res = await fetch(`/api/tc-gen/${target.id}/refine`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ instructions }),
            });
            const json = (await res.json().catch(() => ({}))) as RefineResponse;
            if (!res.ok) return { ok: false, error: json.error || `HTTP ${res.status}` };
            return json;
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        })
      );

      const started = results.filter((r): r is RefineResponse & { ok: true; id: string } => Boolean(r.ok && r.id));
      if (started.length === 0) {
        const errors = results.map((r) => r.error).filter(Boolean);
        setMsg(errors.length > 0 ? `추가 개선 실패: ${errors.slice(0, 2).join(" / ")}` : "추가 개선을 시작하지 못했어요.");
        return;
      }

      setMsg(`이슈 기반 추가 개선 ${started.length}건 시작. 이동합니다...`);
      router.push(`/tc-gen/${started[0].id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
        title="종합 품질 리뷰의 warn/error를 개선 지시로 바꿔 대상 에이전트 결과를 다시 생성합니다."
      >
        {busy ? "추가 개선 시작 중..." : `이슈 기반 추가 개선 · 대상 ${targets.length}명`}
      </button>
      <span className="text-[11px] text-neutral-500">
        warn/error 행만 보정하고 REQ 커버리지는 유지합니다.
      </span>
      {msg && <span className="text-[11px] text-cyan-700">{msg}</span>}
    </div>
  );
}
