import { NextRequest } from "next/server";
import { writeReviewsBatch, type ReviewWriteInput, type ReviewPassStatus } from "@/lib/test-data-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<ReviewWriteInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  const memberNo = String(body.memberNo ?? "").trim();
  if (!memberNo || !/^\d+$/.test(memberNo)) {
    return new Response(JSON.stringify({ error: "회원번호(memberNo) 필수" }), { status: 400 });
  }

  const input: ReviewWriteInput = {
    memberNo,
    contents: body.contents?.toString(),
    maxCount: Math.max(0, Math.min(100, Number(body.maxCount) || 0)),
    passStatus: (["NONE", "ALL", "FORBIDDEN"].includes(String(body.passStatus)) ? body.passStatus : "NONE") as ReviewPassStatus,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const { results, writableTotal, error } = await writeReviewsBatch(input, (e) => send({ kind: "progress", event: e }));
        const okCount = results.filter((r) => r.ok).length;
        send({ kind: "done", okCount, total: results.length, writableTotal, results, error });
      } catch (err) {
        send({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
