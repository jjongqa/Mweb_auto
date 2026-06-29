import { listJobs, computeCumulativeResult } from "@/lib/jobs";
import { listWorkers } from "@/lib/workers";
import type { Job } from "@/lib/db";
import { HistoryTable, type JobGroup } from "./history-table";
import { BuProvider } from "@/app/_components/bu-domain-select";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const jobs = listJobs(200);
  // 워커 이름 → 별칭 매핑 (history-table 에 props 로 전달)
  const workerLabels: Record<string, string> = {};
  for (const w of listWorkers()) {
    if (w.label && w.label.trim()) workerLabels[w.name] = w.label.trim();
  }

  // 그룹화: ① 에이전트 멀티 분할(chunk_group_id) ② 재실행(parent_job_id). 둘 다 ▶로 접힘.
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const childrenOf = new Map<string, Job[]>();
  for (const j of jobs) {
    if (j.parent_job_id && byId.has(j.parent_job_id)) {
      const arr = childrenOf.get(j.parent_job_id) ?? [];
      arr.push(j);
      childrenOf.set(j.parent_job_id, arr);
    }
  }
  const collectDescendants = (id: string): Job[] => {
    const direct = childrenOf.get(id) ?? [];
    const out: Job[] = [];
    for (const c of direct) {
      out.push(c);
      out.push(...collectDescendants(c.id));
    }
    return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  };

  // 에이전트 청크 그룹: chunk_group_id 별로 chunk_index 순. root=첫 청크, 나머지=펼침 자식. 결과는 합산.
  const chunkSibs = new Map<string, Job[]>();
  for (const j of jobs) {
    if (j.chunk_group_id) {
      const a = chunkSibs.get(j.chunk_group_id) ?? [];
      a.push(j);
      chunkSibs.set(j.chunk_group_id, a);
    }
  }
  for (const a of chunkSibs.values()) a.sort((x, y) => (x.chunk_index ?? 0) - (y.chunk_index ?? 0));
  const isChunkGroup = (gid?: string | null) => !!gid && (chunkSibs.get(gid)?.length ?? 0) > 1;

  const groups: JobGroup[] = [];
  const seenChunk = new Set<string>();
  for (const j of jobs) {
    if (j.parent_job_id && byId.has(j.parent_job_id)) continue; // 재실행 자식 → 부모 그룹에 포함
    // ① 에이전트 청크 그룹 (그룹당 1번만, 첫 청크 기준)
    if (isChunkGroup(j.chunk_group_id)) {
      const gid = j.chunk_group_id!;
      if (seenChunk.has(gid)) continue;
      seenChunk.add(gid);
      const sibs = chunkSibs.get(gid)!; // chunk_index 순
      const root = sibs[0];
      const agg = sibs.reduce(
        (s, c) => ({ passed: s.passed + (c.passed || 0), failed: s.failed + (c.failed || 0), blocked: s.blocked + (c.blocked || 0), total: s.total + (c.total || 0) }),
        { passed: 0, failed: 0, blocked: 0, total: 0 }
      );
      groups.push({
        root,
        retries: sibs.slice(1),
        cumulative: null,
        isChunkGroup: true,
        chunkTotal: root.chunk_total ?? sibs.length,
        aggregate: { ...agg, chunkCount: sibs.length },
      });
      continue;
    }
    // ② 재실행 그룹
    const retries = collectDescendants(j.id);
    const cumulative = j.total > 0 && retries.length > 0
      ? (() => {
          const r = computeCumulativeResult(j);
          return { passed: r.passed, failed: r.failed, blocked: r.blocked, retryCount: r.retryCount };
        })()
      : null;
    groups.push({ root: j, retries, cumulative });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">실행 히스토리</h1>
      <p className="mt-1 text-sm text-neutral-600">
        최근 200건 기준. 에이전트 멀티 분할·재실행은 ▶ 으로 그룹화되어 접혀 있습니다.
      </p>
      <BuProvider>
        <HistoryTable groups={groups} workerLabels={workerLabels} />
      </BuProvider>
    </div>
  );
}
