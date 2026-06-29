import { NextRequest } from "next/server";
import { runMixedOrder, type MixedOrderInput, type ThreePSpec } from "@/lib/test-data-mixed-order";
import { MIXED_ORDER_3P_TYPES } from "@/lib/three-p-types";

const ALLOWED_3P = new Set(MIXED_ORDER_3P_TYPES.map((t) => t.value));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<MixedOrderInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.memberNo) {
    return new Response(JSON.stringify({ error: "memberNo (회원번호) 필수" }), { status: 400 });
  }
  const c1 = (body.count1p ?? 0) | 0;
  // 3P spec 검증 — 알려진 유형만, count>0
  const specs: ThreePSpec[] = (body.threeP ?? [])
    .filter((s) => s && ALLOWED_3P.has(s.productType))
    .map((s) => ({ productType: s.productType, count: (s.count ?? 0) | 0 }))
    .filter((s) => s.count > 0);
  const total3p = specs.reduce((n, s) => n + s.count, 0);
  if (c1 + total3p === 0) {
    return new Response(JSON.stringify({ error: "상품 개수 합이 0 — 1개 이상 선택 필요" }), { status: 400 });
  }

  const input: MixedOrderInput = {
    memberNo: body.memberNo,
    count1p: c1, threeP: specs,
    quantity: body.quantity,
    lacmsEmail: body.lacmsEmail,
    lacmsPassword: body.lacmsPassword,
    basePrice: body.basePrice,
    stockQuantity: body.stockQuantity,
    openapiAccessToken: body.openapiAccessToken,
    adminId: body.adminId,
    adminPw: body.adminPw,
    namePrefix: body.namePrefix,
    paymentGatewayId: body.paymentGatewayId,
    usingFreePoint: body.usingFreePoint,
    centerCode: body.centerCode,
    receiverName: body.receiverName,
    receiverPhoneNumber: body.receiverPhoneNumber,
    address: body.address,
    addressDetail: body.addressDetail,
    zipCode: body.zipCode,
    memo: body.memo,
    markDelivered3p: body.markDelivered3p,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const result = await runMixedOrder(input, (e) => send({ kind: "progress", event: e }));
        send({ kind: "done", result });
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
