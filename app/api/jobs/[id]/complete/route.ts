import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { splitCsvLines, parseCsvRow } from "@/lib/csv-parser";
import { closeDataRequestsForJob } from "@/lib/data-requests";

export const dynamic = "force-dynamic";

// F5: summary.csv 의 TC 단위 (No, Result) 추출 — tc_execution_runs 적재용
function extractTcRuns(resultDir: string): { tc_no: string; result: string }[] {
  const summaryPath = path.join(resultDir, "summary.csv");
  if (!fs.existsSync(summaryPath)) return [];
  try {
    const text = fs.readFileSync(summaryPath, "utf-8").replace(/^﻿/, "");
    const lines = splitCsvLines(text);
    if (lines.length < 2) return [];
    const header = parseCsvRow(lines[0]);
    const ri = header.findIndex((h) => h.trim().toLowerCase() === "result");
    const ni = header.findIndex((h) => h.trim().toLowerCase() === "no");
    if (ri < 0 || ni < 0) return [];
    const out: { tc_no: string; result: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvRow(lines[i]);
      const r = (cells[ri] || "").trim().toUpperCase();
      const no = (cells[ni] || "").trim();
      if (no && (r === "PASS" || r === "FAIL" || r === "BLOCKED")) {
        out.push({ tc_no: no, result: r });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// summary.csv 직접 집계 — 워커 측 파싱 버그 안전망 (v1.7.2)
function recountFromSummary(resultDir: string): { passed: number; failed: number; blocked: number; total: number } | null {
  const summaryPath = path.join(resultDir, "summary.csv");
  if (!fs.existsSync(summaryPath)) return null;
  try {
    const text = fs.readFileSync(summaryPath, "utf-8").replace(/^﻿/, "");
    const lines = splitCsvLines(text);
    if (lines.length < 2) return null;
    const header = lines[0].split(",");
    const ri = header.findIndex((h) => h.trim().toLowerCase() === "result");
    if (ri < 0) return null;
    let p = 0, f = 0, b = 0;
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvRow(lines[i]);
      const r = (cells[ri] || "").trim().toUpperCase();
      if (r === "PASS") p++;
      else if (r === "FAIL") f++;
      else if (r === "BLOCKED") b++;
    }
    return { passed: p, failed: f, blocked: b, total: lines.length - 1 };
  } catch {
    return null;
  }
}

/**
 * POST /api/jobs/:id/complete
 *
 * 워커가 작업 완료 시 호출. 결과 파일 (multipart/form-data 로 여러 개) 업로드.
 *
 * Body (multipart/form-data):
 *   worker: string                          (필수)
 *   status: "succeeded" | "failed" | "canceled"  (필수)
 *   error_message?: string
 *   passed?: number, failed?: number, blocked?: number, total?: number
 *   files: File[]                            (결과 CSV, 로그, 스크린샷 등)
 *   file_paths: string                       (JSON 배열: 각 file 의 상대경로, e.g. ["summary.csv", "TC-1/screenshot.png"])
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fd = await req.formData();
  const worker = String(fd.get("worker") ?? "").trim();
  const status = String(fd.get("status") ?? "").trim();
  const errorMessage = String(fd.get("error_message") ?? "").trim() || null;
  const passed = Number(fd.get("passed") ?? 0);
  const failed = Number(fd.get("failed") ?? 0);
  const blocked = Number(fd.get("blocked") ?? 0);
  const total = Number(fd.get("total") ?? 0);
  const filePathsJson = String(fd.get("file_paths") ?? "[]");

  if (!worker) return Response.json({ error: "worker 필수" }, { status: 400 });
  if (!["succeeded", "failed", "canceled"].includes(status)) {
    return Response.json({ error: "잘못된 status" }, { status: 400 });
  }

  // 워커 권한 확인
  const job = db.prepare(`SELECT worker_name FROM jobs WHERE id=?`).get(id) as
    | { worker_name: string | null }
    | undefined;
  if (!job) return Response.json({ error: "Job 없음" }, { status: 404 });
  if (job.worker_name !== worker) {
    return Response.json({ error: "권한 없음" }, { status: 403 });
  }

  // 결과 파일들 저장
  // 중앙 결과 폴더: results/{job_id}/
  const resultDir = path.join(process.cwd(), "results", id);
  fs.mkdirSync(resultDir, { recursive: true });

  let filePaths: string[] = [];
  try { filePaths = JSON.parse(filePathsJson); } catch {}

  const files = fd.getAll("files");
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!(f instanceof File)) continue;
    const relPath = filePaths[i] || f.name;
    // 경로 안전성: .. / 절대경로 금지
    const safeRel = relPath.replace(/\.\./g, "_").replace(/^\/+/, "");
    const fullPath = path.join(resultDir, safeRel);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(await f.arrayBuffer()));
  }

  // v1.7.2 안전망: summary.csv 직접 재집계 — 워커 측 파싱 버그 영향 차단
  // 워커가 보낸 카운트와 어드민 재집계 결과가 다르면 어드민 쪽 우선
  let finalPassed = passed, finalFailed = failed, finalBlocked = blocked, finalTotal = total;
  const recount = recountFromSummary(resultDir);
  if (recount && (recount.passed !== passed || recount.failed !== failed || recount.blocked !== blocked)) {
    console.log(
      `[complete] ${id} stats 보정: worker=(P${passed}/F${failed}/B${blocked}) → recount=(P${recount.passed}/F${recount.failed}/B${recount.blocked})`
    );
    finalPassed = recount.passed;
    finalFailed = recount.failed;
    finalBlocked = recount.blocked;
    if (recount.total > finalTotal) finalTotal = recount.total;
  }

  // Job 상태 업데이트
  // F1: duration_sec = (now - started_at) 초. started_at 없으면 NULL 유지.
  db.prepare(`
    UPDATE jobs
    SET status=?,
        result_dir=?,
        passed=?, failed=?, blocked=?, total=?,
        error_message=?,
        finished_at=datetime('now'),
        duration_sec=CASE WHEN started_at IS NOT NULL
          THEN CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
          ELSE duration_sec END,
        updated_at=datetime('now')
    WHERE id=?
  `).run(status, resultDir, finalPassed, finalFailed, finalBlocked, finalTotal, errorMessage, id);

  closeDataRequestsForJob(id, `원 수행 잡이 ${status} 상태로 종료되어 데이터 요청을 닫았습니다.`);

  // F5: TC 단위 실행 결과 적재 (flaky 탐지/비교용). 재업로드 시 중복 방지 위해 먼저 삭제.
  try {
    const tcRuns = extractTcRuns(resultDir);
    if (tcRuns.length > 0) {
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM tc_execution_runs WHERE job_id=?`).run(id);
        const ins = db.prepare(`INSERT INTO tc_execution_runs (job_id, tc_no, result) VALUES (?, ?, ?)`);
        for (const t of tcRuns) ins.run(id, t.tc_no, t.result);
      });
      tx();
    }
  } catch (e) {
    console.warn(`[complete] tc_execution_runs 적재 실패 ${id}:`, (e as Error).message);
  }

  // v1.0 Phase 3b: 워커의 총 Job 수 증가 (성공/실패/캔슬 모두 카운트)
  db.prepare(`UPDATE workers SET total_jobs = total_jobs + 1 WHERE name = ?`).run(worker);

  return Response.json({ ok: true, file_count: files.length });
}
