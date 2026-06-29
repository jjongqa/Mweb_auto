// 결과별 재실행 — FAIL 또는 BLOCKED 케이스만 추출하여 새 Job 생성
// (v0.4b 백포팅 버전 — parent_job_id 없음, 격려 메시지는 task_name 마커로 전달)

import fs from "node:fs";
import path from "node:path";
import { getJob, createJob, type TcFilter } from "./jobs";
import type { Job } from "./db";
import { splitCsvLines, parseCsvRow } from "./csv-parser";

// F3 재실행 시 부모 설정 일부 오버라이드. undefined = 부모값 상속, 값(혹은 null) = 교체.
export interface RetryOverrides {
  claude_model?: string | null;
  worker_name?: string | null;
  tc_filter?: TcFilter | null;
}

export type RetryResultType = "FAIL" | "BLOCKED";

export interface RetryResult {
  newJob: Job;
  retryCount: number;
  resultType: RetryResultType;
}

/**
 * 격려 메시지 마커 — 워커가 task_name 끝에 이 마커 있으면 자동으로
 * Claude 프롬프트에 "미리 한계 선언 금지" 격려 블록을 추가.
 */
export const ENCOURAGEMENT_MARKER = "__RETRY_ENCOURAGE__";

/**
 * 완료된 Job 의 summary.csv 에서 특정 Result 행만 추출하여 새 TC CSV 생성 + 새 Job 등록.
 */
export function retryByResult(input: {
  sourceJobId: string;
  uploadsDir: string;
  resultType: RetryResultType;
  requestedBy?: string | null;
  withEncouragement?: boolean;
  additionalInstructions?: string | null;
  overrides?: RetryOverrides;
}): RetryResult {
  const { sourceJobId, uploadsDir, resultType, requestedBy = null, withEncouragement, additionalInstructions = null, overrides } = input;
  // BLOCKED 는 기본적으로 격려 메시지 포함
  const useEncouragement = withEncouragement ?? (resultType === "BLOCKED");

  const source = getJob(sourceJobId);
  if (!source) throw new Error(`원본 Job 없음: ${sourceJobId}`);
  if (!source.result_dir) throw new Error("원본 Job 결과 디렉토리 없음");

  const summaryPath = path.join(source.result_dir, "summary.csv");
  if (!fs.existsSync(summaryPath)) {
    throw new Error("원본 Job 의 summary.csv 가 없습니다. 실행이 완료되었나요?");
  }

  // summary.csv 파싱
  const text = fs.readFileSync(summaryPath, "utf-8").replace(/^\uFEFF/, "");
  const lines = splitCsvLines(text);
  if (lines.length < 2) throw new Error("summary.csv 가 비어있습니다");

  const headers = parseCsvRow(lines[0]);
  const resultIdx = headers.findIndex((h) => h.trim().toLowerCase() === "result");
  if (resultIdx < 0) throw new Error("summary.csv 에 Result 컬럼 없음");
  const noIdx = headers.findIndex((h) => h.trim().toLowerCase() === "no");
  if (noIdx < 0) throw new Error("summary.csv 에 No 컬럼 없음");

  // 원본 TC CSV 파싱
  const origText = fs.readFileSync(source.tc_path, "utf-8").replace(/^\uFEFF/, "");
  const origLines = splitCsvLines(origText);
  if (origLines.length < 2) throw new Error("원본 TC CSV 비어있음");
  const origHeader = origLines[0];
  const origDataRows = origLines.slice(1);

  const origHeaderCells = parseCsvRow(origHeader);
  const origNoIdx = origHeaderCells.findIndex((h) => h.trim().toLowerCase() === "no");
  if (origNoIdx < 0) throw new Error("원본 TC CSV 에 No 컬럼 없음 (재실행 매칭 불가)");

  // resultType 에 해당하는 No 들 수집
  const targetNos = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    const r = (cells[resultIdx] ?? "").trim().toUpperCase();
    if (r === resultType) {
      targetNos.add((cells[noIdx] ?? "").trim());
    }
  }

  if (targetNos.size === 0) {
    throw new Error(`재실행할 ${resultType} 케이스가 없습니다`);
  }

  // 원본 CSV 에서 매칭 행만 추출
  const targetRows: string[] = [origHeader];
  for (const row of origDataRows) {
    const cells = parseCsvRow(row);
    if (targetNos.has((cells[origNoIdx] ?? "").trim())) {
      targetRows.push(row);
    }
  }
  if (targetRows.length < 2) {
    throw new Error("원본 CSV 에서 매칭 행을 찾지 못함 (No 컬럼 매칭 실패)");
  }

  // 새 CSV 저장
  fs.mkdirSync(uploadsDir, { recursive: true });
  const stamp = Date.now();
  // 원본 파일명을 최대한 유지. .csv 확장자 분리.
  const origName = source.tc_filename;
  const dotIdx = origName.toLowerCase().lastIndexOf(".csv");
  const baseName = dotIdx > 0 ? origName.slice(0, dotIdx) : origName;
  // 파일 시스템 안전성을 위해 슬래시/콜론/널 문자만 _ 로 (한글, 공백, 대괄호는 macOS/Linux 에서 OK)
  const safeBase = baseName.replace(/[\/\\:\0]/g, "_");
  const suffix = resultType === "FAIL" ? "fails" : "blocked";
  const newFilename = `${safeBase}_retry_${targetNos.size}${suffix}.csv`;
  const newPath = path.join(uploadsDir, `${stamp}_${newFilename}`);
  fs.writeFileSync(newPath, "\uFEFF" + targetRows.join("\n"), "utf-8");

  // 새 Job 생성 — v0.4b 의 createJob 시그니처 사용
  const taskNameBase = source.task_name ? source.task_name : "재실행";
  const labelSuffix = resultType === "FAIL" ? "FAIL 재실행" : "BLOCKED 재실행";
  const taskName = useEncouragement
    ? `${taskNameBase} (${labelSuffix})${ENCOURAGEMENT_MARKER}`
    : `${taskNameBase} (${labelSuffix})`;

  const newJob = createJob({
    domain: source.domain,
    platform: source.platform,
    qa_env: source.qa_env,
    task_name: taskName,
    epic_key: source.epic_key,
    tc_filename: newFilename,
    tc_path: newPath,
    requested_by: requestedBy || source.requested_by,
    mode: source.mode,
    additional_instructions: additionalInstructions,
    parent_job_id: source.id,
    retry_type: resultType,
    // F3: 오버라이드 있으면 교체, 없으면 부모 상속.
    // 워커 상속 — 외부 워커로 만든 잡의 재실행은 기본적으로 같은 외부 워커가 처리.
    worker_name: overrides?.worker_name !== undefined ? overrides.worker_name : source.worker_name,
    claude_model: overrides?.claude_model !== undefined ? overrides.claude_model : source.claude_model,
    // 우선순위 필터 등 — 추출된 재실행 집합 안에서 워커가 추가 필터링 (예: P1 실패만)
    tc_filter: overrides?.tc_filter ?? null,
  });

  return { newJob, retryCount: targetNos.size, resultType };
}

// splitCsvLines, parseCsvRow 는 lib/csv-parser.ts 로 통합 (위에서 import).
