// v1.0 분산 워커 관리
// 인증 정책: 6번 — 사내망 누구나 등록 가능. PoC 한정.
// 정식 운영 전에는 1번 또는 7번으로 업그레이드 필요.

import { db } from "./db";

export function getBuiltinWorkerName(): string {
  return process.env.BUILTIN_WORKER_NAME || "jjong-MacBookAir";
}

export interface Worker {
  name: string;
  ip_address: string | null;
  capabilities: string | null;  // JSON: {"web":bool, "app":bool}
  status: "online" | "busy" | "offline";
  last_heartbeat: string | null;
  registered_at: string;
  total_jobs: number;
  note: string | null;
  active_jobs: number;        // v1.7 현재 처리 중 잡 수
  max_concurrent: number;     // v1.7 동시 처리 슬롯 수
  label: string | null;       // v1.7 사용자 친화 이름 (예: "안종관 Mac")
  version: string | null;     // 워커 패키지 버전(heartbeat 보고) — 미보고(구버전)면 null
}

// 워커의 표시 이름 — label 있으면 label, 없으면 name
export function workerDisplayName(w: Worker | { name: string; label?: string | null }): string {
  return (w.label && w.label.trim()) || w.name;
}

// label 변경
export function updateWorkerLabel(name: string, label: string | null): boolean {
  const exists = db.prepare(`SELECT 1 FROM workers WHERE name=?`).get(name);
  if (!exists) return false;
  const trimmed = label && label.trim() ? label.trim().slice(0, 100) : null;
  db.prepare(`UPDATE workers SET label=? WHERE name=?`).run(trimmed, name);
  return true;
}

export interface WorkerCapabilities {
  web?: boolean;
  app?: boolean;
}

// 워커 등록 — 인증 없음 (PoC). 같은 이름이면 갱신.
export function upsertWorker(input: {
  name: string;
  ip_address?: string | null;
  capabilities?: WorkerCapabilities;
}): Worker {
  const capJson = input.capabilities ? JSON.stringify(input.capabilities) : null;
  const existing = db.prepare(`SELECT name FROM workers WHERE name=?`).get(input.name) as { name: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE workers
      SET ip_address=?, capabilities=?, status='online', last_heartbeat=datetime('now')
      WHERE name=?
    `).run(input.ip_address ?? null, capJson, input.name);
  } else {
    db.prepare(`
      INSERT INTO workers (name, ip_address, capabilities, status, last_heartbeat)
      VALUES (?, ?, ?, 'online', datetime('now'))
    `).run(input.name, input.ip_address ?? null, capJson);
  }

  return db.prepare(`SELECT * FROM workers WHERE name=?`).get(input.name) as Worker;
}

// heartbeat 갱신
// v1.7 active_jobs / max_concurrent 도 함께 갱신 (워커가 자기 상태 보고)
export function updateWorkerHeartbeat(
  name: string,
  status?: "online" | "busy",
  meta?: { active_jobs?: number; max_concurrent?: number; version?: string | null }
): boolean {
  const exists = db.prepare(`SELECT 1 FROM workers WHERE name=?`).get(name);
  if (!exists) return false;
  const cols: string[] = ["last_heartbeat=datetime('now')"];
  const args: (string | number)[] = [];
  if (status) { cols.push("status=?"); args.push(status); }
  if (meta?.active_jobs !== undefined) { cols.push("active_jobs=?"); args.push(meta.active_jobs); }
  if (meta?.max_concurrent !== undefined) { cols.push("max_concurrent=?"); args.push(meta.max_concurrent); }
  if (meta?.version) { cols.push("version=?"); args.push(meta.version); }
  args.push(name);
  db.prepare(`UPDATE workers SET ${cols.join(", ")} WHERE name=?`).run(...args);
  return true;
}

// 워커 목록
export function listWorkers(): Worker[] {
  return db.prepare(`SELECT * FROM workers ORDER BY name`).all() as Worker[];
}

// 단건 조회
export function getWorker(name: string): Worker | null {
  return (db.prepare(`SELECT * FROM workers WHERE name=?`).get(name) as Worker) || null;
}

// 1분 이상 응답 없는 워커 → offline 마킹
// + 그 워커가 잡고 있던 running job 도 failed 로 회수 (좀비 작업 방지)
export function markStaleWorkersOffline(): void {
  const tx = db.transaction(() => {
    const stale = db
      .prepare(`
        SELECT name FROM workers
        WHERE status != 'offline'
          AND (last_heartbeat IS NULL OR datetime(last_heartbeat) < datetime('now', '-1 minute'))
      `)
      .all() as { name: string }[];

    if (stale.length === 0) return;

    const placeholders = stale.map(() => "?").join(",");
    const names = stale.map((s) => s.name);

    // 좀비 회수 — 해당 워커가 running 상태로 들고 있던 잡 → failed
    db.prepare(`
      UPDATE jobs
      SET status='failed',
          error_message=COALESCE(NULLIF(error_message, ''), '') || ' [worker_offline_recovery]',
          finished_at=datetime('now'),
          updated_at=datetime('now')
      WHERE status='running' AND worker_name IN (${placeholders})
    `).run(...names);

    db.prepare(`
      UPDATE workers SET status='offline' WHERE name IN (${placeholders})
    `).run(...names);
  });
  tx();
}

// UI 라벨 — 'online' | 'busy' | 'offline' → 한국어
// SQLite datetime('now') 은 'YYYY-MM-DD HH:MM:SS' 포맷이라 그냥 + 'Z' 하면
// 비표준 → Date.parse NaN. ISO-8601 로 정규화 후 Date 생성.
export function workerStatusLabel(worker: Worker): string {
  if (worker.last_heartbeat) {
    const iso = worker.last_heartbeat.replace(" ", "T") + "Z";
    const last = new Date(iso).getTime();
    if (Number.isNaN(last) || Date.now() - last > 60 * 1000) return "꺼짐";
  } else {
    return "꺼짐";
  }
  if (worker.status === "busy") return "실행 중";
  if (worker.status === "online") return "대기 중";
  return "꺼짐";
}

// 워커 삭제 (관리용)
export function deleteWorker(name: string): boolean {
  const r = db.prepare(`DELETE FROM workers WHERE name=?`).run(name);
  return r.changes > 0;
}
