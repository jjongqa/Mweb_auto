// Phase 2 멀티 분할 수행 — 같은 chunk_group_id 청크 잡들의 결과를 하나로 합산.
// 청크는 서로소(disjoint) TC 부분집합이라 단순 합산이 정확. (원본 No 보존 전제)
import { db, type Job } from "./db";
import { getChunkSiblings } from "./jobs";
import { getWorker } from "./workers";

export interface ChunkGroupSummary {
  groupId: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  chunkTotal: number; // 계획된 청크 수(chunk_total)
  chunkCount: number; // 실제 잡 수
  doneCount: number; // 완료(succeeded/failed/canceled)
  running: boolean; // 아직 진행 중인 청크 있음
  status: "running" | "succeeded" | "failed" | "canceled";
  slots: number;          // 담당 워커의 동시 처리 슬롯 수(max_concurrent). 미상(워커 미등록)이면 0.
  serialOverflow: number; // 슬롯을 초과해 순차 대기하는 청크 수(>0 이면 일부 직렬). slots 미상이면 0.
  jobs: Job[]; // chunk_index 순
}

export function aggregateChunkGroup(groupId: string): ChunkGroupSummary | null {
  const jobs = getChunkSiblings(groupId);
  if (jobs.length === 0) return null;
  let passed = 0,
    failed = 0,
    blocked = 0,
    total = 0,
    doneCount = 0;
  let anyFailed = false,
    anyCanceled = false,
    anyActive = false;
  for (const j of jobs) {
    passed += j.passed || 0;
    failed += j.failed || 0;
    blocked += j.blocked || 0;
    total += j.total || 0;
    if (j.status === "succeeded" || j.status === "failed" || j.status === "canceled") doneCount++;
    if (j.status === "failed") anyFailed = true;
    if (j.status === "canceled") anyCanceled = true;
    if (j.status === "pending" || j.status === "running") anyActive = true;
  }
  const status: ChunkGroupSummary["status"] = anyActive
    ? "running"
    : anyFailed
      ? "failed"
      : anyCanceled
        ? "canceled"
        : "succeeded";
  // 담당 워커의 동시 슬롯과 비교 — 슬롯보다 청크가 많으면 일부는 순차 대기(진짜 병렬 아님).
  // 워커 미등록(slots 미상)이면 헛경보 방지 위해 0 처리.
  const wName = jobs[0].worker_name;
  const slots = wName ? (getWorker(wName)?.max_concurrent ?? 0) : 0;
  const serialOverflow = slots > 0 ? Math.max(0, jobs.length - slots) : 0;
  return {
    groupId,
    total,
    passed,
    failed,
    blocked,
    chunkTotal: jobs[0].chunk_total ?? jobs.length,
    chunkCount: jobs.length,
    doneCount,
    running: anyActive,
    status,
    slots,
    serialOverflow,
    jobs,
  };
}

// 청크 그룹 전체의 TC 단위 결과(원본 No 기준). 청크는 서로소라 합집합.
export interface MergedTcRun {
  tc_no: string;
  result: string;
  job_id: string;
}
export function mergeChunkTcRuns(groupId: string): MergedTcRun[] {
  const jobs = getChunkSiblings(groupId);
  if (jobs.length === 0) return [];
  const ids = jobs.map((j) => j.id);
  const ph = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT job_id, tc_no, result FROM tc_execution_runs WHERE job_id IN (${ph})`)
    .all(...ids) as { job_id: string; tc_no: string; result: string }[];
  return rows
    .map((r) => ({ tc_no: r.tc_no, result: r.result, job_id: r.job_id }))
    .sort((a, b) => a.tc_no.localeCompare(b.tc_no, undefined, { numeric: true }));
}
