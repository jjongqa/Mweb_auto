import { NextRequest } from "next/server";
import { runFullScenario, type FullScenarioInput } from "@/lib/test-data-full-scenario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<FullScenarioInput>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.memberNo || !String(body.memberNo).trim()) {
    return new Response(JSON.stringify({ error: "회원번호(memberNo) 필수 — 주문 인증에 사용" }), { status: 400 });
  }
  if (body.flavor !== "1P" && body.flavor !== "3P") {
    return new Response(JSON.stringify({ error: "flavor: '1P' 또는 '3P'" }), { status: 400 });
  }

  const input: FullScenarioInput = {
    flavor: body.flavor,
    memberNo: body.memberNo,
    lacmsEmail: body.lacmsEmail,
    lacmsPassword: body.lacmsPassword,
    basePrice: body.basePrice,
    stockQuantity: body.stockQuantity,
    openapiAccessToken: body.openapiAccessToken,
    adminId: body.adminId,
    adminPw: body.adminPw,
    productType3p: body.productType3p,
    count: Math.max(1, Math.min(20, (body.count ?? 1) | 0 || 1)),
    namePrefix: body.namePrefix,
    paymentGatewayId: body.paymentGatewayId,
    usingFreePoint: body.usingFreePoint,
    centerCode: body.centerCode,
    quantity: body.quantity,
    ordersPerProduct: body.ordersPerProduct,
    receiverName: body.receiverName,
    receiverPhoneNumber: body.receiverPhoneNumber,
    address: body.address,
    addressDetail: body.addressDetail,
    zipCode: body.zipCode,
    memo: body.memo,
    markDelivered: !!body.markDelivered,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const results = await runFullScenario(input, (e) => send({ kind: "progress", event: e }));
        // results 는 주문 1건당 한 행 → 상품 성공 수는 distinct index 로, 주문/배송은 행 수로 집계
        const productOkCount = new Set(results.filter((r) => r.productOk).map((r) => r.index)).size;
        const orderOkCount = results.filter((r) => r.orderOk).length;
        const deliveredOkCount = results.filter((r) => r.delivered).length;
        send({ kind: "done", productOkCount, orderOkCount, deliveredOkCount, total: results.length, results });
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
