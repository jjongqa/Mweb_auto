import { NextRequest } from "next/server";
import { getJob, createJob, type TcFilter } from "@/lib/jobs";
import { db } from "@/lib/db";
import fs from "node:fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/[id]/extend  Body: { focus?: string }
 *
 * 잡(주로 succeeded) 결과를 보고 *추가 시나리오 검증* 을 새 잡으로 실행.
 * "이어서 진행" 과 차이:
 *  - 성공 잡에서도 가능 (continue 는 canceled/failed 만)
 *  - prompt 에 "추가 시나리오 도출 + 검증" 명시 (단순 미처리분 처리 X)
 *  - focus 입력 받음 (예: report.md 의 "추가 검증 필요" 항목 복붙)
 *  - retry_type = 'extend'
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
        error: `원본 CSV 파일을 찾을 수 없습니다: ${source.tc_path}`,
      }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const focus = (body.focus ? String(body.focus) : "").trim();

    const tc_filter: TcFilter | null = source.tc_filter ? JSON.parse(source.tc_filter) : null;
    const done = (source.passed || 0) + (source.failed || 0) + (source.blocked || 0);

    const extendContext = [
      `## 🔬 추가 검증 (extend) — 이전 잡 결과 컨텍스트`,
      ``,
      `이전 실행이 끝났고, 사용자가 **더 깊이/넓게 검증할 시나리오를 추가**로 진행하길 원함.`,
      ``,
      `**이전 잡 ID**: ${source.id}`,
      `**이전 처리 결과**: PASS ${source.passed || 0} / FAIL ${source.failed || 0} / BLOCKED ${source.blocked || 0} (총 ${done}건)`,
      source.result_dir ? `**이전 결과 폴더**: ${source.result_dir}` : "",
      ``,
      `### 시작하기 전:`,
      source.result_dir
        ? `1. \`${source.result_dir}/summary.csv\` 와 \`${source.result_dir}/report.md\` 가 있으면 먼저 \`Read\` 로 확인 — 어떤 시나리오/엣지가 이미 다뤄졌는지, 어떤 항목이 "추가 검증 필요" 로 마킹됐는지 파악.`
        : `1. 이전 결과 폴더의 summary.csv / report.md 있으면 먼저 확인.`,
      ``,
      focus
        ? `### 🎯 사용자가 명시한 추가 검증 가이드 (최우선)\n${focus}\n`
        : `### 사용자 추가 가이드 없음 — 다음 우선순위로 알아서 도출:\n- report.md 의 "의문점 / 추가 검증 필요" 항목\n- report.md 의 "추천 다음 액션" 항목\n- 이전 잡에서 다루지 않은 엣지/부정/경계값/회귀 케이스\n`,
      ``,
      `### 작업 규칙`,
      `2. **이미 검증한 시나리오는 다시 하지 말 것** (이전 result_dir 의 summary.csv 참고).`,
      `3. 새로 도출한 시나리오를 **5~15건** 정도 진행 (속도/정확성 균형).`,
      `4. 새 잡의 \`result_dir/summary.csv\` 에 **이전 ${done}건 + 신규 추가분** 을 한 파일에 누적 작성 (어드민이 단일 폴더에서 전체 집계).`,
      `5. 진행 상황 표준출력은 **신규 시나리오만** \`TC-N PASS/FAIL/BLOCKED\` 형태 (중복 카운트 방지).`,
      ``,
      `> 진행률이 ${done}/N 부터 시작하도록 baseline 이미 채워뒀음.`,
    ].filter(Boolean).join("\n");

    const merged = source.additional_instructions
      ? `${extendContext}\n\n---\n\n## 원본 잡의 추가 지시사항\n${source.additional_instructions}`
      : extendContext;

    // adhoc_focus 도 합치기 (애드혹 잡인 경우 — 추가 가이드 반영)
    let mergedAdhocFocus = source.adhoc_focus || null;
    if (isAdhoc && focus) {
      mergedAdhocFocus = source.adhoc_focus
        ? `${source.adhoc_focus}\n\n--- 추가 검증 (extend) ---\n${focus}`
        : focus;
    }

    const newJob = createJob({
      domain: source.domain,
      platform: source.platform,
      qa_env: source.qa_env,
      task_name: source.task_name ? `${source.task_name} (추가 검증)` : null,
      epic_key: source.epic_key,
      tc_filename: source.tc_filename,
      tc_path: source.tc_path,
      requested_by: source.requested_by,
      mode: source.mode,
      tc_filter,
      analyzer_summary: source.analyzer_summary,
      additional_instructions: merged,
      parent_job_id: source.parent_job_id || source.id,
      retry_type: "extend",
      spec_url: source.spec_url,
      spec_filename: source.spec_filename,
      spec_text: source.spec_text,
      job_type: source.job_type,
      adhoc_focus: mergedAdhocFocus,
      // v1.7 워커 상속
      worker_name: source.worker_name,
      claude_model: source.claude_model,
    });

    // baseline 카운트 — 이전 잡 값으로 채움 → 진행률이 ${done}/? 부터 시작
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
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
