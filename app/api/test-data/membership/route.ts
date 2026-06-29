import { NextRequest } from "next/server";
import { subscribeMembershipBatch, type MembershipSubscribeInput } from "@/lib/test-data-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<MembershipSubscribeInput> & { memberNosText?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  // memberNos 직접 배열 또는 multiline text 입력
  let memberNos: (number | string)[] = body.memberNos ?? [];
  if (body.memberNosText) {
    memberNos = body.memberNosText
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (memberNos.length === 0) {
    return new Response(JSON.stringify({ error: "회원번호 최소 1개 필수" }), { status: 400 });
  }
  if (memberNos.length > 100) {
    return new Response(JSON.stringify({ error: "한 번에 최대 100명까지" }), { status: 400 });
  }

  const input: MembershipSubscribeInput = {
    memberNos,
    productCd: body.productCd,
    ticketMetaId: body.ticketMetaId,
    benefitOptionId: body.benefitOptionId,
    registeredAt: body.registeredAt,
    expiredAt: body.expiredAt,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const results = await subscribeMembershipBatch(input, (e) => send({ kind: "progress", event: e }));
        const okCount = results.filter((r) => r.ok).length;
        send({ kind: "done", okCount, total: results.length, results });
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
