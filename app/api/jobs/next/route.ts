import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/next?worker=jiho-mac
 *
 * 워커가 폴링해서 호출. 자기 이름이 명시된 Job 또는 미지정 Job 중 하나 반환 (없으면 null).
 * 클레임은 별도 호출 (/api/jobs/:id/claim).
 */
export async function GET(req: NextRequest) {
  const workerName = req.nextUrl.searchParams.get("worker")?.trim();
  if (!workerName) {
    return Response.json({ error: "worker 파라미터 필요" }, { status: 400 });
  }

  // 외부 워커는 자기 이름이 명시된 잡만 가져감.
  // worker_name=NULL ("자동 / 기본 워커") 은 종관님 PC 내장 워커 전용 (admin 의 claimNextPending 가 처리).
  const job = db.prepare(`
    SELECT id, domain, platform, qa_env, task_name, epic_key, tc_filename, tc_path,
           requested_by, mode, tc_filter, analyzer_summary, additional_instructions,
           worker_name, parent_job_id, retry_type, created_at,
           spec_url, spec_filename, spec_text,
           tc_paths, tc_filenames,
           job_type, adhoc_focus, claude_model, inlined_context,
           api_auth_token, api_secret_name,
           postman_collection_json, postman_environment_json, postman_collection_name, postman_assets_dir
    FROM jobs
    WHERE status='pending'
      AND worker_name = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(workerName);

  if (!job) {
    return Response.json({ job: null });
  }
  return Response.json({ job });
}
