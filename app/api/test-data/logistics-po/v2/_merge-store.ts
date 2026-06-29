/** 실행 중 거래명세서 병합 선택을 위한 in-memory store (dev server 전용) */

export interface MergeChoice { mode: "new" | "merge"; codes: string[] }

interface PendingEntry { resolve: (c: MergeChoice) => void }

const KEY = "__po_v2_merge_pending__";

function getPending(): Map<string, PendingEntry> {
  const g = globalThis as any;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

/** runPoV2 흐름 중 호출: 사용자 선택을 기다리는 Promise 반환 */
export function waitForMergeChoice(runId: string): Promise<MergeChoice> {
  return new Promise((resolve) => { getPending().set(runId, { resolve }); });
}

/** merge-choice API에서 호출: 대기 중인 Promise를 resolve */
export function resolveMergeChoice(runId: string, choice: MergeChoice): boolean {
  const pending = getPending();
  const p = pending.get(runId);
  if (!p) return false;
  p.resolve(choice);
  pending.delete(runId);
  return true;
}
