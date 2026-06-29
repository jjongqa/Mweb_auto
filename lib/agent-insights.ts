import { db } from "./db";
import { readTcQualityReview, reviewQaDesignQuality, type TcQualityReview } from "./tc-gen";

export interface AgentInsight {
  nickname: string;
  grp: "design" | "write";
  runs: number;
  avgScore: number | null;
  bestScore: number | null;
  lowRuns: number;
  issueCounts: { error: number; warn: number };
  topIssues: { code: string; count: number }[];
  suggestions: string[];
}

export interface AgentOfficeInsights {
  byNickname: Record<string, AgentInsight>;
  summary: {
    totalRuns: number;
    weakAgents: string[];
    repeatedIssueCodes: { code: string; count: number }[];
  };
}

type TcRow = {
  id: string;
  kind: "design" | "tc";
  agent_nickname: string | null;
  output_path: string | null;
  qa_analysis: string | null;
};

function issueWeight(review: Pick<TcQualityReview, "issues">): Map<string, number> {
  const out = new Map<string, number>();
  for (const issue of review.issues) {
    const n = Math.max(1, issue.rows?.length ?? 1);
    out.set(issue.code, (out.get(issue.code) ?? 0) + n);
  }
  return out;
}

function suggestionFor(code: string): string | null {
  if (code === "DUPLICATE_TITLE" || code === "DUPLICATE_INTENT") {
    return "동일 Title/동일 의도 TC를 만들지 않는다. 같은 REQ-ID라도 조건, 트리거, 기대결과 중 하나 이상이 명확히 다를 때만 별도 TC로 작성한다.";
  }
  if (code === "MULTI_INTENT") {
    return "한 TC에는 하나의 검증 의도만 둔다. Expected Result에 여러 판정 기준이 필요한 경우 화면 상태 단위로 TC를 분리한다.";
  }
  if (code === "WEAK_EXPECTED") {
    return "Expected Result는 화면 위치, 문구, 상태, 미노출 조건, 저장/차단 결과가 관찰 가능하게 드러나도록 작성한다.";
  }
  if (code === "WEAK_PRECONDITION" || code === "EMPTY_PRECONDITION") {
    return "Pre-condition에는 회원 상태, 권한, 진입 화면, 사전 데이터, 노출/미노출 조건을 실행자가 바로 준비할 수 있게 작성한다.";
  }
  if (code === "MISSING_REQ_COVERAGE") {
    return "Tags 또는 Title에 관련 REQ-ID를 반드시 포함하고, 담당 영역의 미커버 REQ가 없도록 정상/예외/경계 케이스를 보강한다.";
  }
  if (code === "NO_TC_MATRIX" || code === "NO_REQ_INVENTORY") {
    return "TC 작성 전 REQ-ID별 조건, 트리거, 기대결과, 우선순위, 대상 POC를 매트릭스로 정리한다.";
  }
  if (code === "NO_COVERAGE_STRATEGY" || code === "NO_RISK") {
    return "정상, 예외, 경계, 미노출, 회귀 영향 범위를 REQ별로 분리하고 리스크가 큰 영역을 우선순위로 표시한다.";
  }
  return null;
}

function emptyInsight(nickname: string, grp: "design" | "write"): AgentInsight {
  return {
    nickname,
    grp,
    runs: 0,
    avgScore: null,
    bestScore: null,
    lowRuns: 0,
    issueCounts: { error: 0, warn: 0 },
    topIssues: [],
    suggestions: [],
  };
}

export function getAgentOfficeInsights(worker: string): AgentOfficeInsights {
  const rows = db.prepare(`
    SELECT id, kind, agent_nickname, output_path, qa_analysis
    FROM tc_gen_jobs
    WHERE agent_nickname IS NOT NULL
      AND agent_nickname <> ''
      AND kind IN ('design', 'tc')
      AND status = 'succeeded'
      AND COALESCE(target_worker, worker_name, '') = ?
    ORDER BY created_at DESC
    LIMIT 120
  `).all(worker) as TcRow[];

  const acc = new Map<string, {
    insight: AgentInsight;
    scores: number[];
    issues: Map<string, number>;
  }>();
  const globalIssues = new Map<string, number>();

  for (const row of rows) {
    const nickname = row.agent_nickname || "에이전트";
    const grp = row.kind === "design" ? "design" : "write";
    const key = `${grp}:${nickname}`;
    if (!acc.has(key)) acc.set(key, { insight: emptyInsight(nickname, grp), scores: [], issues: new Map() });
    const slot = acc.get(key)!;
    const review = row.kind === "design"
      ? reviewQaDesignQuality(row.qa_analysis)
      : readTcQualityReview(row.output_path);
    if (!review) continue;
    slot.insight.runs++;
    slot.scores.push(review.score);
    if (review.score < 90) slot.insight.lowRuns++;
    slot.insight.issueCounts.error += review.issueCounts.error;
    slot.insight.issueCounts.warn += review.issueCounts.warn;
    for (const [code, n] of issueWeight(review).entries()) {
      slot.issues.set(code, (slot.issues.get(code) ?? 0) + n);
      globalIssues.set(code, (globalIssues.get(code) ?? 0) + n);
    }
  }

  const byNickname: Record<string, AgentInsight> = {};
  for (const { insight, scores, issues } of acc.values()) {
    if (scores.length > 0) {
      insight.avgScore = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
      insight.bestScore = Math.max(...scores);
    }
    insight.topIssues = [...issues.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([code, count]) => ({ code, count }));
    insight.suggestions = [...new Set(insight.topIssues.map((i) => suggestionFor(i.code)).filter((v): v is string => !!v))].slice(0, 3);
    byNickname[`${insight.grp}:${insight.nickname}`] = insight;
  }

  return {
    byNickname,
    summary: {
      totalRuns: rows.length,
      weakAgents: Object.values(byNickname)
        .filter((i) => i.avgScore !== null && (i.avgScore < 90 || i.lowRuns > 0))
        .map((i) => `${i.nickname}(${i.avgScore ?? "-"}점)`),
      repeatedIssueCodes: [...globalIssues.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([code, count]) => ({ code, count })),
    },
  };
}
