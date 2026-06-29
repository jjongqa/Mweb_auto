// F6 다중 잡 결과 비교. 각 잡의 summary.csv 를 읽어 TC No 기준으로 피벗.
// tc_execution_runs 가 있으면 그걸 우선 쓰고, 없으면(예: 과거 잡) summary.csv fallback.

import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { getJob } from "./jobs";
import { splitCsvLines, parseCsvRow } from "./csv-parser";

export interface CompareJobMeta {
  id: string;
  label: string;
  domain: string;
  passed: number;
  failed: number;
  blocked: number;
  total: number;
  created_at: string;
}

export interface CompareRow {
  tc_no: string;
  title: string | null;
  results: Record<string, string>; // jobId -> PASS|FAIL|BLOCKED|"-"
}

export interface CompareResult {
  jobs: CompareJobMeta[];
  rows: CompareRow[];
}

// summary.csv 에서 No -> {result, title} 추출
function readSummary(resultDir: string): Map<string, { result: string; title: string | null }> {
  const map = new Map<string, { result: string; title: string | null }>();
  const summaryPath = path.join(resultDir, "summary.csv");
  if (!fs.existsSync(summaryPath)) return map;
  try {
    const text = fs.readFileSync(summaryPath, "utf-8").replace(/^﻿/, "");
    const lines = splitCsvLines(text);
    if (lines.length < 2) return map;
    const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
    const ni = header.findIndex((h) => h === "no");
    const ri = header.findIndex((h) => h === "result");
    const ti = header.findIndex((h) => h === "tc title" || h === "title");
    if (ni < 0 || ri < 0) return map;
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvRow(lines[i]);
      const no = (cells[ni] || "").trim();
      if (!no) continue;
      map.set(no, {
        result: (cells[ri] || "").trim().toUpperCase(),
        title: ti >= 0 ? (cells[ti] || "").trim() || null : null,
      });
    }
  } catch {
    /* ignore */
  }
  return map;
}

// tc_execution_runs 에서 No -> result (title 없음)
function readFromDb(jobId: string): Map<string, { result: string; title: string | null }> {
  const map = new Map<string, { result: string; title: string | null }>();
  const rows = db
    .prepare(`SELECT tc_no, result FROM tc_execution_runs WHERE job_id=?`)
    .all(jobId) as { tc_no: string; result: string }[];
  for (const r of rows) map.set(r.tc_no, { result: r.result, title: null });
  return map;
}

export function compareJobs(jobIds: string[]): CompareResult {
  const jobs: CompareJobMeta[] = [];
  const perJob: { id: string; map: Map<string, { result: string; title: string | null }> }[] = [];

  for (const id of jobIds) {
    const job = getJob(id);
    if (!job) continue;
    let map = readFromDb(id);
    if (map.size === 0 && job.result_dir) map = readSummary(job.result_dir);
    jobs.push({
      id: job.id,
      label: job.task_name || job.tc_filename,
      domain: job.domain,
      passed: job.passed,
      failed: job.failed,
      blocked: job.blocked,
      total: job.total,
      created_at: job.created_at,
    });
    perJob.push({ id, map });
  }

  // 모든 TC No 합집합
  const titleByNo = new Map<string, string | null>();
  const allNos = new Set<string>();
  for (const { map } of perJob) {
    for (const [no, v] of map) {
      allNos.add(no);
      if (v.title && !titleByNo.get(no)) titleByNo.set(no, v.title);
    }
  }

  const rows: CompareRow[] = [];
  for (const no of allNos) {
    const results: Record<string, string> = {};
    for (const { id, map } of perJob) {
      results[id] = map.get(no)?.result ?? "-";
    }
    rows.push({ tc_no: no, title: titleByNo.get(no) ?? null, results });
  }

  rows.sort((a, b) => a.tc_no.localeCompare(b.tc_no, undefined, { numeric: true }));
  return { jobs, rows };
}
