// QA 설계 / TC 생성 — 기획서 + (도메인 tc-skill + 마스터정책) 주입 → Claude(-p) → 산출물.
//  kind='design': QA 관점 분석(마크다운) 생성  → 사람이 refine 으로 다듬은 뒤 TC생성으로 전달
//  kind='tc'    : (설계 분석 반영) TC CSV 생성
// 브라우저 구동이 없는 단발 생성이라 워커 대신 admin 에서 claude CLI 직접 실행(백그라운드).

import { db } from "./db";
import { getDomainById } from "./domains";
import { sanitizePocs, normalizePoc } from "./pocs";
import { getQaCoworkHome } from "./prompt-manager";
import { getBuiltinWorkerName } from "./workers";
import { splitCsvLines, parseCsvRow } from "./csv-parser";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// 기본 모델 — 깊은 분해가 중요해 Opus 4.8 (실행 워커의 CLAUDE_MODEL 과 독립).
const DEFAULT_MODEL = process.env.TC_GEN_MODEL || "claude-opus-4-8";
const OUTPUT_ROOT = path.join(process.cwd(), "tc-gen-output");

export function resolveTcOutputPath(outputPath: string | null | undefined): string | null {
  if (!outputPath) return null;
  if (fs.existsSync(outputPath)) return outputPath;
  const normalized = outputPath.replace(/\\/g, "/");
  const marker = "/tc-gen-output/";
  const idx = normalized.indexOf(marker);
  if (idx < 0) return outputPath;
  const rel = normalized.slice(idx + marker.length).split("/");
  const fallback = path.join(OUTPUT_ROOT, ...rel);
  return fs.existsSync(fallback) ? fallback : outputPath;
}

// 워커가 claude -p 실행 시 쓰는 인자/타임아웃 (빌트인·외부 워커 공용 참고값)
export const TC_GEN_CLAUDE_ARGS = ["-p", "--dangerously-skip-permissions", "--strict-mcp-config"];
export const TC_GEN_TIMEOUT_MS = 10 * 60 * 1000;
// 자동개선(auto-refine) 발동/노출 기준 점수 — 이 점수 미만이면 자동개선 대상. (등급: A≥90 / B≥75 / C≥60 / D<60)
// 90 = A 등급만 통과, B 이하는 개선. 한 곳에서 관리(노출 조건·API 기본값·체이닝 모두 공유).
export const AUTO_REFINE_THRESHOLD = 90;

// 표준 CSV 헤더 (csv-schema.md 기준 — 도메인 무관 고정)
// `시트분류`(2번째, No 다음) = POC(실행 시스템/화면). 앞쪽에 둬야 뒤 컬럼이 한 칸 밀려도
// POC 판정이 흔들리지 않는다(긴 다중행 셀 뒤 마지막 컬럼은 모델이 자주 어긋냄). 소비부는 전부 컬럼명으로 읽음.
export const TC_CSV_HEADER =
  "No,시트분류,Type,Tags,Priority,Abnormal,Automation Type,Title,1depth,2depth,3depth,상품유형,승인상태,회원,상품,프로모션,주문,클레임,Pre-condition,Test Steps,Expected Result";

// 작성멀티(legacy) 역할 분화 프리셋 — 에이전트별 커스텀 instruction 이 없을 때 상호배타 역할을 배정해
// "전원이 같은 기획서 전체를 작성"으로 인한 합본 중복(실측 76%)을 근원 차단한다. 3개 역할이 합쳐 기획서 전 영역을 덮도록 설계.
export const WRITE_ROLE_PRESETS: { key: string; title: string; scope: string }[] = [
  { key: "normal", title: "정상 흐름·노출·문구", scope: "정상 동작, 노출/미노출 조건, 문구 정확성, 기본 UI 동작·이동" },
  { key: "edge", title: "경계·예외·엣지", scope: "경계값, 예외/네거티브, 우선순위·조합, 상태전환, 환경별 분기(PC웹 등), 저장소·세션 등 놓치기 쉬운 케이스" },
  { key: "regression", title: "리그레션·회귀", scope: "기존 기능 회귀, 인접/기존 영역과의 충돌·레이아웃, 배포 후 기존 동작 정상성 (Type 컬럼을 '리그레션'으로)" },
];
// 작성멀티 분할 잡임을 프롬프트가 인식하는 마커 — focus 에 주입되며 assembleTcGenPrompt 가 감지해
// "기획서 전체 커버" 규칙을 "배정 영역만 커버(타 영역 작성 금지)"로 전환한다.
const PARTITION_MARKER = "[담당 영역]";
const COMMON_FOCUS_MARKER = "[공통 포커스]";

function requiresRegressionOnly(text: string | null | undefined): boolean {
  const t = (text || "").replace(/\s+/g, " ").toLowerCase();
  if (/리그레션.{0,12}(작성하지 않|제외|금지|아님|않음)|회귀.{0,12}(작성하지 않|제외|금지|아님|않음)|not regression|exclude regression|no regression/i.test(t)) {
    return false;
  }
  return /리그레션|회귀|regression/.test(t) && /(type|type 컬럼|타입|모든 tc|모든 행|전부|only|만)/i.test(t);
}

function sanitizeCommonFocusForPartition(focus: string): string {
  return focus
    .replaceAll(PARTITION_MARKER, "[설계 참고 영역]")
    .replaceAll("▶ 담당 영역", "▶ 설계 참고 범위")
    .replaceAll("▶ 다른 에이전트 담당(작성 금지 — 중복 방지)", "▶ 설계 당시 다른 담당")
    .replaceAll("작성 금지 — 중복 방지", "참고")
    .trim();
}

// 잡 레코드의 pocs(JSON string) → string[] (표준화).
export function parseJobPocs(pocs: string | null): string[] {
  if (!pocs) return [];
  try { return sanitizePocs(JSON.parse(pocs)); } catch { return []; }
}

export const UNCLASSIFIED_POC = "(미분류)";

// CSV 를 특정 POC(시트분류) 행만 남겨 반환. 결과페이지 미리보기 그룹과 동일 매칭 규칙.
// 원본 줄 문자열을 그대로 보존(따옴표/셀 포맷 유지). header + 매칭 행.
export function filterCsvByPoc(csv: string, poc: string): { csv: string; count: number } {
  const lines = splitCsvLines(csv.replace(/^﻿/, ""));
  if (lines.length < 2) return { csv, count: 0 };
  const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
  let iPoc = -1;
  for (const n of ["시트분류", "poc", "sheet"]) { const i = header.indexOf(n); if (i >= 0) { iPoc = i; break; } }
  const iNo = header.indexOf("no");   // No 컬럼(보통 0번). 추려낸 POC 안에서 1부터 다시 매김.
  const kept: string[] = [lines[0]];
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvRow(lines[i]);
    if (!c.some((x) => x.trim())) continue;
    const cellPoc = iPoc >= 0 ? (normalizePoc((c[iPoc] ?? "").trim()) ?? UNCLASSIFIED_POC) : UNCLASSIFIED_POC;
    if (cellPoc === poc) {
      count++;
      // No 가 첫 컬럼이면(항상 숫자·따옴표 없음) 줄 맨 앞 셀만 1부터 재넘버링, 나머지 원본 그대로 보존.
      const line = iNo === 0 ? lines[i].replace(/^[^,]*/, String(count)) : lines[i];
      kept.push(line);
    }
  }
  return { csv: kept.join("\n"), count };
}

export type TcGenStatus = "pending" | "running" | "succeeded" | "failed";
export type TcGenKind = "design" | "tc";

export interface TcGenJob {
  id: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: TcGenStatus;
  domain: string;
  task_name: string | null;
  requested_by: string | null;
  spec_url: string | null;
  spec_filename: string | null;
  spec_text: string | null;
  focus: string | null;
  claude_model: string | null;
  output_path: string | null;
  output_filename: string | null;
  tc_count: number;
  duration_sec: number | null;
  error_message: string | null;
  log: string | null;
  parent_id: string | null;
  refine_instructions: string | null;
  include_analysis: number;       // (deprecated)
  qa_analysis: string | null;     // design: 생성된 분석 / tc: 반영할 주입 분석
  kind: TcGenKind;
  source_design_id: string | null;
  pocs: string | null;            // JSON string[] — 대상 POC(시트분류)
  // 워커 분배 — 생성 시 프롬프트 조립 저장, 워커가 claim 해 로컬 claude 로 실행
  prompt: string | null;
  model: string | null;
  worker_name: string | null;       // 실제 claim 한 워커
  assigned_at: string | null;
  target_worker: string | null;     // 생성 시 지정한 실행 워커 (null=아무 워커나)
  // 설계/작성 지시기반 병렬 — 같은 group_id 의 N잡(에이전트별 focus). null=단독 생성
  agent_group_id: string | null;
  agent_nickname: string | null;
  harness_report: string | null;   // 하네스 게이트/평가 점수 JSON (하네스 모드 tc 잡만)
  engine: string | null;           // 'harness' | 'legacy' | null(=env TCGEN_HARNESS 따름) — per-job 생성 엔진
}

// ============== Store ==============

export function createTcGenJob(input: {
  domain: string;
  kind?: TcGenKind;
  task_name?: string | null;
  requested_by?: string | null;
  spec_url?: string | null;
  spec_filename?: string | null;
  spec_text?: string | null;
  focus?: string | null;
  claude_model?: string | null;
  parent_id?: string | null;
  refine_instructions?: string | null;
  qa_analysis?: string | null;
  source_design_id?: string | null;
  pocs?: string[] | null;
  target_worker?: string | null;
  agent_group_id?: string | null;
  agent_nickname?: string | null;
  sync_note?: string | null;     // 생성 직전 Drive 자동 동기화 결과 — 잡 로그에 기록(잡 상세에서 보임)
  engine?: string | null;        // 'harness' | 'legacy' | null(=env 따름) — 생성 엔진 per-job 선택
}): TcGenJob {
  const id = `tcgen_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const pocs = sanitizePocs(input.pocs ?? []);
  db.prepare(`
    INSERT INTO tc_gen_jobs (id, status, kind, domain, task_name, requested_by, spec_url, spec_filename, spec_text, focus, claude_model, parent_id, refine_instructions, qa_analysis, source_design_id, pocs, target_worker, agent_group_id, agent_nickname, engine)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.kind ?? "tc",
    input.domain,
    input.task_name ?? null,
    input.requested_by ?? null,
    input.spec_url ?? null,
    input.spec_filename ?? null,
    input.spec_text ?? null,
    input.focus ?? null,
    input.claude_model ?? null,
    input.parent_id ?? null,
    input.refine_instructions ?? null,
    input.qa_analysis ?? null,
    input.source_design_id ?? null,
    pocs.length ? JSON.stringify(pocs) : null,
    input.target_worker ?? null,
    input.agent_group_id ?? null,
    input.agent_nickname ?? null,
    input.engine ?? null
  );
  // 워커 분배 모델: 생성 시 프롬프트를 미리 조립해 저장 → pending 상태로 워커를 기다린다.
  //  (admin 에서 claude 를 직접 돌리지 않음. 워커가 claim 후 로컬 claude 로 실행.)
  try {
    const job = getTcGenJob(id)!;
    const { prompt, model, log } = assembleJobPrompt(job);
    const syncLine = input.sync_note ? `[Drive 자동 동기화] ${input.sync_note}\n` : "";
    patchJob(id, { prompt, model, log: (job.log ?? "") + syncLine + log });
  } catch (e) {
    patchJob(id, { status: "failed", error_message: `프롬프트 조립 실패: ${e instanceof Error ? e.message : String(e)}`, finished_at: nowStr() });
  }
  return getTcGenJob(id)!;
}

function nowStr(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// 개선 재생성 — 부모 잡 설정 상속 + 피드백으로 새 잡 생성 (design/tc 공통).
export function createRefineJob(parentId: string, instructions: string): TcGenJob {
  const parent = getTcGenJob(parentId);
  if (!parent) throw new Error(`원본 잡 없음: ${parentId}`);
  const baseName = (parent.task_name || `${parent.domain} ${parent.kind === "design" ? "QA설계" : "TC"}`).replace(/ \(개선 \d+\)$/, "");
  const gen = countRefineDepth(parentId) + 1;
  return createTcGenJob({
    domain: parent.domain,
    kind: parent.kind,
    task_name: `${baseName} (개선 ${gen})`,
    requested_by: parent.requested_by,
    spec_url: parent.spec_url,
    spec_filename: parent.spec_filename,
    spec_text: parent.spec_text,
    focus: parent.focus,
    claude_model: parent.claude_model,
    parent_id: parentId,
    refine_instructions: instructions,
    // tc 잡이면 주입 분석(설계 seed)·원본 설계 링크·대상 POC 유지
    qa_analysis: parent.kind === "tc" ? parent.qa_analysis : null,
    source_design_id: parent.kind === "tc" ? parent.source_design_id : null,
    pocs: parent.kind === "tc" ? parseJobPocs(parent.pocs) : null,
    target_worker: parent.target_worker || getBuiltinWorkerName(),   // 개선 재생성은 원본과 같은 워커로. 레거시 null은 내장 워커로 보정.
    agent_nickname: parent.agent_nickname,
    engine: parent.engine,
  });
}

function stripTrailingAgentTags(title: string | null | undefined): string {
  let t = (title || "").replace(/\s*\(개선\s*\d+\)\s*$/, "").trim();
  while (/\s*\[[^\]]+\]\s*$/.test(t)) t = t.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  return t;
}

// QA 설계 → TC 생성 핸드오프의 seed base (단일/그룹 공용). 검증 + 설계 분석 주입 input 구성.
function tcInputFromDesign(designId: string, pocs: string[], engine?: string | null): Parameters<typeof createTcGenJob>[0] {
  const d = getTcGenJob(designId);
  if (!d) throw new Error(`QA 설계 잡 없음: ${designId}`);
  if (d.kind !== "design") throw new Error("QA 설계 잡이 아닙니다");
  if (d.status !== "succeeded" || !d.qa_analysis) throw new Error("완료된 QA 설계만 TC생성으로 보낼 수 있어요");
  const cleanPocs = sanitizePocs(pocs);
  if (cleanPocs.length === 0) throw new Error("대상 POC(시트분류)를 1개 이상 선택해 주세요");
  const baseName = stripTrailingAgentTags(d.task_name) || d.domain;
  // 지시기반 병렬 설계(그룹)면 합본 분석을 seed 로 — 단일 잡 분석만 넘기면 나머지 에이전트(플래너·스캐너 등) 설계가 버려짐.
  // 부분 합본 방지: 한 에이전트라도 아직 진행 중이면 막는다(모두 끝난 뒤 합본으로 넘기게).
  let seedAnalysis = d.qa_analysis;
  if (d.agent_group_id) {
    const designSibs = getTcGenGroupSiblings(d.agent_group_id).filter((j) => j.kind === "design");
    const active = designSibs.filter((j) => j.status === "pending" || j.status === "running");
    if (active.length > 0) {
      throw new Error(`아직 ${active.length}개 에이전트 설계가 진행 중이에요. 모두 끝난 뒤 합본으로 보내주세요.`);
    }
    const merged = mergeTcGenGroupAnalysis(d.agent_group_id);
    if (merged) seedAnalysis = merged;
  }
  return {
    domain: d.domain,
    kind: "tc",
    task_name: baseName,
    requested_by: d.requested_by,
    spec_url: d.spec_url,
    spec_filename: d.spec_filename,
    spec_text: d.spec_text,
    focus: d.focus,
    claude_model: d.claude_model,
    qa_analysis: seedAnalysis,        // 그룹이면 합본(전체 에이전트) / 단일이면 그 잡 분석. 작성 멀티면 N잡 모두에 동일 주입
    source_design_id: designId,
    pocs: cleanPocs,
    target_worker: d.target_worker || getBuiltinWorkerName(),    // 설계 잡과 같은 워커로. 레거시 null 설계는 내장 워커로 보정.
    engine: engine ?? null,            // 핸드오프에서 선택한 생성 엔진(하네스/legacy) — null=env 따름
  };
}

// QA 설계 → TC 생성 핸드오프(단일): 설계의 분석을 seed 로 주입한 tc 잡 생성.
export function createTcFromDesign(designId: string, pocs: string[], engine?: string | null): TcGenJob {
  return createTcGenJob(tcInputFromDesign(designId, pocs, engine));
}

// QA 설계 → TC 생성 핸드오프(작성 멀티): 설계 분석을 N개 작성 에이전트 잡 모두에 seed 주입 + 각자 instruction=focus 추가 → 합본.
export function createTcGroupFromDesign(
  designId: string,
  pocs: string[],
  agents: { nickname: string; instruction: string }[],
  engine?: string | null
): { groupId: string; ids: string[] } {
  return createTcGenGroup(tcInputFromDesign(designId, pocs, engine), agents);
}

// ============== 설계/작성 지시기반 병렬 그룹 ==============

// 활성 에이전트마다 같은 기획서로 잡 1개씩(각자 instruction 을 focus 로 주입) 생성. 같은 agent_group_id 로 묶음.
export function createTcGenGroup(
  base: Parameters<typeof createTcGenJob>[0],
  agents: { nickname: string; instruction: string }[]
): { groupId: string; ids: string[] } {
  const groupId = `ag_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const baseFocus = (base.focus || "").trim();
  const baseName = base.task_name || base.domain;
  // 각 에이전트의 담당 영역 결정: 커스텀 instruction 우선(사람 조종 존중), 없으면 상호배타 역할 프리셋 배정.
  // → "전원 전체작성"을 없애 합본 중복(실측 76%)을 근원 차단. 역할 프리셋은 합쳐 기획서 전 영역을 덮음.
  const assigned = agents.map((ag, i) => {
    const instr = (ag.instruction || "").trim();
    if (instr) {
      return {
        nickname: ag.nickname,
        label: instr.split(/[\n.]/)[0].trim().slice(0, 40) || instr.slice(0, 40),
        area: instr,
        regression: requiresRegressionOnly(instr),
      };
    }
    const p = WRITE_ROLE_PRESETS[i % WRITE_ROLE_PRESETS.length];
    return { nickname: ag.nickname, label: p.title, area: `${p.title} — ${p.scope}`, regression: p.key === "regression" };
  });
  const ids: string[] = [];
  for (let i = 0; i < assigned.length; i++) {
    const a = assigned[i];
    const others = assigned.filter((_, j) => j !== i).map((o) => `${o.nickname}=${o.label}`).join(" / ");
    const partition =
      `${PARTITION_MARKER} ${a.nickname}\n` +
      `▶ 이 잡은 ${a.nickname} 전용 산출물이다. 아래 담당 영역 밖의 TC는 작성하지 않는다.\n` +
      `▶ 담당 영역(이 영역에 해당하는 기획서 내용만 작성): ${a.area}\n` +
      `▶ 다른 에이전트 담당(작성 금지 — 중복 방지): ${others || "(없음)"}` +
      (a.regression ? `\n▶ Type 강제: 이 잡의 모든 TC 는 Type 컬럼을 정확히 "리그레션"으로 작성한다. Functional 작성 금지.` : "");
    const commonFocus = baseFocus ? `${COMMON_FOCUS_MARKER}\n${sanitizeCommonFocusForPartition(baseFocus)}\n\n※ 공통 포커스는 참고하되, 위 [담당 영역]과 충돌하면 [담당 영역]을 우선한다.` : "";
    const focus = [partition, commonFocus].filter(Boolean).join("\n\n");
    const j = createTcGenJob({
      ...base,
      task_name: `${baseName} [${a.nickname}]`,
      focus,
      agent_group_id: groupId,
      agent_nickname: a.nickname,
    });
    ids.push(j.id);
  }
  return { groupId, ids };
}

export function getTcGenGroupSiblings(groupId: string): TcGenJob[] {
  if (!groupId) return [];
  return db.prepare(`SELECT * FROM tc_gen_jobs WHERE agent_group_id = ? ORDER BY created_at ASC, id ASC`).all(groupId) as TcGenJob[];
}

export function getTcGenEffectiveGroupId(jobOrId: TcGenJob | string | null): string | null {
  let cur = typeof jobOrId === "string" ? getTcGenJob(jobOrId) : jobOrId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.agent_group_id) return cur.agent_group_id;
    seen.add(cur.id);
    cur = cur.parent_id ? getTcGenJob(cur.parent_id) : null;
  }
  return null;
}

function getSucceededRefineDescendants(rootId: string): TcGenJob[] {
  const out: TcGenJob[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const parentId = stack.pop()!;
    if (seen.has(parentId)) continue;
    seen.add(parentId);
    const children = db.prepare(`SELECT * FROM tc_gen_jobs WHERE parent_id = ? ORDER BY created_at ASC, id ASC`).all(parentId) as TcGenJob[];
    for (const child of children) {
      stack.push(child.id);
      if (child.kind === "tc" && child.status === "succeeded" && child.output_path) out.push(child);
    }
  }
  return out;
}

export function getEffectiveTcGenGroupJobs(groupId: string): TcGenJob[] {
  const originals = getTcGenGroupSiblings(groupId).filter((j) => j.kind === "tc");
  return originals.map((j) => {
    const refinements = getSucceededRefineDescendants(j.id)
      .sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
    const candidates = [j, ...refinements].filter((job) => job.status === "succeeded" && job.output_path);
    if (!candidates.length) return refinements.at(-1) ?? j;
    return candidates
      .map((job, index) => ({ job, index, review: readTcQualityReview(job.output_path) }))
      .sort((a, b) => {
        const aScore = a.review?.score ?? -1;
        const bScore = b.review?.score ?? -1;
        if (aScore !== bScore) return bScore - aScore;
        if (a.job.created_at !== b.job.created_at) return b.job.created_at.localeCompare(a.job.created_at);
        return b.index - a.index;
      })[0].job;
  });
}

export interface TcGenGroupSummary {
  groupId: string;
  kind: TcGenKind;
  total: number;       // 잡 수
  done: number;        // 완료(succeeded+failed)
  succeeded: number;
  failed: number;
  running: boolean;
  status: "running" | "succeeded" | "failed";
  totalTc: number;     // 작성: 합산 tc_count
  jobs: TcGenJob[];
}
export function tcGenGroupSummary(groupId: string): TcGenGroupSummary | null {
  const jobs = getTcGenGroupSiblings(groupId);
  if (!jobs.length) return null;
  let succeeded = 0, failed = 0, done = 0, totalTc = 0, anyActive = false;
  for (const j of jobs) {
    if (j.status === "succeeded") { succeeded++; done++; totalTc += j.tc_count || 0; }
    else if (j.status === "failed") { failed++; done++; }
    else anyActive = true;
  }
  const status: TcGenGroupSummary["status"] = anyActive ? "running" : succeeded === 0 ? "failed" : "succeeded";
  return { groupId, kind: jobs[0].kind, total: jobs.length, done, succeeded, failed, running: anyActive, status, totalTc, jobs };
}

// 작성: 그룹 내 succeeded 잡들의 CSV 를 합본(union) — 헤더 1개 + 전체 데이터행, No 1..N 재넘버링. 시트분류 보존.
// 개선본이 있으면 해당 원본 에이전트 자리는 최고 품질 개선본으로 대체한다.
// 새 개선본이 오히려 점수를 떨어뜨려도 합본/다운로드 품질이 후퇴하지 않도록 한다.
export function mergeTcGenGroupCsv(groupId: string): { csv: string; count: number } | null {
  const jobs = getEffectiveTcGenGroupJobs(groupId).filter((j) => j.kind === "tc" && j.status === "succeeded" && j.output_path);
  if (!jobs.length) return null;
  let header: string | null = null;
  const data: string[] = [];
  for (const j of jobs) {
    const outputPath = resolveTcOutputPath(j.output_path);
    if (!outputPath || !fs.existsSync(outputPath)) continue;
    let text: string;
    try { text = fs.readFileSync(outputPath, "utf-8").replace(/^﻿/, ""); } catch { continue; }
    const lines = splitCsvLines(text);
    if (lines.length < 1) continue;
    if (!header) header = lines[0];
    for (let i = 1; i < lines.length; i++) if (lines[i].trim()) data.push(lines[i]);
  }
  if (!header) return null;
  const headerCells = parseCsvRow(header);
  const headerMap = new Map(headerCells.map((h, i) => [h.trim().toLowerCase(), i]));
  const titleIdx = headerMap.get("title") ?? -1;
  const pocIdx = headerMap.get("시트분류") ?? -1;
  const preIdx = headerMap.get("pre-condition") ?? headerMap.get("precondition") ?? headerMap.get("사전조건") ?? -1;
  const expectedIdx = headerMap.get("expected result") ?? -1;
  const seenTitles = new Set<string>();
  const seenIntents = new Set<string>();
  const deduped = data.filter((line) => {
    const cells = parseCsvRow(line);
    const poc = pocIdx >= 0 ? cells[pocIdx] ?? "" : "";
    const title = titleIdx >= 0 ? cells[titleIdx] ?? "" : "";
    const pre = preIdx >= 0 ? cells[preIdx] ?? "" : "";
    const expected = expectedIdx >= 0 ? cells[expectedIdx] ?? "" : "";
    const titleKey = normalizeTextForCompare(`${poc}|${title}`);
    const intentKey = normalizeTextForCompare(`${title}|${pre}|${expected}`);
    if (titleKey && seenTitles.has(titleKey)) return false;
    if (intentKey && seenIntents.has(intentKey)) return false;
    if (titleKey) seenTitles.add(titleKey);
    if (intentKey) seenIntents.add(intentKey);
    return true;
  });
  // 합본 TC는 에이전트별 작성 순서를 그대로 붙이면 실제 테스트 흐름이 뒤섞인다.
  // POC > 화면/여정 > 검증 유형 > 우선순위 기준으로 정렬한 뒤 No를 다시 매긴다.
  const sorted = sortTcRowsByExecutionFlow(deduped, headerCells);
  const iNo = findHeaderIndex(headerCells, ["no"]);
  const renum = sorted.map((line, idx) => {
    const cells = parseCsvRow(line);
    if (iNo >= 0) cells[iNo] = String(idx + 1);
    return cells.map(csvCell).join(",");
  });
  // 합본 표면 정규화 — 에이전트별로 컬럼 수가 어긋난 행(조건 컬럼 누락 등)을 우측 정렬 복구. 정상 행은 원본 보존.
  const norm = normalizeCsvColumns([header, ...renum].join("\n"));
  return { csv: norm.csv, count: sorted.length };
}

// 설계: 그룹 내 succeeded 잡들의 분석을 에이전트별 섹션으로 합본(마크다운).
export function mergeTcGenGroupAnalysis(groupId: string): string | null {
  const jobs = getTcGenGroupSiblings(groupId).filter((j) => j.kind === "design" && j.status === "succeeded" && j.qa_analysis);
  if (!jobs.length) return null;
  return jobs
    .map((j) => {
      const hint = j.focus ? `> 지시: ${j.focus.replace(/\s+/g, " ").trim().slice(0, 160)}\n\n` : "";
      return `# 🔬 ${j.agent_nickname || "에이전트"} — 설계 분석\n\n${hint}${j.qa_analysis}`;
    })
    .join("\n\n---\n\n");
}

function countRefineDepth(id: string): number {
  let depth = 0;
  let cur = getTcGenJob(id);
  const seen = new Set<string>();
  while (cur?.parent_id && !seen.has(cur.parent_id)) {
    seen.add(cur.parent_id);
    depth++;
    cur = getTcGenJob(cur.parent_id);
  }
  return depth;
}

export function getTcGenJob(id: string): TcGenJob | null {
  return (db.prepare(`SELECT * FROM tc_gen_jobs WHERE id = ?`).get(id) as TcGenJob) ?? null;
}

// 하네스 진행 단계 보고 — 워커가 워크스페이스 단계 감지해 호출. running 잡에만 진행 로그로 기록.
export function appendTcGenProgress(id: string, phase: string): void {
  const job = getTcGenJob(id);
  if (!job || job.status !== "running") return;
  appendLog(id, `⚙️ ${phase}`);
}

export function listTcGenJobs(limit = 50, kind?: TcGenKind): TcGenJob[] {
  if (kind) {
    return db.prepare(`SELECT * FROM tc_gen_jobs WHERE kind = ? ORDER BY created_at DESC LIMIT ?`).all(kind, limit) as TcGenJob[];
  }
  return db.prepare(`SELECT * FROM tc_gen_jobs ORDER BY created_at DESC LIMIT ?`).all(limit) as TcGenJob[];
}

function patchJob(id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE tc_gen_jobs SET ${set} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
}

function appendLog(id: string, line: string) {
  const cur = (db.prepare(`SELECT log FROM tc_gen_jobs WHERE id=?`).get(id) as { log: string | null } | undefined)?.log ?? "";
  patchJob(id, { log: `${cur}${line}\n` });
}

// ============== 프롬프트 조립 ==============

function readFolderTexts(dir: string): { name: string; content: string }[] {
  const out: { name: string; content: string }[] = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string, base: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, rel);
      else if (/\.(md|txt)$/i.test(e.name)) {   // .skill(zip) 제외 — 동기화가 풀어서 .md 로 저장하므로 raw zip 주입 방지
        try { out.push({ name: rel, content: fs.readFileSync(full, "utf-8") }); } catch { /* skip */ }
      }
    }
  };
  walk(dir, "");
  return out;
}

// 물류 전용: baseDir(_logistics) 의 하위 폴더 중 이름에 키워드가 포함된 폴더의 텍스트를 모아 읽음(폴더명 prefix로 출처 구분).
// 스킬↔정책 폴더 이름이 안 맞는 물류 구조 대응 (예: 주문→주문/주문이행, 딜리버리→딜리버리/배송).
function readByKeywords(baseDir: string, keywords: string[]): { name: string; content: string }[] {
  const out: { name: string; content: string }[] = [];
  if (!fs.existsSync(baseDir)) return out;
  for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (!keywords.some((k) => e.name.includes(k))) continue;
    for (const f of readFolderTexts(path.join(baseDir, e.name))) out.push({ name: `${e.name}/${f.name}`, content: f.content });
  }
  return out;
}

// 물류 정책 전용: 폴더명이 names 와 "정확히" 일치하는 폴더만 읽음(정책은 도메인 1:1).
// 정확매칭이라 '배송'이 '배송대행' 폴더를 잘못 포함하지 않음. (스킬은 번들이라 readByKeywords 부분일치 사용)
function readByExact(baseDir: string, names: string[]): { name: string; content: string }[] {
  const out: { name: string; content: string }[] = [];
  if (!fs.existsSync(baseDir)) return out;
  for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (!names.includes(e.name)) continue;
    for (const f of readFolderTexts(path.join(baseDir, e.name))) out.push({ name: `${e.name}/${f.name}`, content: f.content });
  }
  return out;
}

export interface PromptParts {
  prompt: string;
  skillFiles: string[];
  policyFiles: string[];
  tcFolder: string;
}

// 도메인 스킬/정책 로드 + 공통 컨텍스트 블록 (스킬/정책/기획서/포커스)
function loadContext(domain: string, specText: string, focus: string | null) {
  const cfg = getDomainById(domain);
  const tcFolder = cfg?.tcFolder ?? domain;
  const home = getQaCoworkHome();
  // gap/feedback 스킬은 생성/설계와 무관(비교·갭분석용) → 제외.
  const noGapFeedback = (f: { name: string }) =>
    !/(^|\/)(kurly-)?tc-(feedback|gap)\.skill$/i.test(f.name) && !/(^|\/)kurly-tc-(feedback|gap)\b/i.test(f.name);
  // 물류: 폴더명 정확매칭이 안 돼 _logistics 밑에서 키워드 포함 폴더(스킬/정책)를 모아 읽음. 커머스: tcFolder 정확매칭(기존).
  const isLogistics = cfg?.bu === "물류" && !!cfg.match?.length;
  const bu = cfg?.bu ?? "커머스";

  // ① BU 필수 기본 스킬 — 도메인 무관, 무조건 맨 처음에 숙지(디폴트).
  const masterRel = bu === "물류"
    ? path.join("_logistics", "_공통", "kurly-logistics-tc-v3_SKILL.md")
    : path.join("_공통", "커머스_TC_생성_스킬.md");
  const masterPath = path.join(home, "tc-skills", masterRel);
  const masterSkill = fs.existsSync(masterPath)
    ? [{ name: masterRel, content: fs.readFileSync(masterPath, "utf-8") }]
    : [];

  // ② 도메인별 TC 작성 스킬 (기본 스킬과 중복 시 제거)
  const domainSkills = (isLogistics
    ? readByKeywords(path.join(home, "tc-skills", "_logistics"), cfg!.match!)
    : readFolderTexts(path.join(home, "tc-skills", tcFolder))
  ).filter(noGapFeedback).filter((f) => f.name !== masterRel);

  const skills = [...masterSkill, ...domainSkills]; // 반환/로그용 — 기본 스킬이 항상 맨 앞
  const policies = isLogistics
    ? readByExact(path.join(home, "policies", "_logistics"), cfg!.policyFolders ?? [])
    : readFolderTexts(path.join(home, "policies", tcFolder));
  const renderFiles = (arr: { name: string; content: string }[]) =>
    arr.map((f) => `### [스킬 파일] ${f.name}\n\n${f.content}`).join("\n\n---\n\n");
  const masterBlock = masterSkill.length
    ? `## ⭐ 기본 TC 생성 스킬 (가장 먼저·반드시 숙지)\n\n${renderFiles(masterSkill)}`
    : "";
  const domainBlock = domainSkills.length ? `## 도메인 TC 작성 스킬\n\n${renderFiles(domainSkills)}` : "";
  const skillBlock = [masterBlock, domainBlock].filter(Boolean).join("\n\n---\n\n")
    || "(TC 작성 스킬 파일 없음 — 일반 QA 원칙으로 진행)";
  const policyBlock = policies.length
    ? policies.map((f) => `### [정책 파일] ${f.name}\n\n${f.content}`).join("\n\n---\n\n")
    : "(이 도메인 마스터 정책 파일 없음 — 기획서 본문에 의존)";
  const isPartitionedFocus = !!focus && focus.includes(PARTITION_MARKER);
  const focusBlock = focus && focus.trim()
    ? isPartitionedFocus
      ? `\n# 집중 검증 포커스\n\n${focus.trim()}\n\n위 [담당 영역]을 최우선으로 따른다. 다른 에이전트 담당 영역은 작성하지 말고, 공통 포커스는 담당 영역 안에서만 반영한다.\n`
      : `\n# 집중 검증 포커스\n\n${focus.trim()}\n\n위 포커스를 우선으로 깊게, 그러나 기획서 전반의 핵심도 누락 없이.\n`
    : "";
  const context = `# 1. TC 작성 스킬\n\n${skillBlock}\n\n# 2. 도메인 마스터 정책 (${domain} 기본 정책)\n\n${policyBlock}\n\n# 3. 대상 기획서\n\n${specText || "(기획서 본문 없음)"}\n${focusBlock}`;
  return { tcFolder, skills, policies, context, bu };
}

// 작성 계약 — 작성멀티 합본의 표기 분열·컬럼 공란·인코딩 깨짐을 프롬프트 단에서 차단.
// 공통(전 BU) = 표기 일관성 + 컬럼 무결성(도메인 무관 이득). 커머스 추가 = UI 전용 Title 태그 + 회원/상태전환 글로사리.
// (물류는 발주/입고/피킹 도메인이라 회원·툴팁·노출 등 커머스 태그/용어가 안 맞아 커머스 블록만 제외 — 무결성은 공통으로 적용.)
const GENERIC_WRITE_CONTRACT = `\n# ★ 작성 계약 (표기·컬럼 규약 — 최우선 엄수) ★

## 표기 일관성
- 같은 시나리오를 다른 문구로 중복 표기 금지. 동일 개념은 한 산출물 안에서 동일 단어로 — 용어를 도중에 바꾸지 않는다.
- Title 은 "무엇을_어떤 조건에서_어떤 결과" 가 한눈에 드러나게 일관된 형식으로.

## 컬럼 무결성
- \`Type\` 공란 금지(기본 \`Functional\`, 회귀는 \`리그레션\`). \`Automation Type\` 공란 금지(기본 \`Manual\`). \`Tags\` 에는 기능명을 넣는다.
- 모든 텍스트는 UTF-8, 깨진 문자(�)·물음표블록 금지.
`;
// 커머스 전용 추가 — UI 전용 분류 태그 + 회원/상태전환 글로사리. loadContext.bu === "커머스" 일 때만 덧붙임.
const COMMERCE_WRITE_CONTRACT_EXTRA = `
## (커머스) Title 분류 태그
- Title 맨 앞에 대괄호 분류 태그를 붙인다: [노출] [미노출] [빈도] [분기] [우선순위] [상태전환] [문구] [경계] [툴팁] [인접] [리그레션] 중 하나.
- 예: \`[노출] 비회원_홈진입_첫구매툴팁_노출\`, \`[경계] 회원주문이력無_10분직전재진입_미노출유지\`

## (커머스) 용어 글로사리
- 회원 분류: \`비회원\` / \`회원(주문이력無)\` / \`회원(주문이력有)\` 로만 표기. \`회원\` 컬럼도 이 표기만 사용.
- 붙여쓰기 고정: \`상태전환\`·\`재노출\`·\`미노출\` (\`상태 전환\` 등 띄어쓰기 변형 금지).
`;

const TC_AUTHORING_PIPELINE = `
# ★ TC 작성 내부 절차 (출력 금지, 그러나 반드시 수행) ★

최종 출력은 CSV만 해야 하지만, 작성 전 머릿속으로 아래 4단계를 반드시 끝낸 뒤 CSV를 작성한다.

## 1) Requirement Inventory
- 기획서의 검증 가능한 요구사항을 REQ-ID로 모두 쪼갠다. QA 설계가 REQ-GUEST-001 같은 네임스페이스 ID를 제공하면 그 ID를 그대로 따른다.
- 각 REQ는 조건, 트리거/행동, 기대결과가 분리되어야 한다.
- 문구, 노출/미노출, 우선순위, 상태전환, 빈도/횟수, 예외, 권한/회원상태, 플랫폼 차이는 별도 REQ로 둔다.

## 2) Coverage Plan
- 각 REQ별 정상/비정상/경계/회귀/미노출/우선순위 검증 축을 정한다.
- 축이 2개 이상이면 한 TC에 뭉치지 말고 관찰 가능한 결과 단위로 분리한다.
- "문구 확인"과 "노출 조건 확인"은 기대결과가 다르면 별도 TC로 둔다.

## 3) TC Draft
- 각 TC는 정확히 하나의 핵심 검증 의도를 가진다.
- Pre-condition에는 회원상태, 데이터 상태, 환경/플랫폼, 사전 노출 상태 등 판정에 필요한 조건을 구체적으로 쓴다.
- Test Steps는 실제 수행 가능한 행동만 쓴다. 기획 설명이나 판정 문장을 Step에 섞지 않는다.
- Expected Result는 화면에서 확인할 수 있는 결과와 실패 판정 기준을 명확히 쓴다.

## 4) Self Review & Rewrite
- 최종 CSV 출력 전 아래 항목을 자체 점검하고 문제가 있으면 내부적으로 다시 쓴다.
  - 미커버 REQ 없음
  - 중복 Title/동일 의미 TC 없음
  - Expected Result 빈약/공란 없음
  - Pre-condition 공란 또는 모호한 "해당 상태" 없음
  - 회원/플랫폼/POC/용어 표기 흔들림 없음
  - 한 TC에 여러 기대결과를 과도하게 묶은 케이스 없음
  - 정상만 있고 비정상/경계/미노출이 빠진 영역 없음
- 최종 CSV 행 순서는 에이전트별 작성 순서가 아니라 테스트 진행 흐름 기준으로 정렬한다.
  - POC/화면 단위로 묶고, 같은 POC 안에서는 사전조건/로그인/진입 → 목록/검색/조회 → 상세/노출/문구 → 클릭/입력/상태변경/저장 → 삭제/취소/해지 → 미노출/예외/경계 → 회귀 순서로 둔다.
  - 멀티 에이전트 합본에서도 특정 에이전트 산출물이 한 덩어리로 남지 않게, 수행자가 위에서 아래로 자연스럽게 실행 가능한 순서로 재배열한다.
`;

// QA 설계(분석 마크다운만) 프롬프트
export function assembleDesignPrompt(
  domain: string,
  specText: string,
  focus: string | null,
  refine?: { previousAnalysis: string; instructions: string }
): PromptParts {
  const { tcFolder, skills, policies, context } = loadContext(domain, specText, focus);
  const refineBlock = refine
    ? `\n# 이전 QA 설계 (개선 대상)\n\n${refine.previousAnalysis}\n\n# ★ 개선 지시 (최우선 반영) ★\n\n${refine.instructions}\n\n위 지시를 반영해 분석을 **처음부터 다시** 작성한다 (좋은 부분 유지 + 보완).\n`
    : "";
  const prompt = `당신은 Kurly의 10년차 시니어 QA 엔지니어입니다. 아래 스킬·정책·기획서를 숙지하고, **QA 관점 설계 분석**을 작성합니다. (TC 작성이 아니라, TC를 어떻게 설계할지 판단하는 분석 단계)

${context}${refineBlock}
# 출력 형식 (엄수)
- **마크다운 분석만** 출력. CSV·코드펜스·인사/머리말/꼬리말 금지.
- 아래 항목 순서로 간결하게:
  ## 핵심 정책·기능 요약 (3~5줄)
  ## 리스크 등급
  - R1(치명)~R4(경미) 중 택1 + 한 줄 근거
  ## 리스크 영역
  - 결함 가능성 높은 지점 (bullet)
  ## 엣지·예외 시나리오
  - 놓치기 쉬운 케이스 (bullet)
  ## 요구사항 인벤토리
  - REQ-ID는 반드시 네임스페이스를 포함한다: REQ-{영문영역}-001 형식. 예: REQ-GUEST-001, REQ-MEMBER-001, REQ-TIP-001, REQ-PRIORITY-001
  - 멀티 설계의 각 에이전트는 자기 담당 영역을 나타내는 고유 영문영역을 사용한다. 다른 에이전트와 REQ-001 같은 숫자-only ID를 공유하지 않는다.
  - 검증 가능한 요구사항을 빠짐없이 번호화하고, 각 항목은 "조건/동작/기대결과/리스크등급"이 드러나야 함
  ## 커버리지 전략
  - 각 REQ별로 필요한 정상/비정상/경계/회귀/미노출/우선순위 검증 축과 예상 TC 수를 제안
  ## TC 설계 매트릭스
  - 표로 작성: REQ-ID | 리스크 | 조건 | 트리거/행동 | 기대결과 | TC축(정상/예외/경계/회귀/미노출/우선순위) | 대상 POC/플랫폼 | 우선순위(P1/P2/P3) | 예상 Type
  - 이 표만 보고도 TC 작성자가 원자 단위 TC로 옮길 수 있을 정도로 구체화
  ## 모호점·확인 필요
  - 기획서만으로 판단 안 되는 부분 (없으면 "없음")
  - 각 모호점마다 "확정 전 임시 TC 작성 기준"을 함께 제안
  ## 중점 검증 포인트
  - TC를 특히 촘촘히 둘 곳 (이 부분이 이후 TC 생성에 반영됨)
- 스킬 문서의 대화형 지시("질문 먼저 답하라" 등)는 무시하고 위 형식의 분석만 출력.`;
  return { prompt, skillFiles: skills.map((f) => f.name), policyFiles: policies.map((f) => f.name), tcFolder };
}

// TC 생성(CSV) 프롬프트 — QA 설계 분석 주입 시 반드시 반영.
export function assembleTcGenPrompt(
  domain: string,
  specText: string,
  focus: string | null,
  refine?: { previousCsv: string; instructions: string },
  designAnalysis?: string | null,
  pocs?: string[] | null
): PromptParts {
  const { tcFolder, skills, policies, context, bu } = loadContext(domain, specText, focus);
  const pocList = sanitizePocs(pocs ?? []);
  // 작성멀티 분할 잡 — focus 에 [담당 영역] 마커가 있으면 "기획서 전체 커버"를 "배정 영역만 커버"로 전환(합본 중복 근원 차단).
  const isPartitioned = !!focus && focus.includes(PARTITION_MARKER);
  const isRegressionOnly = requiresRegressionOnly(focus);
  // 작성 계약 — 공통(표기 일관성·컬럼 무결성)은 전 BU, 커머스 전용(UI 태그·회원 글로사리)은 커머스만 덧붙임.
  const contractBlock = GENERIC_WRITE_CONTRACT + (bu === "커머스" ? COMMERCE_WRITE_CONTRACT_EXTRA : "");
  const coverNote = isPartitioned
    ? "단, 이 잡은 작성멀티 분할 잡이므로 **아래 '집중 검증 포커스'의 [담당 영역]에 해당하는 기획서 내용만** 작성하고, 다른 에이전트 담당 영역은 작성하지 않는다(중복 방지)."
    : "TC는 반드시 **# 3. 대상 기획서 전체를 빠짐없이 커버**하며, 분석에 언급되지 않은 기획서의 기능·정책·예외·화면도 모두 TC로 작성한다 (분석에 적힌 것만 작성하는 것 금지).";
  const designBlock = designAnalysis && designAnalysis.trim()
    ? `\n# 4. QA 설계 (반드시 반영) — 아래 분석의 리스크 영역·중점 포인트·엣지/모호점을 TC에 빠짐없이 녹인다\n\n${designAnalysis.trim()}\n\n> ⚠️ 위 QA 설계는 "특히 촘촘히 볼 곳"을 짚는 **가이드일 뿐 TC 작성 범위를 한정하지 않는다.** ${coverNote}\n`
    : "";
  const designReqIds = extractReqIds(designAnalysis);
  const reqRule = designReqIds.length
    ? `\n- **REQ 커버리지 강제: QA 설계의 요구사항 ID(${designReqIds.join(", ")})를 반드시 추적한다. 각 TC의 \`Tags\` 컬럼에는 관련 REQ-ID를 1개 이상 포함한다. 여러 요구사항을 함께 검증하면 \`REQ-TIP-001|REQ-TIP-002\`처럼 모두 적는다. 최종 CSV 전체로 모든 REQ-ID가 최소 1회 이상 커버되어야 한다.**`
    : "";
  const pocBlock = pocList.length
    ? `\n# POC(시트분류) — 이번 생성 대상 (엄수)\n- 대상 POC: ${pocList.join(", ")}\n- 각 TC는 위 대상 POC 중 **정확히 하나**에 속해야 하며, CSV **2번째 \`시트분류\` 컬럼(No 다음)**에 그 POC명을 **목록 표기 그대로** 적는다 (${pocList.join(" / ")} 중 하나).\n- **대상에 없는 POC의 TC는 절대 작성하지 않는다.** 기획서에 다른 시스템/화면 동작이 있어도 대상 POC 범위만 작성.\n- 어느 대상 POC에서 동작하는지는 기획서 근거로 배정한다. 대상 POC 어디에도 해당하지 않는 시나리오는 **생략**(억지 배정 금지).\n`
    : "";
  const refineBlock = refine
    ? `\n# 5. 이전 생성 결과 (개선 대상)\n\n${refine.previousCsv}\n\n# 6. ★ 개선 지시 (최우선 반영) ★\n\n${refine.instructions}\n\n위 지시를 반영해 **전체 TC CSV를 처음부터 다시** 출력 (유지분 포함 전체 재출력).\n`
    : "";
  const pocRule = pocList.length
    ? `\n- **\`시트분류\` 컬럼(2번째, No 다음): 각 행마다 대상 POC 중 하나 필수 — ${pocList.join(" / ")} 중 정확히 하나.** 다른 값 금지.`
    : `\n- \`시트분류\` 컬럼(2번째, No 다음)은 공란으로 둔다.`;
  const roleRule = isRegressionOnly
    ? `\n- **역할 준수 강제: 이 잡은 회귀/리그레션 전용이다. 모든 데이터 행의 \`Type\` 컬럼은 정확히 \`리그레션\`이어야 하며, \`Functional\` 또는 신규 기능 자체 검증 중심 TC는 작성하지 않는다.**`
    : "";
  const prompt = `당신은 Kurly의 10년차 시니어 QA 엔지니어입니다. 아래 스킬·정책·기획서를 숙지하고, Atomic 테스트 케이스(TC)를 **CSV로만** 출력합니다.

${context}${contractBlock}${TC_AUTHORING_PIPELINE}${designBlock}${pocBlock}${refineBlock}
# 출력 형식 (엄수)
- **CSV 텍스트만 출력**. 설명/머리말/꼬리말/코드펜스(\`\`\`) 절대 금지.
- 첫 줄은 정확히 이 헤더:
${TC_CSV_HEADER}
- **모든 데이터 행은 헤더와 정확히 같은 컬럼 수(콤마 개수 동일). 컬럼을 추가/생략하지 말 것** — 빈 컬럼도 자리는 반드시 유지(콤마만).
- **⚠️ 각 행은 반드시 \`…,Pre-condition,Test Steps,Expected Result\` 3개로 끝나며 Expected Result 는 절대 비거나 누락 금지.** 빈 조건 컬럼(상품유형..클레임)을 실수로 빼먹으면 칸이 왼쪽으로 밀려 마지막 Expected Result 가 사라진다 — 빈 조건 컬럼도 콤마로 자리를 꼭 채울 것.
- **Pre-condition 공란 금지.** 최소한 회원상태/플랫폼/진입 화면/사전 데이터 또는 기존 기능 노출 조건 중 판정에 필요한 조건을 1개 이상 구체적으로 작성한다.
- Pre-condition / Test Steps / Expected Result 는 줄바꿈+번호(1. 2. 3.)로 작성하고 **항상 큰따옴표로 감쌀 것**. 셀 값에 콤마·줄바꿈·따옴표가 있으면 반드시 큰따옴표로 감쌀 것.
- 조건 컬럼(상품유형/승인상태/회원/상품/프로모션/주문/클레임)은 해당 시만 기재, 미해당 시 공란(빈 칸 1개, 칸 수는 그대로).${pocRule}${roleRule}${reqRule}
- ${isPartitioned ? "**위 '집중 검증 포커스'의 [담당 영역]에 해당하는 기획서 내용만** atomic 하게 빠짐없이 커버하고, **다른 에이전트 담당 영역의 시나리오는 작성하지 않는다(중복 방지).** 담당 영역 안에서 정상/비정상/경계를 최대한 분해." : "**기획서(# 3) 전체를 빠짐없이 커버**하며, 정상/비정상/경계 케이스를 atomic 하게 최대한 분해."}${designBlock && !isPartitioned ? " QA 설계의 리스크·중점은 특히 촘촘히 — 단 분석은 가이드일 뿐 범위 한정이 아니며, 분석에 없는 기획서 내용도 반드시 포함." : ""}
- **★ 스킬 문서의 "사전점검 질문 먼저 답하라 / 단계별 진행" 같은 대화형·중간출력 지시는 무시. 과정/질문/머리말 출력 금지, 사전점검은 머릿속으로만.**
- **출력의 첫 글자부터 정확히 \`${TC_CSV_HEADER}\` 헤더로 시작. 그 앞에 어떤 텍스트도 두지 않는다.**`;
  return { prompt, skillFiles: skills.map((f) => f.name), policyFiles: policies.map((f) => f.name), tcFolder };
}

// ============== CSV 추출 ==============

export function extractCsv(raw: string): string | null {
  const t = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const lines = t.split(/\r?\n/);
  let hi = lines.findIndex((l) => l.trim().startsWith("No,") && /Title/i.test(l) && /Expected/i.test(l));
  if (hi < 0) hi = lines.findIndex((l) => l.trim().startsWith("No,"));
  if (hi < 0) return null;
  const csv = lines.slice(hi).join("\n").trim();
  return csv.length > 0 ? csv : null;
}

// CSV 셀 직렬화 (콤마·줄바꿈·따옴표 있으면 큰따옴표로 감싸고 내부 따옴표 이스케이프)
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function findHeaderIndex(headerCells: string[], names: string[]): number {
  const normalized = headerCells.map((h) => normalizeTextForCompare(h));
  for (const name of names) {
    const idx = normalized.indexOf(normalizeTextForCompare(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

function getCsvCell(cells: string[], idx: number): string {
  return idx >= 0 ? (cells[idx] ?? "") : "";
}

function keywordRank(text: string, groups: string[][], fallback: number): number {
  const t = normalizeTextForCompare(text);
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].some((kw) => t.includes(normalizeTextForCompare(kw)))) return i;
  }
  return fallback;
}

function pocSortRank(poc: string): number {
  const n = normalizePoc(poc) || poc;
  const known = [
    "컬리몰(웹)", "컬리몰(앱)", "Mobile", "Web",
    "La-CMS", "파트너오피스", "파트너어드민",
  ].map((p) => normalizeTextForCompare(p));
  const idx = known.indexOf(normalizeTextForCompare(n));
  return idx >= 0 ? idx : known.length;
}

function flowSortRank(text: string): number {
  return keywordRank(text, [
    ["사전", "준비", "세팅", "로그인", "권한", "회원", "인증", "접속"],
    ["진입", "랜딩", "홈", "메인", "메뉴", "탭", "이동"],
    ["목록", "리스트", "조회", "검색", "필터", "정렬", "카테고리"],
    ["상세", "정보", "영역", "섹션", "배너", "툴팁", "모달", "팝업"],
    ["노출", "문구", "표시", "레이블", "버튼", "아이콘", "이미지"],
    ["클릭", "선택", "입력", "체크", "해제", "전환", "변경", "적용"],
    ["저장", "생성", "등록", "발급", "업로드", "다운로드", "주문", "결제"],
    ["수정", "삭제", "취소", "해지", "복구", "초기화"],
    ["미노출", "차단", "실패", "오류", "에러", "예외", "비정상"],
    ["경계", "최대", "최소", "이상", "이하", "초과", "미만", "직전", "직후", "빈값", "없음"],
    ["회귀", "리그레션", "기존", "인접", "영향"],
  ], 99);
}

function typeSortRank(type: string, title: string): number {
  const text = `${type} ${title}`;
  return keywordRank(text, [
    ["정상", "functional", "기능", "노출", "문구"],
    ["상태전환", "변경", "저장", "등록", "삭제", "해지"],
    ["미노출", "예외", "오류", "실패", "negative", "abnormal"],
    ["경계", "boundary"],
    ["회귀", "리그레션", "regression"],
  ], 9);
}

function prioritySortRank(priority: string): number {
  const p = normalizeTextForCompare(priority);
  if (/(p0|critical|긴급|최상)/i.test(p)) return 0;
  if (/(p1|high|높음)/i.test(p)) return 1;
  if (/(p2|medium|중간)/i.test(p)) return 2;
  if (/(p3|low|낮음)/i.test(p)) return 3;
  return 9;
}

function sortTcRowsByExecutionFlow(rows: string[], headerCells: string[]): string[] {
  const idx = {
    poc: findHeaderIndex(headerCells, ["시트분류", "poc", "sheet"]),
    type: findHeaderIndex(headerCells, ["type", "유형"]),
    priority: findHeaderIndex(headerCells, ["priority", "우선순위"]),
    title: findHeaderIndex(headerCells, ["title", "제목"]),
    depth1: findHeaderIndex(headerCells, ["1depth", "1 depth"]),
    depth2: findHeaderIndex(headerCells, ["2depth", "2 depth"]),
    depth3: findHeaderIndex(headerCells, ["3depth", "3 depth"]),
    pre: findHeaderIndex(headerCells, ["pre-condition", "precondition", "사전조건"]),
    steps: findHeaderIndex(headerCells, ["test steps", "test step", "steps", "수행단계", "테스트단계"]),
    expected: findHeaderIndex(headerCells, ["expected result", "expected results", "기대결과", "예상결과"]),
  };

  return rows
    .map((line, originalIndex) => {
      const cells = parseCsvRow(line);
      const title = getCsvCell(cells, idx.title);
      const flowText = [
        getCsvCell(cells, idx.depth1),
        getCsvCell(cells, idx.depth2),
        getCsvCell(cells, idx.depth3),
        title,
        getCsvCell(cells, idx.steps),
        getCsvCell(cells, idx.expected),
      ].join(" ");
      return {
        line,
        originalIndex,
        pocRank: pocSortRank(getCsvCell(cells, idx.poc)),
        poc: normalizeTextForCompare(getCsvCell(cells, idx.poc)),
        flowRank: flowSortRank(flowText),
        typeRank: typeSortRank(getCsvCell(cells, idx.type), title),
        priorityRank: prioritySortRank(getCsvCell(cells, idx.priority)),
        pathKey: normalizeTextForCompare([
          getCsvCell(cells, idx.depth1),
          getCsvCell(cells, idx.depth2),
          getCsvCell(cells, idx.depth3),
        ].join("|")),
        titleKey: normalizeTextForCompare(title),
      };
    })
    .sort((a, b) =>
      a.pocRank - b.pocRank ||
      a.poc.localeCompare(b.poc) ||
      a.flowRank - b.flowRank ||
      a.typeRank - b.typeRank ||
      a.priorityRank - b.priorityRank ||
      a.pathKey.localeCompare(b.pathKey) ||
      a.titleKey.localeCompare(b.titleKey) ||
      a.originalIndex - b.originalIndex
    )
    .map((item) => item.line);
}

// 컬럼 수 정규화 — 모델이 조건 컬럼(상품유형..클레임) sparse 영역에서 빈 셀을 더 끼우거나(행↑) 빼먹어(행↓) 컬럼이 밀리는 현상 복구.
//  - 셀 많음(>H): sparse 영역의 잉여 '빈' 셀 제거.
//  - 셀 부족(<H): sparse 영역에 빈 셀 삽입해 꼬리(전제·스텝·기대결과)를 우측 정렬 → 마지막 Expected Result 복구.
// 컬럼 순서·헤더는 그대로. 정상 행·못 고치는 행은 원본 보존(데이터 우선).
export function normalizeCsvColumns(csv: string): { csv: string; repaired: number; broken: number } {
  const lines = splitCsvLines(csv);
  if (lines.length < 2) return { csv, repaired: 0, broken: 0 };
  const header = parseCsvRow(lines[0]);
  const H = header.length;
  const lc = header.map((h) => h.trim().toLowerCase());
  const depth3 = lc.findIndex((h) => h === "3depth");
  const preIdx = lc.findIndex((h) => h === "pre-condition" || h === "precondition" || h === "사전조건");
  const sparseStart = depth3 >= 0 ? depth3 + 1 : 11;                          // 조건 컬럼 시작(3depth 다음)
  const sparseEndExcl = preIdx >= 0 ? preIdx : Math.max(sparseStart, H - 3);  // pre-condition 직전까지
  const out: string[] = [lines[0]];
  let repaired = 0, broken = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    if (cells.length === H) { out.push(lines[i]); continue; }   // 정상
    if (cells.length < H) {
      // 부족 — 모델이 빈 sparse 컬럼(상품유형..클레임)을 생략해 꼬리(전제·스텝·기대결과)가 왼쪽으로 밀린 경우.
      // sparse 영역에 빈 셀을 끼워 꼬리를 우측 정렬 → 마지막 Expected Result 복구. (컬럼 순서·값 보존)
      const gap = H - cells.length;
      const T = preIdx >= 0 ? H - preIdx : 3;   // 꼬리 컬럼 수(전제·스텝·기대결과)
      const p = cells.length - T;               // 짧은 행에서 꼬리가 시작되는 위치
      if (T > 0 && p >= sparseStart && p <= sparseEndExcl) {
        const fixed = [...cells.slice(0, p), ...Array(gap).fill(""), ...cells.slice(p)];
        out.push(fixed.map(csvCell).join(","));
        repaired++;
      } else {
        out.push(lines[i]); broken++;            // 꼬리 밀림 패턴 아님(불확실) → 원본 유지
      }
      continue;
    }
    let extra = cells.length - H;
    const kept = [...cells];
    for (let j = Math.min(sparseEndExcl, kept.length) - 1; j >= sparseStart && extra > 0; j--) {
      if ((kept[j] ?? "").trim() === "") { kept.splice(j, 1); extra--; }      // sparse 영역의 빈 셀만 제거
    }
    if (extra === 0 && kept.length === H) { out.push(kept.map(csvCell).join(",")); repaired++; }
    else { out.push(lines[i]); broken++; }                     // 못 고치면 원본 유지
  }
  return { csv: out.join("\n"), repaired, broken };
}

type QualitySeverity = "error" | "warn";

export interface TcQualityIssue {
  severity: QualitySeverity;
  code: string;
  message: string;
  rows?: string[];
}

export interface TcQualityReview {
  score: number;
  grade: "A" | "B" | "C" | "D";
  totalRows: number;
  issueCounts: { error: number; warn: number };
  issues: TcQualityIssue[];
  hints: string[];
  coverage?: {
    requiredReqIds: string[];
    taggedReqIds?: string[];
    coveredReqIds: string[];
    missingReqIds: string[];
  };
}

export function extractReqIds(text: string | null | undefined): string[] {
  const matches = (text || "").match(/\bREQ-(?:[A-Z][A-Z0-9]*-)?\d{3,}\b/gi) ?? [];
  return [...new Set(matches.map((m) => m.toUpperCase()))].sort();
}

export interface QaDesignQualityIssue {
  severity: QualitySeverity;
  code: string;
  message: string;
}

export interface QaDesignQualityReview {
  score: number;
  grade: "A" | "B" | "C" | "D";
  reqIds: string[];
  issueCounts: { error: number; warn: number };
  issues: QaDesignQualityIssue[];
  strengths: string[];
  hints: string[];
  checks: {
    reqInventory: boolean;
    tcMatrix: boolean;
    coverageStrategy: boolean;
    ambiguity: boolean;
    risk: boolean;
    priority: boolean;
    pocOrPlatform: boolean;
  };
}

export function reviewQaDesignQuality(analysis: string | null | undefined): QaDesignQualityReview {
  const text = (analysis || "").trim();
  const issues: QaDesignQualityIssue[] = [];
  const strengths: string[] = [];
  const hints: string[] = [];
  const reqIds = extractReqIds(text);
  const allReqMentions = text.match(/\bREQ-(?:[A-Z][A-Z0-9]*-)?\d{3,}\b/gi) ?? [];
  const upperMentions = allReqMentions.map((m) => m.toUpperCase());
  const duplicateReqIds = [...new Set(upperMentions)]
    .filter((reqId) => upperMentions.filter((m) => m === reqId).length > 8);
  const numericOnlyReqIds = reqIds.filter((reqId) => /^REQ-\d{3,}$/.test(reqId));

  const checks = {
    reqInventory: /요구사항|REQ-|인벤토리/i.test(text) && reqIds.length >= 5,
    tcMatrix: /TC\s*설계\s*매트릭스|REQ-ID\s*\|.*조건.*기대결과|검증\s*의도/i.test(text),
    coverageStrategy: /커버리지\s*전략|예상\s*TC|정상.*예외|경계.*회귀/i.test(text),
    ambiguity: /모호|확인\s*필요|임시\s*기준|AMBIG/i.test(text),
    risk: /리스크|R[1-3]|위험/i.test(text),
    priority: /\bP[1-3]\b|우선순위/i.test(text),
    pocOrPlatform: /POC|플랫폼|앱|웹|AOS|iOS|모바일웹|컬리몰/i.test(text),
  };

  if (!text) {
    issues.push({ severity: "error", code: "EMPTY_ANALYSIS", message: "설계 분석 결과가 비어 있습니다." });
  }
  if (reqIds.length === 0) {
    issues.push({ severity: "error", code: "NO_REQ_IDS", message: "REQ-ID가 없습니다. TC 작성 커버리지 추적이 어렵습니다." });
  } else if (reqIds.length < 5) {
    issues.push({ severity: "warn", code: "LOW_REQ_COUNT", message: `REQ-ID가 ${reqIds.length}개뿐입니다. 요구사항 분해가 너무 큰 단위일 수 있습니다.` });
  } else {
    strengths.push(`REQ-ID ${reqIds.length}개를 추출했습니다.`);
  }
  if (numericOnlyReqIds.length > 0) {
    issues.push({ severity: "warn", code: "NUMERIC_ONLY_REQ_ID", message: `네임스페이스 없는 REQ-ID가 있습니다: ${numericOnlyReqIds.slice(0, 6).join(", ")}` });
  }
  if (duplicateReqIds.length > 0) {
    issues.push({ severity: "warn", code: "REQ_OVERUSED", message: `일부 REQ-ID가 과도하게 반복됩니다. 매트릭스/전략 중복 여부를 확인하세요: ${duplicateReqIds.slice(0, 6).join(", ")}` });
  }
  if (!checks.reqInventory) issues.push({ severity: "error", code: "NO_REQ_INVENTORY", message: "요구사항 인벤토리가 충분히 보이지 않습니다." });
  if (!checks.tcMatrix) issues.push({ severity: "error", code: "NO_TC_MATRIX", message: "TC 작성용 설계 매트릭스가 없습니다." });
  if (!checks.coverageStrategy) issues.push({ severity: "warn", code: "NO_COVERAGE_STRATEGY", message: "REQ별 정상/예외/경계/회귀 커버리지 전략이 약합니다." });
  if (!checks.ambiguity) issues.push({ severity: "warn", code: "NO_AMBIGUITY_SECTION", message: "모호점/확인 필요/임시 기준 섹션이 없습니다." });
  if (!checks.risk) issues.push({ severity: "warn", code: "NO_RISK", message: "리스크 등급이나 리스크 영역이 명확하지 않습니다." });
  if (!checks.priority) issues.push({ severity: "warn", code: "NO_PRIORITY", message: "P1/P2/P3 또는 우선순위 기준이 부족합니다." });
  if (!checks.pocOrPlatform) issues.push({ severity: "warn", code: "NO_POC_PLATFORM", message: "대상 POC/플랫폼 분리가 부족합니다." });

  if (checks.tcMatrix) strengths.push("TC 설계 매트릭스가 포함되어 있습니다.");
  if (checks.coverageStrategy) strengths.push("커버리지 전략이 포함되어 있습니다.");
  if (checks.ambiguity) strengths.push("모호점/확인 필요 항목을 분리했습니다.");
  if (checks.risk) strengths.push("리스크 관점이 포함되어 있습니다.");

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  let score = 100;
  score -= errorCount * 20;
  score -= warnCount * 6;
  if (reqIds.length > 0) score += Math.min(8, Math.floor(reqIds.length / 4));
  score = Math.max(0, Math.min(100, score));
  const grade: QaDesignQualityReview["grade"] = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";

  if (!checks.tcMatrix) hints.push("TC 작성으로 넘기기 전 REQ-ID별 조건/트리거/기대결과/우선순위 매트릭스를 추가하세요.");
  if (!checks.ambiguity) hints.push("기획서가 애매한 부분은 확정 요구사항과 임시 TC 기준으로 분리하는 것이 좋습니다.");
  if (numericOnlyReqIds.length > 0) hints.push("REQ-ID는 REQ-MEMBER-001처럼 영역 네임스페이스를 붙이면 멀티 에이전트 충돌이 줄어듭니다.");
  if (reqIds.length > 0) hints.push("TC 작성 시 각 TC의 Tags 또는 Title에 관련 REQ-ID를 반드시 포함하세요.");

  return {
    score,
    grade,
    reqIds,
    issueCounts: { error: errorCount, warn: warnCount },
    issues,
    strengths,
    hints,
    checks,
  };
}

function reqIdsForQualityReview(input: { designAnalysis?: string | null; focus?: string | null; scope?: "job" | "group" }): string[] {
  if (input.scope === "group") return extractReqIds(input.designAnalysis);
  const focusReqIds = extractReqIds(input.focus);
  if (focusReqIds.length > 0) return focusReqIds;
  return extractReqIds(input.designAnalysis);
}

function normalizeTextForCompare(v: string): string {
  return v
    .replace(/\s+/g, "")
    .replace(/[()[\]{}_'"\-·]/g, "")
    .replace(/상태전환/g, "상태전환")
    .toLowerCase();
}

function splitNumberedItems(v: string): string[] {
  return v
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowNo(row: Record<string, string>, fallback: number): string {
  return (row["No"] || row["no"] || String(fallback)).trim();
}

export function reviewTcCsvQuality(csv: string, input: { domain: string; pocs?: string[] | null; focus?: string | null; designAnalysis?: string | null; scope?: "job" | "group" }): TcQualityReview {
  const lines = splitCsvLines(csv.replace(/^﻿/, ""));
  const issues: TcQualityIssue[] = [];
  const hints: string[] = [];
  if (lines.length < 2) {
    return {
      score: 0,
      grade: "D",
      totalRows: 0,
      issueCounts: { error: 1, warn: 0 },
      issues: [{ severity: "error", code: "NO_ROWS", message: "TC 데이터 행이 없습니다." }],
      hints,
    };
  }

  const header = parseCsvRow(lines[0]).map((h) => h.trim());
  const expectedHeader = TC_CSV_HEADER.split(",");
  if (header.join(",") !== expectedHeader.join(",")) {
    issues.push({
      severity: "warn",
      code: "HEADER_MISMATCH",
      message: "표준 TC CSV 헤더와 다릅니다. 다운로드/실행 연계에서 컬럼 해석이 흔들릴 수 있습니다.",
    });
  }

  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h, i));
  const get = (cells: string[], name: string) => cells[idx.get(name) ?? -1] ?? "";
  const rows = lines.slice(1).map((line, i) => {
    const cells = parseCsvRow(line);
    const obj: Record<string, string> = {};
    header.forEach((h, j) => { obj[h] = cells[j] ?? ""; });
    return { lineNo: i + 1, cells, obj };
  }).filter((r) => r.cells.some((c) => c.trim()));

  const pocs = sanitizePocs(input.pocs ?? []);
  const titleSeen = new Map<string, string[]>();
  const intentSeen = new Map<string, string[]>();
  const invalidPocRows: string[] = [];
  const weakExpectedRows: string[] = [];
  const emptyPreRows: string[] = [];
  const weakPreRows: string[] = [];
  const weakStepRows: string[] = [];
  const multiIntentRows: string[] = [];
  const badPriorityRows: string[] = [];
  const badRequiredRows: string[] = [];
  const commerceTitleNoTagRows: string[] = [];
  const regressionTypeMismatchRows: string[] = [];
  const requiredReqIds = reqIdsForQualityReview(input);
  const taggedReqIds = new Set<string>();
  const coveredReqIds = new Set<string>();
  const memberTerms = new Set<string>();
  let abnormalCount = 0;
  let boundaryLikeCount = 0;
  let negativeLikeCount = 0;

  const domainConfig = getDomainById(input.domain);
  const isCommerce = domainConfig?.bu !== "물류";
  const shouldBeRegressionOnly = requiresRegressionOnly(input.focus);

  rows.forEach((r, i) => {
    const no = rowNo(r.obj, i + 1);
    if (r.cells.length !== header.length) badRequiredRows.push(no);

    const title = get(r.cells, "Title").trim();
    const tags = get(r.cells, "Tags").trim();
    const priority = get(r.cells, "Priority").trim();
    const abnormal = get(r.cells, "Abnormal").trim();
    const type = get(r.cells, "Type").trim();
    const automationType = get(r.cells, "Automation Type").trim();
    const pre = get(r.cells, "Pre-condition").trim();
    const steps = get(r.cells, "Test Steps").trim();
    const expected = get(r.cells, "Expected Result").trim();
    const poc = get(r.cells, "시트분류").trim();
    const member = get(r.cells, "회원").trim();

    if (!title || !type || !automationType || !priority || !expected) badRequiredRows.push(no);
    if (shouldBeRegressionOnly && type !== "리그레션") regressionTypeMismatchRows.push(no);
    if (!["P1", "P2", "P3"].includes(priority)) badPriorityRows.push(no);
    if (pocs.length && !pocs.includes(poc)) invalidPocRows.push(no);
    if (isCommerce && title && !/^\[[^\]]+\]/.test(title)) commerceTitleNoTagRows.push(no);
    if (member) memberTerms.add(member);
    if (/abnormal|yes|true|y|비정상|예외/i.test(abnormal)) abnormalCount++;
    if (/경계|직전|직후|초과|미만|이상|이하|최대|최소|0원|빈값|없는|없음/.test(`${title} ${pre} ${steps} ${expected}`)) boundaryLikeCount++;
    if (/미노출|불가|실패|오류|에러|제한|차단|권한|예외|없음/.test(`${title} ${expected}`)) negativeLikeCount++;
    const rowReqIds = extractReqIds(`${tags} ${title}`);
    rowReqIds.forEach((reqId) => taggedReqIds.add(reqId));

    const titleKey = normalizeTextForCompare(`${poc}|${title}`);
    if (titleKey) titleSeen.set(titleKey, [...(titleSeen.get(titleKey) ?? []), no]);
    const intentKey = normalizeTextForCompare(`${title}|${pre}|${expected}`);
    if (intentKey) intentSeen.set(intentKey, [...(intentSeen.get(intentKey) ?? []), no]);

    const stepItems = splitNumberedItems(steps);
    const expectedItems = splitNumberedItems(expected);
    const hasExecutableEvidence = stepItems.length > 0 && steps.length >= 10 && expected.length >= 18;
    if (hasExecutableEvidence) rowReqIds.forEach((reqId) => coveredReqIds.add(reqId));

    if (!pre) emptyPreRows.push(no);
    else if (pre.length < 8 || /^(해당|정상|사전조건|준비)$/i.test(pre)) weakPreRows.push(no);
    if (!steps || stepItems.length === 0 || steps.length < 10) weakStepRows.push(no);
    if (!expected || expected.length < 18 || /^(정상|정상 동작|노출|미노출|확인|pass)$/i.test(expected.replace(/\s+/g, " "))) {
      weakExpectedRows.push(no);
    }
    if (expectedItems.length >= 4 || /( 및 |와 |과 |동시에|각각)/.test(title)) multiIntentRows.push(no);
  });

  const duplicateTitles = [...titleSeen.entries()].filter(([, nos]) => nos.length > 1);
  const duplicateIntents = [...intentSeen.entries()].filter(([, nos]) => nos.length > 1);

  const pushRows = (severity: QualitySeverity, code: string, message: string, rowList: string[], limit = 12) => {
    if (rowList.length === 0) return;
    issues.push({
      severity,
      code,
      message: `${message} (${rowList.length}건)`,
      rows: rowList.slice(0, limit),
    });
  };

  pushRows("error", "BAD_COLUMNS_OR_REQUIRED", "컬럼 수가 맞지 않거나 필수 컬럼 값이 비어 있습니다.", [...new Set(badRequiredRows)]);
  pushRows("error", "INVALID_POC", "대상 POC 목록에 없는 시트분류가 있습니다.", invalidPocRows);
  pushRows("error", "ROLE_TYPE_MISMATCH", "회귀/리그레션 전용 지시가 있었지만 Type 컬럼이 '리그레션'이 아닙니다.", regressionTypeMismatchRows);
  pushRows("error", "EMPTY_PRECONDITION", "Pre-condition이 비어 있습니다.", emptyPreRows);
  pushRows("warn", "BAD_PRIORITY", "Priority는 P1/P2/P3 중 하나여야 합니다.", badPriorityRows);
  pushRows("warn", "WEAK_EXPECTED", "Expected Result가 비어 있거나 판정 기준이 약합니다.", weakExpectedRows);
  pushRows("warn", "WEAK_PRECONDITION", "Pre-condition이 비어 있거나 구체성이 낮습니다.", weakPreRows);
  pushRows("warn", "WEAK_STEPS", "Test Steps가 비어 있거나 수행 행동이 부족합니다.", weakStepRows);
  pushRows("warn", "MULTI_INTENT", "한 TC에 여러 검증 의도가 섞였을 가능성이 있습니다.", multiIntentRows);
  pushRows("warn", "COMMERCE_TITLE_TAG", "커머스 TC Title 앞에 분류 태그([노출] 등)가 없습니다.", commerceTitleNoTagRows);

  const missingReqIds = requiredReqIds.filter((reqId) => !coveredReqIds.has(reqId));
  if (missingReqIds.length > 0) {
    issues.push({
      severity: "error",
      code: "MISSING_REQ_COVERAGE",
      message: `QA 설계 요구사항 REQ-ID가 실행 가능한 TC에서 커버되지 않았습니다. (${missingReqIds.length}건)`,
      rows: missingReqIds.slice(0, 16),
    });
  }

  if (duplicateTitles.length > 0) {
    issues.push({
      severity: "warn",
      code: "DUPLICATE_TITLE",
      message: `동일 Title이 반복됩니다. (${duplicateTitles.length}종)`,
      rows: duplicateTitles.flatMap(([, nos]) => nos).slice(0, 16),
    });
  }
  if (duplicateIntents.length > 0) {
    issues.push({
      severity: "warn",
      code: "DUPLICATE_INTENT",
      message: `Pre-condition/Expected까지 유사한 중복 TC가 있습니다. (${duplicateIntents.length}종)`,
      rows: duplicateIntents.flatMap(([, nos]) => nos).slice(0, 16),
    });
  }

  if (rows.length >= 8 && abnormalCount === 0 && negativeLikeCount === 0) {
    issues.push({ severity: "warn", code: "NO_NEGATIVE_CASES", message: "정상 케이스 위주로 보입니다. 비정상/미노출/예외 케이스가 누락됐는지 확인이 필요합니다." });
  }
  if (rows.length >= 8 && boundaryLikeCount === 0) {
    issues.push({ severity: "warn", code: "NO_BOUNDARY_CASES", message: "경계값/직전·직후/최대·최소 계열 케이스가 보이지 않습니다." });
  }
  if (isCommerce && memberTerms.size > 1) {
    const compact = [...memberTerms].map((v) => v.replace(/\s+/g, ""));
    if (new Set(compact).size < memberTerms.size) {
      issues.push({
        severity: "warn",
        code: "TERM_VARIANTS",
        message: `회원 컬럼 표기가 흔들립니다: ${[...memberTerms].slice(0, 8).join(" / ")}`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  let score = 100;
  score -= errorCount * 18;
  score -= warnCount * 6;
  score -= Math.min(45, emptyPreRows.length * 2);
  score -= Math.min(45, regressionTypeMismatchRows.length * 2);
  score -= Math.min(40, missingReqIds.length * 8);
  score -= Math.min(20, Math.max(0, weakExpectedRows.length - 2) * 2);
  score -= Math.min(12, duplicateTitles.length * 3 + duplicateIntents.length * 4);
  score = Math.max(0, Math.min(100, score));
  const grade: TcQualityReview["grade"] = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";

  if (grade !== "A") {
    hints.push("품질 점수가 낮으면 결과 화면의 '개선'에 품질 리포트 내용을 붙여 재생성하세요.");
  }
  if (weakExpectedRows.length > 0) hints.push("Expected Result는 화면 판정 기준과 실패 기준이 드러나도록 1~3문장으로 보강하는 것이 좋습니다.");
  if (emptyPreRows.length > 0) hints.push("Pre-condition 공란 행은 회원상태, 플랫폼, 화면, 데이터 상태 등 실행 전제를 반드시 채우세요.");
  if (duplicateTitles.length > 0 || duplicateIntents.length > 0) hints.push("중복 TC는 요구사항/조건/기대결과 중 하나라도 관찰 차이가 없으면 합치거나 제거하세요.");
  if (regressionTypeMismatchRows.length > 0) hints.push("리그레션 전용 에이전트 결과는 신규 기능 검증을 제거하고 모든 Type을 '리그레션'으로 재작성해야 합니다.");
  if (missingReqIds.length > 0) hints.push(`미커버 REQ를 추가 작성하거나 기존 TC Tags에 연결하세요: ${missingReqIds.slice(0, 8).join(", ")}`);

  return {
    score,
    grade,
    totalRows: rows.length,
    issueCounts: { error: errorCount, warn: warnCount },
    issues,
    hints,
    coverage: requiredReqIds.length > 0
      ? {
          requiredReqIds,
          coveredReqIds: requiredReqIds.filter((reqId) => coveredReqIds.has(reqId)),
          missingReqIds,
          taggedReqIds: requiredReqIds.filter((reqId) => taggedReqIds.has(reqId)),
        }
      : undefined,
  };
}

const AUTO_QUALITY_REFINE_MARKER = "[AUTO_QUALITY_REFINE]";

function parseAutoQualityRefine(instructions: string | null | undefined): { iteration: number; max: number; threshold: number } | null {
  const text = instructions || "";
  if (!text.includes(AUTO_QUALITY_REFINE_MARKER)) return null;
  const num = (name: string, fallback: number) => {
    const m = text.match(new RegExp(`${name}=(\\d+)`));
    return m ? Number(m[1]) : fallback;
  };
  return {
    iteration: num("iteration", 1),
    max: Math.max(1, Math.min(5, num("max", 2))),
    threshold: Math.max(0, Math.min(100, num("threshold", AUTO_REFINE_THRESHOLD))),
  };
}

export function readTcQualityReview(outputPath: string | null): TcQualityReview | null {
  const resolved = resolveTcOutputPath(outputPath);
  if (!resolved) return null;
  const reviewPath = path.join(path.dirname(resolved), "quality-review.json");
  if (!fs.existsSync(reviewPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reviewPath, "utf-8")) as TcQualityReview;
  } catch {
    return null;
  }
}

export function getActiveQualityRefineChild(parentId: string): TcGenJob | null {
  return (db.prepare(`
    SELECT *
    FROM tc_gen_jobs
    WHERE parent_id = ?
      AND status IN ('pending', 'running')
      AND refine_instructions LIKE ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(parentId, `%${AUTO_QUALITY_REFINE_MARKER}%`) as TcGenJob | undefined) ?? null;
}

export function buildQualityRefineInstructions(
  job: TcGenJob,
  review: TcQualityReview,
  opts?: { iteration?: number; max?: number; threshold?: number; suppressMissingReq?: boolean }
): string {
  const iteration = opts?.iteration ?? 1;
  const max = opts?.max ?? 2;
  const threshold = opts?.threshold ?? AUTO_REFINE_THRESHOLD;
  const issueLines = review.issues.slice(0, 10).map((issue) => {
    const label = issue.code === "MISSING_REQ_COVERAGE" ? "대상 REQ" : "대상 No";
    const rows = issue.rows?.length ? ` / ${label}: ${issue.rows.join(", ")}` : "";
    return `- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}${rows}`;
  });
  const issueCodes = new Set(review.issues.map((i) => i.code));
  const directives: string[] = [];

  if (issueCodes.has("ROLE_TYPE_MISMATCH")) {
    directives.push(
      "회귀/리그레션 전용 지시를 최우선으로 지킨다. 모든 데이터 행의 Type 컬럼은 정확히 '리그레션'이어야 한다.",
      "신규 기능 자체의 노출/문구/빈도 검증 중심 TC는 제거하거나 기존 영역 영향 검증으로 재작성한다.",
      "기존 플로우, 기존 UI, 기존 팝업/툴팁/배너, 기존 이동/전환, 인접 영역 충돌 여부를 회귀 관점으로 작성한다."
    );
  }
  if (issueCodes.has("WEAK_EXPECTED")) {
    directives.push("Expected Result는 화면에서 관찰 가능한 합격 기준과 실패 기준이 드러나도록 구체화한다.");
  }
  if (issueCodes.has("WEAK_PRECONDITION")) {
    directives.push("Pre-condition에는 회원상태, 데이터 상태, 플랫폼, 사전 노출/미노출 상태를 구체적으로 쓴다.");
  }
  if (issueCodes.has("EMPTY_PRECONDITION")) {
    directives.push("Pre-condition이 비어 있는 행은 모두 보강한다. 각 행에 회원상태, 플랫폼, 진입 화면, 기존 기능 노출 조건, 사전 데이터 중 실행 판단에 필요한 조건을 구체적으로 작성한다.");
  }
  if (issueCodes.has("WEAK_STEPS")) {
    directives.push("Test Steps는 실제 수행 가능한 클릭/진입/확인 행동 단위로 쪼갠다.");
  }
  if (issueCodes.has("MULTI_INTENT")) {
    directives.push("한 TC에 여러 검증 의도가 섞인 행은 관찰 가능한 결과 단위로 분리한다.");
  }
  if (issueCodes.has("DUPLICATE_TITLE") || issueCodes.has("DUPLICATE_INTENT")) {
    directives.push("동일 의미 TC는 병합하고, POC/조건/기대결과가 다른 경우 Title에 차이를 명확히 드러낸다.");
  }
  if (issueCodes.has("NO_NEGATIVE_CASES")) {
    directives.push("정상 케이스만 작성하지 말고 미노출/예외/권한/실패/차단 케이스를 보강한다.");
  }
  if (issueCodes.has("NO_BOUNDARY_CASES")) {
    directives.push("직전/직후, 이상/미만, 최대/최소, 빈값/없음 등 경계 케이스를 보강한다.");
  }
  if (issueCodes.has("INVALID_POC")) {
    directives.push("시트분류 컬럼은 대상 POC 목록에 있는 값만 사용한다.");
  }
  if (issueCodes.has("BAD_COLUMNS_OR_REQUIRED")) {
    directives.push("헤더와 모든 행의 컬럼 수를 정확히 맞추고 필수 컬럼 공란을 없앤다.");
  }
  // 분할 멀티: 합본 커버리지가 이미 full이면(suppressMissingReq) 이 에이전트엔 미커버 REQ 보강을 안 시킨다 — 남의 영역까지 커버해 중복↑ 방지.
  if (issueCodes.has("MISSING_REQ_COVERAGE") && review.coverage?.missingReqIds.length && !opts?.suppressMissingReq) {
    directives.push(`미커버 요구사항 ${review.coverage.missingReqIds.join(", ")}를 커버하는 TC를 추가하거나 기존 TC를 보강한다.`);
    directives.push("각 보강 TC의 Tags 컬럼에는 해당 REQ-ID를 반드시 포함한다.");
  }

  return `${AUTO_QUALITY_REFINE_MARKER} iteration=${iteration} max=${max} threshold=${threshold}

아래 품질 리뷰를 근거로 전체 TC CSV를 처음부터 다시 재작성한다.
현재 품질 점수: ${review.grade} (${review.score}/100), 전체 ${review.totalRows}건, error ${review.issueCounts.error}, warn ${review.issueCounts.warn}
원본 잡: ${job.id}${job.agent_nickname ? ` / 에이전트: ${job.agent_nickname}` : ""}

품질 이슈:
${issueLines.length ? issueLines.join("\n") : "- 명시 이슈 없음. 점수 기준 미달 원인을 자체 분석해 개선한다."}

개선 지시:
${directives.length ? directives.map((d) => `- ${d}`).join("\n") : "- 품질 리뷰의 지적 사항을 반영해 중복, 모호한 기대결과, 누락된 경계/예외/회귀 관점을 보강한다."}

작성 규칙:
- 좋은 TC는 유지하되, 위 이슈가 있는 행은 수정/삭제/분리/보강한다.
- 최종 CSV 행 순서는 에이전트/작성 순서가 아니라 테스트 진행 흐름 기준으로 재정렬한다. POC/화면별로 묶고 사전조건/진입 → 조회/노출 → 조작/상태변경 → 저장/삭제/해지 → 예외/경계/회귀 순서가 되게 한다.
- 최종 출력은 전체 CSV만 재출력한다.
- 이전 CSV의 문제를 설명하지 말고 개선된 CSV만 생성한다.`;
}

export function createQualityRefineJob(parentId: string, opts?: { max?: number; threshold?: number; iteration?: number }): TcGenJob {
  const parent = getTcGenJob(parentId);
  if (!parent) throw new Error(`원본 잡 없음: ${parentId}`);
  const activeChild = getActiveQualityRefineChild(parentId);
  if (activeChild) throw new Error(`이미 진행 중인 자동 개선 잡이 있습니다: ${activeChild.id}`);
  const review = readTcQualityReview(parent.output_path);
  if (!review) throw new Error("품질 리뷰 파일이 없습니다. 먼저 TC 생성이 완료되어야 합니다.");
  // 분할 멀티: 부모가 속한 그룹의 합본 커버리지가 이미 full이면, 이 에이전트엔 미커버 REQ 보강 지시를 빼서 중복 폭증을 막는다.
  let suppressMissingReq = false;
  try {
    const groupId = getTcGenEffectiveGroupId(parent);
    if (groupId) {
      const merged = mergeTcGenGroupCsv(groupId);
      if (merged) {
        const mergedReview = reviewTcCsvQuality(merged.csv, { domain: parent.domain, pocs: parseJobPocs(parent.pocs), focus: parent.focus, designAnalysis: parent.qa_analysis, scope: "group" });
        if (mergedReview.coverage && mergedReview.coverage.missingReqIds.length === 0) suppressMissingReq = true;
      }
    }
  } catch { /* 합본 평가 실패 — 억제 안 함(안전) */ }
  const instructions = buildQualityRefineInstructions(parent, review, {
    iteration: opts?.iteration ?? 1,
    max: opts?.max ?? 2,
    threshold: opts?.threshold ?? AUTO_REFINE_THRESHOLD,
    suppressMissingReq,
  });
  return createRefineJob(parentId, instructions);
}

// ============== 프롬프트 조립 (생성 시 1회) ==============

// 잡 1건의 claude 프롬프트 + 모델 + 조립 로그를 만든다 (kind/refine/design/pocs 분기).
// 생성 시점에 호출해 DB 에 저장 → 워커는 이 prompt 로 claude -p 만 돌리면 됨.
// 하네스 엔진 활성 여부 (env TCGEN_HARNESS: off/legacy→비활성, all/on→둘 다, logistics|commerce→해당 bu만).
// 기본 off — 워커(KURLY_HARNESS_PATH) 준비 + F 검증 통과 후 on 으로 전환(롤아웃 안전장치).
function harnessBuEnabled(bu: "logistics" | "commerce"): boolean {
  const v = (process.env.TCGEN_HARNESS || "off").toLowerCase();
  if (v === "off" || v === "false" || v === "legacy") return false;
  if (v === "all" || v === "on" || v === "true") return true;
  return v === bu;
}

export function assembleJobPrompt(job: TcGenJob): { prompt: string; model: string; log: string } {
  const isDesign = job.kind === "design";
  const model = (job.claude_model && job.claude_model.trim()) || DEFAULT_MODEL;

  // ── 하네스 모드: 신규 TC 잡(설계 아님 + 개선 아님)은 하네스 오케스트레이터로 실행 ──
  // 워커가 __HARNESS__ 프롬프트를 감지해 cwd=하네스레포에서 claude -p 실행 → 산출 xlsx → CSV 어댑터.
  // 개선(refine)/설계(design)/멀티분할(agent_group)은 기존 경량 경로 유지.
  // (하네스는 내부적으로 11에이전트를 돌리는 holistic 파이프라인 — 외부 멀티분할과 중복/충돌하므로 단일 잡만 하네스로.)
  if (!isDesign && !(job.parent_id && job.refine_instructions) && !job.agent_group_id) {
    const dom = getDomainById(job.domain);
    const bu: "logistics" | "commerce" = dom?.bu === "물류" ? "logistics" : "commerce";
    // per-job 엔진 선택 우선: 'harness'/'legacy' 명시 시 그대로, null 이면 env(TCGEN_HARNESS) 따름.
    const useHarness = job.engine === "harness" ? true : job.engine === "legacy" ? false : harnessBuEnabled(bu);
    if (useHarness) {
      const domainKw = dom?.label || job.domain;
      const jobPocs = parseJobPocs(job.pocs);
      const extra: string[] = [];
      if (job.qa_analysis && job.qa_analysis.trim()) extra.push(`## QA 설계 분석 (반영)\n${job.qa_analysis.trim()}`);
      if (job.focus && job.focus.trim()) extra.push(`## 집중 검증 포인트(focus)\n${job.focus.trim()}`);
      if (jobPocs.length) extra.push(`## 대상 POC/시스템\n${jobPocs.join(", ")}`);
      const specBody = (job.spec_text ?? "").trim() || "(기획서 본문 미입력 — 도메인/POC 기준으로 진행)";
      const fullSpec = [specBody, ...extra].join("\n\n");
      const prompt = `__HARNESS__ bu=${bu} domain=${domainKw}\n<<<SPEC\n${fullSpec}\nSPEC>>>`;
      const log =
        `[조립] 하네스 모드 (${bu === "commerce" ? "커머스" : "물류"} 오케스트레이터) — 도메인 "${domainKw}"` +
        `${job.qa_analysis ? " · QA설계 반영" : ""}${jobPocs.length ? ` · POC ${jobPocs.length}종(${jobPocs.join(",")})` : ""}` +
        ` (spec ${fullSpec.length.toLocaleString()}자)\n[대기] 워커 claim 대기 — 워커가 하네스 실행 (model=${model})\n`;
      return { prompt, model, log };
    }
  }

  let prompt: string, skillFiles: string[], policyFiles: string[], tcFolder: string;
  let log = "";
  if (isDesign) {
    let refine: { previousAnalysis: string; instructions: string } | undefined;
    if (job.parent_id && job.refine_instructions) {
      const parent = getTcGenJob(job.parent_id);
      refine = { previousAnalysis: parent?.qa_analysis || "(이전 분석 없음)", instructions: job.refine_instructions };
      log += `[개선] 원본 설계 ${job.parent_id} + 피드백 반영\n`;
    }
    ({ prompt, skillFiles, policyFiles, tcFolder } = assembleDesignPrompt(job.domain, job.spec_text ?? "", job.focus, refine));
    log += `[조립] QA설계 — tc-skills/${tcFolder} ${skillFiles.length}개 + policies/${tcFolder} ${policyFiles.length}개 (프롬프트 ${prompt.length.toLocaleString()}자)\n`;
  } else {
    let refine: { previousCsv: string; instructions: string } | undefined;
    if (job.parent_id && job.refine_instructions) {
      const parent = getTcGenJob(job.parent_id);
      let prevCsv = "";
      const parentOutputPath = resolveTcOutputPath(parent?.output_path);
      if (parentOutputPath && fs.existsSync(parentOutputPath)) {
        try { prevCsv = fs.readFileSync(parentOutputPath, "utf-8").replace(/^﻿/, ""); } catch { /* ignore */ }
      }
      refine = { previousCsv: prevCsv || "(이전 CSV 없음)", instructions: job.refine_instructions };
      log += `[개선] 원본 ${job.parent_id} 의 이전 CSV + 피드백 반영\n`;
    }
    const jobPocs = parseJobPocs(job.pocs);
    ({ prompt, skillFiles, policyFiles, tcFolder } = assembleTcGenPrompt(job.domain, job.spec_text ?? "", job.focus, refine, job.qa_analysis, jobPocs));
    log += `[조립] TC생성 — tc-skills/${tcFolder} ${skillFiles.length}개 + policies/${tcFolder} ${policyFiles.length}개${job.qa_analysis ? " · QA설계 반영" : ""}${jobPocs.length ? ` · 대상 POC ${jobPocs.length}종(${jobPocs.join(",")})` : ""} (프롬프트 ${prompt.length.toLocaleString()}자)\n`;
  }
  // 주입 순서 가시화 — 스킬은 들어간 순서대로(맨 앞=BU 기본 스킬 ⭐), 정책은 파일명.
  const skillOrder = skillFiles.map((f, i) => `${i + 1}) ${i === 0 && f.includes("_공통") ? "⭐기본 " : ""}${f}`).join("  →  ");
  log += `[스킬 순서] ${skillFiles.length ? skillOrder : "(없음)"}\n`;
  log += `[정책 파일] ${policyFiles.length ? policyFiles.join(", ") : "(없음)"}\n`;
  if (policyFiles.length === 0) log += `[경고] 마스터 정책 없음 (기획서에만 의존)\n`;
  log += `[대기] 워커 claim 대기 중 (model=${model})\n`;
  return { prompt, model, log };
}

// ============== 워커 claim / 완료 처리 ==============

export interface ClaimedTcGenJob { id: string; kind: TcGenKind; prompt: string; model: string; }

// 가장 오래된 pending tc_gen 잡을 워커에 배정 (pending→running). 스테일 running 은 먼저 reclaim.
// better-sqlite3 동기 단일스레드 + Next 서버 단일 프로세스라 SELECT→UPDATE 가 실질 원자적.
export function claimNextTcGenJob(worker: string): ClaimedTcGenJob | null {
  // 워커 사망 추정 → pending 으로 되돌려 재배정. 스테일 임계: 하네스 잡(오케스트레이터, 수십 분 소요)은 90분, 그 외(단순 스킬)는 15분.
  db.prepare(`
    UPDATE tc_gen_jobs SET status='pending', worker_name=NULL, assigned_at=NULL, started_at=NULL
    WHERE status='running' AND assigned_at IS NOT NULL AND (
      (prompt LIKE '__HARNESS__%' AND assigned_at < datetime('now','-90 minutes'))
      OR (COALESCE(prompt,'') NOT LIKE '__HARNESS__%' AND assigned_at < datetime('now','-15 minutes'))
    )
  `).run();
  // 지정 워커(target_worker)에 핀된 잡은 그 워커만, 미지정(null)은 아무 워커나 가져감.
  const row = db.prepare(`
    SELECT id, kind, prompt, model, claude_model FROM tc_gen_jobs
    WHERE status='pending' AND prompt IS NOT NULL AND prompt != ''
      AND (target_worker = ? OR target_worker IS NULL)
    ORDER BY created_at ASC LIMIT 1
  `).get(worker) as { id: string; kind: TcGenKind; prompt: string; model: string | null; claude_model: string | null } | undefined;
  if (!row) return null;
  const now = nowStr();
  const r = db.prepare(`
    UPDATE tc_gen_jobs SET status='running', worker_name=?, assigned_at=?, started_at=?
    WHERE id=? AND status='pending'
  `).run(worker, now, now, row.id);
  if (r.changes === 0) return null;  // 경합 — 다른 워커가 먼저 가져감
  appendLog(row.id, `[claim] 워커 ${worker} 실행 시작`);
  return { id: row.id, kind: row.kind, prompt: row.prompt, model: (row.model || row.claude_model || DEFAULT_MODEL) };
}

// 워커가 돌린 claude 출력(raw)을 받아 산출물로 마무리. (CSV 추출/정규화/파일저장 또는 분석 저장)
export function finalizeTcGenOutput(id: string, rawOutput: string, ok: boolean, failReason?: string, harnessReport?: string): void {
  const job = getTcGenJob(id);
  if (!job) return;
  // started_at 은 nowStr()=UTC wall-clock 문자열 → "Z" 붙여 UTC 로 파싱 (안 그러면 TZ offset 만큼 틀림)
  const startMs = job.started_at ? new Date(job.started_at.replace(" ", "T") + "Z").getTime() : Date.now();
  const finish = (patch: Record<string, unknown>) => {
    patchJob(id, { ...patch, finished_at: nowStr(), duration_sec: Math.max(0, Math.round((Date.now() - startMs) / 1000)) });
  };
  if (!ok) {
    finish({ status: "failed", error_message: failReason || "워커 claude 실패" });
    appendLog(id, `[실패] ${failReason || "워커 claude 실패"}`);
    return;
  }

  if (job.kind === "design") {
    const analysis = rawOutput.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "").trim();
    if (!analysis) {
      appendLog(id, `[실패] 분석 출력이 비어있음 (출력 ${rawOutput.length}자)`);
      finish({ status: "failed", error_message: "QA 설계 분석 출력 실패 (빈 출력)" });
      return;
    }
    appendLog(id, `[완료] QA 설계 분석 ${analysis.length.toLocaleString()}자`);
    finish({ status: "succeeded", qa_analysis: analysis, error_message: null });
    return;
  }

  // tc
  let finalCsv: string;
  const isHarness = (job.prompt ?? "").startsWith("__HARNESS__");
  if (isHarness) {
    // 하네스: 어댑터가 이미 완성 CSV를 만들어 회신(LLM prose 없음). extractCsv/normalizeCsvColumns 는
    // 커머스 21열 가정이라 물류 13열 사인오프 양식을 거부/왜곡 → 우회하고 본문 그대로 신뢰(코드펜스+BOM만 제거).
    finalCsv = rawOutput.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "").replace(/^﻿/, "").trim();
    if (!finalCsv || splitCsvLines(finalCsv).length < 2) {
      appendLog(id, `[실패] 하네스 CSV 비어있음 (출력 ${rawOutput.length}자)`);
      finish({ status: "failed", error_message: "하네스 CSV 비어있음" });
      return;
    }
  } else {
    const csv = extractCsv(rawOutput);
    if (!csv) {
      const sample = rawOutput.trim().slice(0, 600).replace(/\n/g, " ⏎ ");
      appendLog(id, `[실패] CSV 헤더 미검출 (출력 ${rawOutput.length}자)\n[출력 일부] ${sample || "(빈 출력)"}`);
      finish({ status: "failed", error_message: "CSV 형식 출력 실패 (헤더 미검출)" });
      return;
    }
    const norm = normalizeCsvColumns(csv);
    if (norm.repaired > 0 || norm.broken > 0) {
      appendLog(id, `[정규화] 컬럼 밀림 행 복구 ${norm.repaired}개${norm.broken ? ` · 미복구 ${norm.broken}개(원본 유지)` : ""}`);
    }
    finalCsv = norm.csv;
  }
  const dir = path.join(OUTPUT_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const base = (job.task_name || `${job.domain}_TC`).replace(/[\/\\:\0]/g, "_").slice(0, 80);
  const filename = `${base}.csv`;
  const outPath = path.join(dir, filename);
  const review = reviewTcCsvQuality(finalCsv, { domain: job.domain, pocs: parseJobPocs(job.pocs), focus: job.focus, designAnalysis: job.qa_analysis });
  const reviewPath = path.join(dir, "quality-review.json");
  fs.writeFileSync(outPath, "﻿" + finalCsv, "utf-8");
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2), "utf-8");
  const count = Math.max(0, splitCsvLines(finalCsv).length - 1);
  appendLog(
    id,
    `[품질리뷰] ${review.grade} (${review.score}/100) · error ${review.issueCounts.error} · warn ${review.issueCounts.warn}` +
      (review.issues.length ? `\n[품질리뷰 주요이슈] ${review.issues.slice(0, 5).map((i) => `${i.code}${i.rows?.length ? `#${i.rows.join("/")}` : ""}`).join(", ")}` : "")
  );
  appendLog(id, `[완료] TC ${count}건 생성 → ${filename}`);
  finish({ status: "succeeded", output_path: outPath, output_filename: filename, tc_count: count, error_message: null, harness_report: harnessReport ?? null });
  const auto = parseAutoQualityRefine(job.refine_instructions);
  if (auto && review.score < auto.threshold && auto.iteration < auto.max) {
    const parentReview = job.parent_id ? readTcQualityReview(getTcGenJob(job.parent_id)?.output_path ?? null) : null;
    if (parentReview && review.score <= parentReview.score) {
      appendLog(id, `[자동개선] 점수 개선 없음(${parentReview.score} → ${review.score}) · 다음 라운드 중단`);
      return;
    }
    try {
      const child = createQualityRefineJob(id, {
        iteration: auto.iteration + 1,
        max: auto.max,
        threshold: auto.threshold,
      });
      appendLog(id, `[자동개선] 품질 ${review.score}/${auto.threshold} 미달 → 다음 개선 잡 생성: ${child.id} (${auto.iteration + 1}/${auto.max})`);
    } catch (e) {
      appendLog(id, `[자동개선] 다음 개선 잡 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
