import { NextRequest } from "next/server";
import { placeOrderBatch, type OrderCreateInput } from "@/lib/test-data-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<OrderCreateInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.memberNo || !String(body.memberNo).trim()) return new Response(JSON.stringify({ error: "memberNo (회원번호) 필수" }), { status: 400 });
  if (!body.dealProductNo) return new Response(JSON.stringify({ error: "dealProductNo 필수" }), { status: 400 });

  const input: OrderCreateInput = {
    memberNo: body.memberNo,
    dealProductNo: body.dealProductNo,
    count: Math.max(1, Math.min(20, (body.count ?? 1) | 0 || 1)),
    quantity: body.quantity,
    paymentGatewayId: body.paymentGatewayId,
    usingFreePoint: body.usingFreePoint,
    receiverName: body.receiverName,
    receiverPhoneNumber: body.receiverPhoneNumber,
    address: body.address,
    addressDetail: body.addressDetail,
    zipCode: body.zipCode,
    clusterCenterCode: body.clusterCenterCode,
    memo: body.memo,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const results = await placeOrderBatch(input, (e) => send({ kind: "progress", event: e }));
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
