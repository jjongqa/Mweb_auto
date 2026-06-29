import { NextRequest } from "next/server";
import { createTcGenJob, createTcGenGroup } from "@/lib/tc-gen";
import { getGroupAgentsIfMulti } from "@/lib/agents";
import { autoSyncDomain, autoSyncStdTcMaster } from "@/lib/drive-sync";
import { getDomainById } from "@/lib/domains";
import { getBuiltinWorkerName } from "@/lib/workers";
import { sanitizePocs } from "@/lib/pocs";
import { fetchMultipleSpecUrls, extractPdfText } from "@/lib/spec-extractor";

export const dynamic = "force-dynamic";

// POST /api/tc-gen — multipart: domain, spec_url?, spec_pdf?, focus?, requested_by?, task_name?, claude_model?
// 기획서를 추출해 TC 생성 잡 생성 + 백그라운드 시작.
export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const domain = String(fd.get("domain") ?? "").trim();
    if (!domain || !getDomainById(domain)) {
      return Response.json({ error: "유효한 도메인 필수" }, { status: 400 });
    }
    const specUrl = String(fd.get("spec_url") ?? "").trim();
    const focus = String(fd.get("focus") ?? "").trim();
    const requestedBy = String(fd.get("requested_by") ?? "").trim() || null;
    const taskName = String(fd.get("task_name") ?? "").trim() || null;
    const claudeModel = String(fd.get("claude_model") ?? "").trim() || null;
    const targetWorker = String(fd.get("worker_name") ?? "").trim() || getBuiltinWorkerName();
    const engineRaw = String(fd.get("engine") ?? "").trim();
    const engine = engineRaw === "harness" || engineRaw === "legacy" ? engineRaw : null; // null=env(TCGEN_HARNESS) 따름
    const specPdf = fd.get("spec_pdf");

    let pocs: string[] = [];
    try { pocs = sanitizePocs(JSON.parse(String(fd.get("pocs") ?? "[]"))); } catch { pocs = []; }
    if (pocs.length === 0) {
      return Response.json({ error: "대상 POC(시트분류)를 1개 이상 선택해 주세요" }, { status: 400 });
    }

    if (!specUrl && !(specPdf instanceof File) && !focus) {
      return Response.json({ error: "기획서(URL/PDF) 또는 포커스 중 최소 하나 필요" }, { status: 400 });
    }

    // 기획서 본문 추출 (URL + PDF 합침)
    const parts: string[] = [];
    let specFilename: string | null = null;
    if (specUrl) {
      const urls = specUrl.split(/[\n,]/).map((u) => u.trim()).filter(Boolean);
      try {
        const text = await fetchMultipleSpecUrls(urls, requestedBy);
        if (text) parts.push(text);
      } catch (e) {
        parts.push(`(URL 추출 실패: ${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (specPdf instanceof File) {
      specFilename = specPdf.name;
      try {
        const buf = Buffer.from(await specPdf.arrayBuffer());
        const text = await extractPdfText(buf);
        if (text) parts.push(`### [PDF] ${specPdf.name}\n\n${text}`);
      } catch (e) {
        parts.push(`(PDF 추출 실패: ${e instanceof Error ? e.message : String(e)})`);
      }
    }
    const specText = parts.join("\n\n---\n\n");

    // 생성 직전 자동 동기화 — 해당 도메인 스킬/정책 최신화(실패 시 로컬 폴백). 그 뒤 createTcGenJob 이 신선한 로컬로 조립.
    const sync = await autoSyncDomain(domain);
    // 하네스 엔진 머신이면 표준TC사전 Master(Drive)도 잡 실행 직전 최신화(하루1회 쿨다운, 다운그레이드 가드). 미설정/실패 시 무시.
    const masterSync = await autoSyncStdTcMaster();

    const base = {
      sync_note: sync.note + (masterSync.ok ? ` | 표준TC사전 Master: ${masterSync.note}` : ""),
      domain,
      task_name: taskName,
      requested_by: requestedBy,
      spec_url: specUrl || null,
      spec_filename: specFilename,
      spec_text: specText || null,
      focus: focus || null,
      claude_model: claudeModel,
      pocs,
      target_worker: targetWorker,
      engine,
    };

    // 작성 지시기반 병렬 — 선택 워커의 'write' 그룹이 multi(2명+)면 에이전트마다 잡 1개씩(각자 지시=focus) 생성 후 합본.
    const multiAgent = String(fd.get("multi_agent") ?? "") === "1";
    // 작성 분할(멀티)은 legacy 엔진에서만 — 하네스는 holistic이라 외부 분할이 우회/충돌(과거 버그 방지).
    if (engine === "legacy" && multiAgent && targetWorker) {
      const agents = getGroupAgentsIfMulti(targetWorker, "write");
      if (agents.length >= 2) {
        const { groupId, ids } = createTcGenGroup(base, agents.map((a) => ({ nickname: a.nickname, instruction: a.instruction })));
        return Response.json({ ok: true, group_id: groupId, ids });
      }
    }

    const job = createTcGenJob(base);
    return Response.json({ ok: true, id: job.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
