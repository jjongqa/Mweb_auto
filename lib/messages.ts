import { db, type PendingMessage } from "./db";

/**
 * v1.7 — 진행 중 잡에 끼어들기 메시지 큐.
 * 사용자가 잡 상세에서 입력 → API → addPendingMessage 로 큐 적재 →
 * 워커가 turn 사이 polling 으로 takeNextPendingMessage 호출 →
 * Claude CLI stdin 에 stream-json 형식으로 push.
 */

export function addPendingMessage(jobId: string, content: string): PendingMessage {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("메시지 내용이 비어있습니다");
  const res = db.prepare(
    `INSERT INTO pending_messages (job_id, content) VALUES (?, ?)`
  ).run(jobId, trimmed);
  return db.prepare(`SELECT * FROM pending_messages WHERE id = ?`).get(Number(res.lastInsertRowid)) as PendingMessage;
}

/**
 * pending 상태 메시지 중 가장 오래된 1건을 가져오고 delivered 로 표시.
 * 워커가 호출 — 동시 호출 방어용으로 트랜잭션.
 */
export function takeNextPendingMessage(jobId: string): PendingMessage | null {
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT * FROM pending_messages
       WHERE job_id = ? AND status = 'pending'
       ORDER BY id ASC LIMIT 1`
    ).get(jobId) as PendingMessage | undefined;
    if (!row) return null;
    db.prepare(
      `UPDATE pending_messages SET status='delivered', delivered_at=datetime('now') WHERE id = ?`
    ).run(row.id);
    return { ...row, status: "delivered" as const, delivered_at: new Date().toISOString() };
  })();
}

export function markMessageFailed(id: number, _reason?: string): void {
  db.prepare(`UPDATE pending_messages SET status='failed' WHERE id = ?`).run(id);
}

export function listMessagesForJob(jobId: string): PendingMessage[] {
  return db.prepare(
    `SELECT * FROM pending_messages WHERE job_id = ? ORDER BY id ASC`
  ).all(jobId) as PendingMessage[];
}

export function countPendingForJob(jobId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM pending_messages WHERE job_id = ? AND status = 'pending'`
  ).get(jobId) as { cnt: number };
  return row.cnt;
}
