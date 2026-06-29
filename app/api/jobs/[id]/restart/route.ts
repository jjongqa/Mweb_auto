import { NextRequest } from "next/server";
import { getJob, createJob, type TcFilter } from "@/lib/jobs";
import fs from "node:fs";

export const dynamic = "force-dynamic";

/**
 * 취소/실패한 Job 을 같은 설정으로 처음부터 다시 시작.
 * 원본 CSV 파일을 그대로 사용 (uploads/ 폴더에 남아있어야 함).
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const source = getJob(id);
    if (!source) return Response.json({ error: "원본 Job 없음" }, { status: 404 });

    // 안전 검사 — 실행 중인 Job 재시작 금지
    if (source.status === "running" || source.status === "pending") {
      return Response.json({
        error: `이 Job 은 아직 ${source.status === "running" ? "실행 중" : "대기 중"}입니다. 먼저 중단해 주세요.`,
      }, { status: 400 });
    }

    // 애드혹 잡은 TC 파일 자체가 없음 — tc_path 검사 스킵
    const isAdhoc = source.job_type === "adhoc";
    if (!isAdhoc && !fs.existsSync(source.tc_path)) {
      return Response.json({
        error: `원본 CSV 파일을 찾을 수 없습니다: ${source.tc_path}\nuploads/ 폴더에서 삭제됐을 수 있어요. 새 실행으로 다시 업로드해 주세요.`,
      }, { status: 400 });
    }

    // TC 필터 복원
    const tc_filter: TcFilter | null = source.tc_filter ? JSON.parse(source.tc_filter) : null;

    // 새 Job 생성 — 모든 설정 그대로 상속 (탐색형은 spec/focus/job_type 도 함께)
    // parent_job_id: 원본의 부모가 있으면 같은 루트 유지, 없으면 source 자체를 부모로
    const newJob = createJob({
      domain: source.domain,
      platform: source.platform,
      qa_env: source.qa_env,
      task_name: source.task_name ? `${source.task_name} (재시작)` : null,
      epic_key: source.epic_key,
      tc_filename: source.tc_filename,
      tc_path: source.tc_path,
      requested_by: source.requested_by,
      mode: source.mode,
      tc_filter,
      analyzer_summary: source.analyzer_summary,
      additional_instructions: source.additional_instructions,
      parent_job_id: source.parent_job_id || source.id,
      // v1.1 기획서
      spec_url: source.spec_url,
      spec_filename: source.spec_filename,
      spec_text: source.spec_text,
      // v1.3/1.4 탐색형
      job_type: source.job_type,
      adhoc_focus: source.adhoc_focus,
      // v1.7 워커 상속 — 외부 워커로 만든 잡 재시작 시 같은 외부 워커가 처리
      worker_name: source.worker_name,
      // v1.7.5 모델 상속
      claude_model: source.claude_model,
    });

    return Response.json({ ok: true, newJobId: newJob.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
