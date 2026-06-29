// 운영 유지보수 작업 — DB/디스크 자원 정리.
// results/ 디렉터리 누적 방지가 주 목적. 부팅 후 한 번 자동 실행.

import fs from "node:fs";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const RESULTS_ROOT = path.join(process.cwd(), "results");

export interface CleanupReport {
  scanned: number;
  removed: number;
  freedBytes: number;
  errors: string[];
}

export function cleanupOldResultDirs(daysOld = DEFAULT_RETENTION_DAYS): CleanupReport {
  const report: CleanupReport = { scanned: 0, removed: 0, freedBytes: 0, errors: [] };
  if (!fs.existsSync(RESULTS_ROOT)) return report;
  const cutoffMs = Date.now() - daysOld * DAY_MS;
  for (const entry of fs.readdirSync(RESULTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    report.scanned++;
    const dirPath = path.join(RESULTS_ROOT, entry.name);
    try {
      const stat = fs.statSync(dirPath);
      if (stat.mtimeMs >= cutoffMs) continue;
      const size = dirSize(dirPath);
      fs.rmSync(dirPath, { recursive: true, force: true });
      report.removed++;
      report.freedBytes += size;
    } catch (err) {
      report.errors.push(`${entry.name}: ${(err as Error).message}`);
    }
  }
  return report;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) total += dirSize(p);
        else total += fs.statSync(p).size;
      } catch {}
    }
  } catch {}
  return total;
}

// 부팅 후 1회 + 이후 6시간마다 자동 실행. 중복 호출 방지.
let scheduled = false;
export function scheduleMaintenance(): void {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    try {
      const r = cleanupOldResultDirs(DEFAULT_RETENTION_DAYS);
      if (r.removed > 0) {
        console.log(
          `[maintenance] results cleanup: removed=${r.removed}/${r.scanned}, freed=${(r.freedBytes / 1024 / 1024).toFixed(1)}MB`
        );
      }
      if (r.errors.length > 0) {
        console.warn(`[maintenance] cleanup errors:`, r.errors.slice(0, 3));
      }
    } catch (err) {
      console.warn("[maintenance] cleanup 실패:", (err as Error).message);
    }
  };
  // 부팅 직후 5초 후 1회 (서버 응답성 영향 X)
  setTimeout(run, 5000);
  // 6시간마다 반복
  setInterval(run, 6 * 60 * 60 * 1000);
}
