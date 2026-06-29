import { NextRequest } from "next/server";
import { createJob, deleteAllJobs, addLog, type TcFilter } from "@/lib/jobs";
import { autoSyncFunctional } from "@/lib/drive-sync";
import { buildFunctionalContext } from "@/lib/functional-prompt";
import type { Platform, RunMode } from "@/lib/db";
import { getDomainById } from "@/lib/domains";
import { normalizePoc, platformForPoc } from "@/lib/pocs";
import { splitCsvLines, parseCsvRow } from "@/lib/csv-parser";
import { getGroupAgentsIfMulti, type Agent } from "@/lib/agents";
import { getBuiltinWorkerName, getWorker } from "@/lib/workers";
import { planAgentChunks } from "@/lib/agent-split";
import { extractPdfText, fetchSpecUrlAsText, fetchMultipleSpecUrls } from "@/lib/spec-extractor";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

// CSV 를 시트분류(POC) 기준으로 필터 — 헤더 + 해당 POC 행만 남긴 CSV + 건수.
// 원본 줄 텍스트를 그대로 유지(따옴표/줄바꿈 보존). 시트분류 컬럼이 없으면 원본 유지.
function filterCsvByPoc(text: string, poc: string): { csv: string; count: number; hasPocCol: boolean } {
  const clean = text.replace(/^﻿/, "");
  const lines = splitCsvLines(clean);
  if (lines.length < 2) return { csv: clean, count: 0, hasPocCol: false };
  const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
  const iPoc = header.findIndex((h) => h === "시트분류" || h === "poc" || h === "sheet");
  if (iPoc < 0) return { csv: clean, count: Math.max(0, lines.length - 1), hasPocCol: false };
  const kept: string[] = [lines[0]];
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    if (!cells.some((x) => x.trim())) continue;
    if (normalizePoc(cells[iPoc] ?? "") === poc) { kept.push(lines[i]); count++; }
  }
  return { csv: kept.join("\n"), count, hasPocCol: true };
}

// 모든 잡 삭제. 기본은 종료된 잡만, ?includeActive=true 면 running/pending 도 포함.
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const includeActive = url.searchParams.get("includeActive") === "true";
    const { deletedCount } = deleteAllJobs({ includeActive });
    return Response.json({ ok: true, deletedCount });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

const QA_ENVS = new Set(["stg","qa1","qa2","qa3","qa4","qa5","qa6","qa7","qa8","qa9","qa10","qa11","qa12","qa13","qa14","qa15"]);

function buildDataAgentBlock(agents: Agent[]): string {
  if (agents.length === 0) return "";
  const lines = agents.map((agent, i) => {
    const instruction = agent.instruction.trim()
      ? `\n[${agent.nickname} 전용 지시]\n${agent.instruction.trim()}`
      : "";
    return `${i + 1}. ${agent.nickname} — 테스트 데이터 생성/검증 담당${instruction}`;
  });
  return [
    "🧪 테스트데이터 에이전트 핸드오프",
    "수행 중 TC 진행에 필요한 데이터가 없거나 상태가 맞지 않으면 아래 테스트데이터 에이전트에게 요청한 뒤, 생성/검증된 dataContext를 받아서 같은 TC를 이어서 수행하세요.",
    "사전 일괄 생성은 하지 말고, 막힌 TC에 필요한 최소 데이터만 요청하세요.",
    "3P OpenAPI 콘솔은 무조건 제외 대상입니다. 3P 키워드는 상품등록 데이터 맥락에서만 해석하세요.",
    lines.join("\n\n"),
  ].join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    // v1.2: 다중 파일 우선, 단일 파일은 호환 폴백
    const filesMulti = fd.getAll("tc_files").filter((v) => v instanceof File && (v as File).size > 0) as File[];
    const fileSingle = fd.get("tc_file") as File | null;
    const files: File[] = filesMulti.length > 0 ? filesMulti : (fileSingle && fileSingle.size > 0 ? [fileSingle] : []);
    const file = files[0] ?? null;
    const domain = String(fd.get("domain") ?? "");
    // POC 모드: poc 지정 시 이 잡은 그 POC 행만 + 플랫폼 자동 결정.
    const poc = normalizePoc(String(fd.get("poc") ?? "").trim());
    const platformRaw = String(fd.get("platform") ?? "web") as Platform;
    const platform: Platform = poc ? platformForPoc(poc) : platformRaw;
    const qaEnv = String(fd.get("qa_env") ?? "stg").trim();
    const taskNameRaw = String(fd.get("task_name") ?? "").trim() || null;
    const taskName = poc ? `${taskNameRaw ? taskNameRaw + " " : ""}[${poc}]` : taskNameRaw;
    const epicKey = String(fd.get("epic_key") ?? "").trim() || null;
    const requestedBy = String(fd.get("requested_by") ?? "").trim() || null;
    const mode = String(fd.get("mode") ?? "mock") as RunMode;
    const filterPriority = String(fd.get("filter_priority") ?? "all");
    const filterRangeStart = fd.get("filter_range_start");
    const filterRangeEnd = fd.get("filter_range_end");
    const analyzerSummary = String(fd.get("analyzer_summary") ?? "");
    const additionalInstructions = String(fd.get("additional_instructions") ?? "").trim() || null;
    // v1.0 Phase 2: 어느 워커가 처리할지 (없으면 종관님 PC 의 기본 워커가 가져감 = Phase 1 호환)
    const workerName = String(fd.get("worker_name") ?? "").trim() || getBuiltinWorkerName();
    const claudeModel = String(fd.get("claude_model") ?? "").trim() || null;
    // Phase 2 멀티 분할 수행 — 워커의 exec 그룹이 multi 일 때 폼이 켜서 보냄. POC 모드와는 배타.
    const multiAgent = String(fd.get("multi_agent") ?? "") === "1";

    // v1.1: 기획 문서 (선택). v1.7 다중 URL 지원 — 줄바꿈/콤마 구분.
    const specUrlRaw = String(fd.get("spec_url") ?? "").trim();
    const specUrls = specUrlRaw ? specUrlRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : [];
    const specUrl = specUrls.length > 0 ? specUrls.join("\n") : null;  // DB 저장: 줄바꿈 join
    const specFile = fd.get("spec_pdf") as File | null;
    let specFilename: string | null = null;
    let specText: string | null = null;
    try {
      if (specFile && specFile.size > 0) {
        specFilename = specFile.name;
        const buf = Buffer.from(await specFile.arrayBuffer());
        specText = await extractPdfText(buf).catch(() => "");
        const specDir = path.join(process.cwd(), "uploads", "specs");
        fs.mkdirSync(specDir, { recursive: true });
        const safe = specFile.name.replace(/[^\w.\-가-힣\s]/g, "_");
        fs.writeFileSync(path.join(specDir, `${Date.now()}_${safe}`), buf);
      } else if (specUrls.length === 1) {
        specText = await fetchSpecUrlAsText(specUrls[0], requestedBy);
      } else if (specUrls.length > 1) {
        specText = await fetchMultipleSpecUrls(specUrls, requestedBy);
      }
    } catch (e) {
      console.warn("spec 추출 실패:", e);
    }

    if (!file) return Response.json({ error: "TC 파일을 선택해 주세요" }, { status: 400 });
    if (!domain || !getDomainById(domain)) return Response.json({ error: "유효한 도메인을 선택해 주세요" }, { status: 400 });
    if (!["web", "mweb", "app"].includes(platform)) return Response.json({ error: "플랫폼을 선택해 주세요" }, { status: 400 });
    if (!qaEnv) return Response.json({ error: "테스트 환경 URL을 입력해 주세요" }, { status: 400 });
    if (!/^https?:\/\/\S{1,500}$/i.test(qaEnv)) return Response.json({ error: "유효한 URL을 입력해 주세요 (https://...)" }, { status: 400 });
    if (!requestedBy) return Response.json({ error: "실행자 입력은 필수입니다" }, { status: 400 });

    const uploadDir = path.join(process.cwd(), "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const stamp = Date.now();
    const tc_paths: string[] = [];
    const tc_filenames: string[] = [];
    const fileTexts: { name: string; text: string }[] = []; // 멀티 분할용 — 저장된 내용 그대로 캡처
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const safe = f.name.replace(/[^\w.\-가-힣\s]/g, "_");
      const buf = Buffer.from(await f.arrayBuffer());
      let outBuf = buf;
      let fname = f.name;
      if (poc) {
        const { csv, count, hasPocCol } = filterCsvByPoc(buf.toString("utf-8"), poc);
        if (hasPocCol && count === 0) continue; // 이 파일엔 해당 POC 행 없음 → 건너뜀
        if (hasPocCol) { outBuf = Buffer.from("﻿" + csv.replace(/^﻿/, ""), "utf-8"); fname = `[${poc}] ${f.name}`; }
      }
      const saved = path.join(uploadDir, `${stamp}_${i}_${safe}`);
      fs.writeFileSync(saved, outBuf);
      tc_paths.push(saved);
      tc_filenames.push(fname);
      fileTexts.push({ name: fname, text: outBuf.toString("utf-8") });
    }
    if (poc && tc_paths.length === 0) {
      return Response.json({ error: `'${poc}' 에 해당하는 TC가 없습니다` }, { status: 400 });
    }
    const savedPath = tc_paths[0];

    const tc_filter: TcFilter | null = ((): TcFilter | null => {
      const f: TcFilter = {};
      if (filterPriority === "P1" || filterPriority === "P1+P2") f.priority = filterPriority;
      if (filterRangeStart && filterRangeEnd) {
        f.range = [Number(filterRangeStart), Number(filterRangeEnd)];
      }
      return Object.keys(f).length > 0 ? f : null;
    })();

    // 생성 직전 자동 동기화 — 기능테스트 프롬프트 번들 최신화(실패 시 로컬 폴백, POC 버스트는 쿨다운으로 1회).
    const sync = await autoSyncFunctional();
    // 동기화된 로컬에서 base/도메인/knowledge/CLAUDE 내용을 inline 조립 → 워커가 로컬 파일 대신 사용(외부 워커도 Drive 최신본).
    // knowledge 는 과제명 관련 파일로 좁힘(매칭 없으면 도메인 폴더 전체).
    const ctx = buildFunctionalContext(domain, platform, taskName || "");
    const dataAgentBlock = buildDataAgentBlock(getGroupAgentsIfMulti(workerName, "data"));

    // ── Phase 2 멀티 분할 수행 ──────────────────────────────────────────────
    // 선택 워커의 exec 그룹이 multi(에이전트 2명 이상)면, 업로드한 TC를 N청크로 쪼개
    // 같은 chunk_group_id 잡 N개를 그 워커에 생성. 각 청크에 담당 에이전트 지시 주입.
    // POC 모드면 POC로 필터된 행(fileTexts)을 다시 N청크로 분할(POC×에이전트). 에이전트<2면 단일 수행으로 폴백.
    if (multiAgent && workerName && fileTexts.length > 0) {
      const execAgents = getGroupAgentsIfMulti(workerName, "exec");
      if (execAgents.length >= 2) {
        const plans = planAgentChunks(fileTexts, execAgents.length);
        if (plans.length >= 2) {
          const groupId = `cg_${stamp.toString(36)}_${randomUUID().slice(0, 8)}`;
          const ids: string[] = [];
          // 진짜 병렬 가드: 워커 동시 슬롯보다 청크가 많으면 일부는 순차 대기 → 잡 로그로 경고.
          const wSlots = getWorker(workerName)?.max_concurrent ?? null;
          const serial = wSlots != null && plans.length > wSlots;
          for (let i = 0; i < plans.length; i++) {
            const plan = plans[i];
            const agent = execAgents[i];
            const cpaths: string[] = [];
            const cnames: string[] = [];
            for (let k = 0; k < plan.files.length; k++) {
              const pf = plan.files[k];
              const safe = pf.name.replace(/[^\w.\-가-힣\s]/g, "_");
              const saved = path.join(uploadDir, `${stamp}_cg${i}_${k}_${safe}`);
              fs.writeFileSync(saved, "﻿" + pf.text.replace(/^﻿/, ""));
              cpaths.push(saved);
              cnames.push(pf.name);
            }
            const agentInstr = (agent.instruction || "").trim();
            const instrBlock =
              `🎮 담당 에이전트: ${agent.nickname} — 멀티 분할 수행 (${i + 1}/${plans.length})\n` +
              `이 잡은 전체 TC의 한 청크만 담당합니다. 첨부 CSV에 본인 몫만 들어 있으니 그 CSV의 TC만 수행하세요 (다른 청크와 중복 실행 금지).` +
              (agentInstr ? `\n\n[${agent.nickname} 전용 지시]\n${agentInstr}` : "");
            const merged = [additionalInstructions, instrBlock, dataAgentBlock].filter(Boolean).join("\n\n");
            const chunkJob = createJob({
              domain, platform, qa_env: qaEnv,
              task_name: `${taskName ? taskName + " " : ""}[${agent.nickname}]`,
              epic_key: epicKey, tc_filename: cnames[0], tc_path: cpaths[0],
              requested_by: requestedBy, mode, tc_filter: null,
              analyzer_summary: analyzerSummary || null,
              additional_instructions: merged,
              worker_name: workerName, claude_model: claudeModel,
              spec_url: specUrl, spec_filename: specFilename, spec_text: specText,
              tc_paths: cpaths, tc_filenames: cnames,
              inlined_context: ctx.text,
              chunk_group_id: groupId, chunk_index: i, chunk_total: plans.length,
            });
            addLog(chunkJob.id, "info", `[멀티 분할] ${agent.nickname} 청크 ${i + 1}/${plans.length} · 약 ${plan.count}건`);
            addLog(chunkJob.id, "info", `[Drive 자동 동기화] ${sync.note}`);
            if (serial) addLog(chunkJob.id, "warn", `[동시성] 이 워커 동시 슬롯 ${wSlots}개 < 청크 ${plans.length}개 → 일부는 순차 대기. 완전 병렬은 WORKER_MAX_CONCURRENT=${plans.length} 이상으로 워커 재시작.`);
            ids.push(chunkJob.id);
          }
          return Response.json({ ok: true, group_id: groupId, ids, chunk_total: plans.length, slots: wSlots, parallel: wSlots == null ? null : !serial });
        }
      }
      // 에이전트<2 또는 청크<2 → 단일 수행으로 폴백 (아래 createJob 계속)
    }

    const job = createJob({
      domain, platform, qa_env: qaEnv, task_name: taskName,
      epic_key: epicKey, tc_filename: tc_filenames[0] ?? file.name, tc_path: savedPath,
      requested_by: requestedBy, mode, tc_filter,
      analyzer_summary: analyzerSummary || null,
      additional_instructions: [additionalInstructions, dataAgentBlock].filter(Boolean).join("\n\n") || null,
      worker_name: workerName,
      claude_model: claudeModel,
      spec_url: specUrl,
      spec_filename: specFilename,
      spec_text: specText,
      tc_paths,
      tc_filenames,
      inlined_context: ctx.text,
    });
    addLog(job.id, "info", `[Drive 자동 동기화] ${sync.note}`);
    addLog(job.id, "info", `[기능테스트 컨텍스트] ${ctx.note}`);
    return Response.json({ ok: true, id: job.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
