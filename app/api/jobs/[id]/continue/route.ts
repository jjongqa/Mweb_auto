import { NextRequest } from "next/server";
import { getJob, createJob, type TcFilter } from "@/lib/jobs";
import { db } from "@/lib/db";
import fs from "node:fs";

export const dynamic = "force-dynamic";

/**
 * 취소/실패한 Job 을 같은 설정 + 이전 진행 컨텍스트로 "이어서" 다시 시작.
 * "처음부터 다시" (restart) 와의 차이:
 *  - additional_instructions 에 이전 잡의 처리 통계 + result_dir 의 summary.csv 참고 지시 자동 첨가
 *  - task_name 에 "(이어서)" 표시
 *  - retry_type = 'continue' 메타 표시
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const source = getJob(id);
    if (!source) return Response.json({ error: "원본 Job 없음" }, { status: 404 });

    if (source.status === "running" || source.status === "pending") {
      return Response.json({
        error: `이 Job 은 아직 ${source.status === "running" ? "실행 중" : "대기 중"}입니다. 먼저 중단해 주세요.`,
      }, { status: 400 });
    }

    const isAdhoc = source.job_type === "adhoc";
    if (!isAdhoc && !fs.existsSync(source.tc_path)) {
      return Response.json({
        error: `원본 CSV 파일을 찾을 수 없습니다: ${source.tc_path}\nuploads/ 폴더에서 삭제됐을 수 있어요. 새 실행으로 다시 업로드해 주세요.`,
      }, { status: 400 });
    }

    const tc_filter: TcFilter | null = source.tc_filter ? JSON.parse(source.tc_filter) : null;
    const done = (source.passed || 0) + (source.failed || 0) + (source.blocked || 0);

    // 이전 잡 컨텍스트 — Claude 가 이어서 진행하도록 명시
    // 핵심: 새 잡의 result_dir/summary.csv 에 *이전 항목 + 새 항목 모두 누적* → 어드민 finalize 가 단일 폴더에서 정확히 집계
    const continueContext = [
      `## 🔁 이어서 진행 (continue) — 이전 잡 컨텍스트`,
      ``,
      `이 작업은 **이전 실행이 중단된 시점부터 이어서** 진행합니다.`,
      ``,
      `**이전 잡 ID**: ${source.id}`,
      `**이전 처리 결과**: PASS ${source.passed || 0} / FAIL ${source.failed || 0} / BLOCKED ${source.blocked || 0} (총 ${done}건)`,
      source.result_dir ? `**이전 결과 폴더**: ${source.result_dir}` : "",
      ``,
      `### 시작하기 전 반드시:`,
      source.result_dir
        ? `1. \`${source.result_dir}/summary.csv\` 파일을 먼저 \`Read\` 또는 \`Bash cat\` 으로 읽어서 이미 처리된 TC/시나리오 목록(No / Title / Result)을 파악할 것.`
        : "1. 이전 결과 폴더의 summary.csv 가 있다면 먼저 읽어서 *이미 처리된 항목*을 파악할 것.",
      `2. **이미 처리된 항목은 다시 실행하지 말 것** (PASS/FAIL/BLOCKED 모두). 같은 No/Title 중복 시 skip.`,
      `3. **미처리 항목부터 이어서 진행**.`,
      ``,
      `### ⚠️ 결과 파일 작성 규칙 (어드민 진행률 정확성에 중요)`,
      source.result_dir
        ? `- 새 잡의 \`summary.csv\` (어드민이 자동 생성한 result_dir 안에) 에는 **이전 잡의 ${done}건도 그대로 복사**해서 헤더 + 이전 항목 + 새 항목 순으로 한 파일에 모두 누적할 것.`
        : `- summary.csv 에 이전 처리분도 함께 포함해서 한 파일에 모두 작성.`,
      `- 그래야 어드민이 단일 폴더에서 전체 집계 정확히 계산. (이전 폴더는 보존, 신규 폴더에 누적 — 두 폴더 합치지 말 것)`,
      `- 진행 상황 표준출력은 **새로 처리한 시나리오만** \`TC-N PASS/FAIL/BLOCKED\` 형태로 출력 (이전 항목은 다시 출력 X — 중복 카운트 방지).`,
      ``,
      `> 진행률이 ${done}/N 부터 시작하도록 어드민에 이미 baseline 채워뒀음. 새 시나리오 처리할 때마다 누적됨.`,
    ].filter(Boolean).join("\n");

    const merged = source.additional_instructions
      ? `${continueContext}\n\n---\n\n## 원본 잡의 추가 지시사항\n${source.additional_instructions}`
      : continueContext;

    const newJob = createJob({
      domain: source.domain,
      platform: source.platform,
      qa_env: source.qa_env,
      task_name: source.task_name ? `${source.task_name} (이어서)` : null,
      epic_key: source.epic_key,
      tc_filename: source.tc_filename,
      tc_path: source.tc_path,
      requested_by: source.requested_by,
      mode: source.mode,
      tc_filter,
      analyzer_summary: source.analyzer_summary,
      additional_instructions: merged,
      parent_job_id: source.parent_job_id || source.id,
      retry_type: "continue",
      spec_url: source.spec_url,
      spec_filename: source.spec_filename,
      spec_text: source.spec_text,
      job_type: source.job_type,
      adhoc_focus: source.adhoc_focus,
      // v1.7 워커 상속
      worker_name: source.worker_name,
      claude_model: source.claude_model,
    });

    // v1.7 continue baseline — 진행률이 51% 부터 시작하게 카운트 미리 채움
    // Claude 가 새 시나리오 처리할 때 updateCountsFromText 가 누적 (current + 1) 으로 동작.
    // finalize 는 새 result_dir/summary.csv 보고 다시 집계 — 그래서 Claude 가 이전 항목도
    // 누적해서 summary.csv 에 쓰도록 prompt 에 명시함.
    db.prepare(
      `UPDATE jobs SET passed=?, failed=?, blocked=?, current_index=? WHERE id=?`
    ).run(
      source.passed || 0,
      source.failed || 0,
      source.blocked || 0,
      source.current_index || done,
      newJob.id
    );

    return Response.json({ ok: true, newJobId: newJob.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
