import { NextRequest } from "next/server";
import path from "node:path";
import { retryByResult, type RetryOverrides } from "@/lib/retry-fail";

export const dynamic = "force-dynamic";

// body 의 model/priority/worker → RetryOverrides. 미지정 키는 부모 상속.
function parseOverrides(body: Record<string, unknown>): RetryOverrides | undefined {
  const ov: RetryOverrides = {};
  let any = false;
  if (typeof body.claude_model === "string" && body.claude_model.trim()) { ov.claude_model = body.claude_model.trim(); any = true; }
  if (typeof body.worker_name === "string" && body.worker_name.trim()) { ov.worker_name = body.worker_name.trim(); any = true; }
  if (body.priority === "P1" || body.priority === "P1+P2") { ov.tc_filter = { priority: body.priority }; any = true; }
  return any ? ov : undefined;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const requestedBy = body.requested_by ? String(body.requested_by) : null;
    const additionalInstructions = body.additional_instructions ? String(body.additional_instructions).trim() : null;
    // 격려 메시지 자동 추가 (기본 true — BLOCKED 재실행의 핵심 가치)
    const withEncouragement = body.with_encouragement !== false;

    const uploadsDir = path.join(process.cwd(), "uploads");
    const result = retryByResult({
      sourceJobId: id,
      uploadsDir,
      resultType: "BLOCKED",
      requestedBy,
      withEncouragement,
      additionalInstructions,
      overrides: parseOverrides(body),
    });

    return Response.json({
      ok: true,
      newJobId: result.newJob.id,
      retryCount: result.retryCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 400 });
  }
}
