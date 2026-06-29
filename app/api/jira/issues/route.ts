import { NextRequest } from "next/server";
import { getJob } from "@/lib/jobs";
import { getSettings, getSettingsByName, createJiraIssue, recordIssue, listIssuesForJob, touchSettingsLastUsed } from "@/lib/jira";

export const dynamic = "force-dynamic";

// GET ?job_id=... — 잡에 등록된 이슈 목록
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id");
  if (!jobId) return Response.json({ error: "job_id 필수" }, { status: 400 });
  const issues = listIssuesForJob(jobId);
  return Response.json({ issues });
}

// POST { job_id, items: [{tc_no, summary, description}], created_by? }
//   → 각 item 을 Jira 이슈로 등록 → DB 저장 → 결과 반환
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const jobId = String(body.job_id ?? "").trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const createdBy = body.created_by ? String(body.created_by) : null;
    if (!jobId) return Response.json({ error: "job_id 필수" }, { status: 400 });
    if (items.length === 0) return Response.json({ error: "items 비어있음" }, { status: 400 });

    const job = getJob(jobId);
    if (!job) return Response.json({ error: "테스트 없음" }, { status: 404 });

    // 워커별 토큰 분기:
    //  1. body.requested_by_override > job.requested_by 순으로 매칭 시도 (createdBy 는 보통 본인 이름과 같음)
    //  2. 못 찾으면 default (가장 최근 사용된 행)
    const matchKey: string | null = body.requested_by_override ? String(body.requested_by_override) : (job.requested_by || createdBy);
    const matched = getSettingsByName(matchKey);
    const settings = matched ?? getSettings();
    const usedDefault = matched == null;
    if (!settings) {
      return Response.json({ error: "Jira 설정이 없습니다. /jira-settings 에서 먼저 등록하세요." }, { status: 400 });
    }

    const results: { tc_no: string | null; ok: boolean; key?: string; url?: string; error?: string }[] = [];
    for (const it of items) {
      try {
        const tcNo = it.tc_no ? String(it.tc_no) : null;
        const summary = String(it.summary || "").trim();
        const description = String(it.description || "").trim();
        const priority = it.priority ? String(it.priority).trim() : undefined;
        if (!summary) {
          results.push({ tc_no: tcNo, ok: false, error: "summary 비어있음" });
          continue;
        }
        // 사용자 사양: 라벨 = ai-test, confirmed-bug (+ 설정에 추가 라벨이 있으면 함께)
        const labels = [
          "ai-test",
          "confirmed-bug",
          ...(settings.labels ? settings.labels.split(",").map(s => s.trim()).filter(Boolean) : []),
        ];
        const created = await createJiraIssue({
          settings,
          summary,
          description,
          epicKey: job.epic_key,
          labels,
          priority,  // "Highest" / "Medium" / "Low" (panel 에서 매핑된 값)
        });
        recordIssue({
          job_id: jobId,
          tc_no: tcNo,
          issue_key: created.key,
          issue_url: created.url,
          summary,
          created_by: createdBy,
        });
        results.push({ tc_no: tcNo, ok: true, key: created.key, url: created.url });
      } catch (err) {
        results.push({
          tc_no: it.tc_no ? String(it.tc_no) : null,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    touchSettingsLastUsed(settings.id);
    return Response.json({
      ok: true,
      results,
      used_settings: {
        id: settings.id,
        name: settings.name,
        email: settings.email,
        is_default_fallback: usedDefault,
        match_key: matchKey,
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
