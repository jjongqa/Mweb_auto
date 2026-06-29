import { NextRequest } from "next/server";
import { createAccountsBatch, type AccountCreateInput, type AccountCreateResult } from "@/lib/test-data-account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — 회원 계정 N건 생성. SSE 로 진행 상황 stream + 완료 시 전체 결과.
 *
 * Body (JSON):
 *  { count, idPrefix, namePrefix, emailDomain, password?, joinInflowType?, concurrency? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<AccountCreateInput>;
  const input: AccountCreateInput = {
    count: Math.max(1, Math.min(500, Number(body.count) || 1)),
    // memberId 정책 — 영문/숫자만, 12자 이내. prefix 는 stamp(3) + N(1~3) 자리 확보 위해 6자 권장.
    idPrefix: String(body.idPrefix || "kurly").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "kurly",
    namePrefix: String(body.namePrefix || "테스트유저").slice(0, 30),
    emailDomain: String(body.emailDomain || "kurlytest.com").replace(/[^a-zA-Z0-9.\-]/g, "") || "kurlytest.com",
    password: String(body.password || "TestPwd1234!"),
    joinInflowType: String(body.joinInflowType || "MOBILE_WEB"),
    concurrency: Math.max(1, Math.min(20, Number(body.concurrency) || 10)),
    subscribeMembership: !!body.subscribeMembership,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send("start", { total: input.count, concurrency: input.concurrency });
        const results = await createAccountsBatch(input, (done, total, latest) => {
          send("progress", { done, total, latest });
        });
        const okCount = results.filter((r) => r.ok).length;
        send("done", { results, okCount, failCount: results.length - okCount });
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
