import { NextRequest } from "next/server";
import { createJob, addLog } from "@/lib/jobs";
import { autoSyncFunctional } from "@/lib/drive-sync";
import { buildFunctionalContext } from "@/lib/functional-prompt";
import type { Platform, RunMode } from "@/lib/db";
import { getDomainById } from "@/lib/domains";
import { getBuiltinWorkerName } from "@/lib/workers";
import { extractPdfText, fetchSpecUrlAsText, fetchMultipleSpecUrls } from "@/lib/spec-extractor";
import path from "node:path";
import fs from "node:fs";

export const dynamic = "force-dynamic";

const QA_ENVS = new Set(["stg","qa1","qa2","qa3","qa4","qa5","qa6","qa7","qa8","qa9","qa10","qa11","qa12","qa13","qa14","qa15"]);

// 애드혹 테스트 잡 생성 — TC 파일 없이 기획서 + 자유 텍스트만으로
export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const domain = String(fd.get("domain") ?? "");
    const platform = String(fd.get("platform") ?? "web") as Platform;
    const qaEnv = String(fd.get("qa_env") ?? "stg").trim();
    const taskName = String(fd.get("task_name") ?? "").trim() || null;
    const requestedBy = String(fd.get("requested_by") ?? "").trim() || null;
    const mode = String(fd.get("mode") ?? "mock") as RunMode;
    const adhocFocus = String(fd.get("adhoc_focus") ?? "").trim() || null;
    const additionalInstructions = String(fd.get("additional_instructions") ?? "").trim() || null;
    const workerName = String(fd.get("worker_name") ?? "").trim() || getBuiltinWorkerName();
    const claudeModel = String(fd.get("claude_model") ?? "").trim() || null;

    // 기획 문서 (직접 붙여넣기 > PDF > URL fetch 우선순위). v1.7 다중 URL 지원.
    const specUrlRaw = String(fd.get("spec_url") ?? "").trim();
    const specUrls = specUrlRaw ? specUrlRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : [];
    const specUrl = specUrls.length > 0 ? specUrls.join("\n") : null;
    const specTextManual = String(fd.get("spec_text_manual") ?? "").trim() || null;
    const specFile = fd.get("spec_pdf") as File | null;
    let specFilename: string | null = null;
    let specText: string | null = null;
    try {
      if (specTextManual) {
        specText = specTextManual.length > 30000
          ? specTextManual.slice(0, 30000) + `\n\n…(이하 생략: 원문 ${specTextManual.length}자 중 30000자만 발췌)`
          : specTextManual;
        specFilename = "(직접 입력)";
      } else if (specFile && specFile.size > 0) {
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

    // 유효성 검사
    if (!domain || !getDomainById(domain)) {
      return Response.json({ error: "유효한 도메인을 선택해 주세요" }, { status: 400 });
    }
    if (!["web", "mweb", "app"].includes(platform)) {
      return Response.json({ error: "플랫폼을 선택해 주세요" }, { status: 400 });
    }
    if (!qaEnv) {
      return Response.json({ error: "테스트 환경 URL을 입력해 주세요" }, { status: 400 });
    }
    if (!/^https?:\/\/\S{1,500}$/i.test(qaEnv)) {
      return Response.json({ error: "유효한 URL을 입력해 주세요 (https://...)" }, { status: 400 });
    }
    if (!requestedBy) {
      return Response.json({ error: "실행자 입력은 필수입니다" }, { status: 400 });
    }
    if (!specUrl && !specFile && !adhocFocus) {
      return Response.json({
        error: "기획서(URL/PDF) 또는 포커스 텍스트 중 최소 하나는 입력해 주세요",
      }, { status: 400 });
    }

    // 생성 직전 자동 동기화 — 기능테스트 프롬프트 번들 최신화(실패 시 로컬 폴백).
    const sync = await autoSyncFunctional();
    // 동기화된 로컬에서 inline 컨텍스트 조립 → 워커가 로컬 파일 대신 사용(외부 워커도 Drive 최신본).
    // knowledge 는 과제명 관련 파일로 좁힘(매칭 없으면 도메인 폴더 전체).
    const ctx = buildFunctionalContext(domain, platform, taskName || "");

    const job = createJob({
      domain,
      platform,
      qa_env: qaEnv,
      task_name: taskName,
      epic_key: null,
      // TC 없으므로 placeholder
      tc_filename: "(애드혹)",
      tc_path: "(애드혹)",
      requested_by: requestedBy,
      mode,
      additional_instructions: additionalInstructions,
      worker_name: workerName,
      claude_model: claudeModel,
      spec_url: specUrl,
      spec_filename: specFilename,
      spec_text: specText,
      job_type: "adhoc",
      adhoc_focus: adhocFocus,
      inlined_context: ctx.text,
    });
    addLog(job.id, "info", `[Drive 자동 동기화] ${sync.note}`);
    addLog(job.id, "info", `[기능테스트 컨텍스트] ${ctx.note}`);
    return Response.json({ ok: true, id: job.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
