import { NextRequest } from "next/server";
import { createProducts3pBatch, ProductType } from "@/lib/test-data-product-3p";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  openapiBase?: string;
  adminHost?: string;
  cmsHost?: string;
  accessToken?: string;
  adminId?: string;
  adminPw?: string;
  cmsUsername?: string;
  cmsPassword?: string;
  cmsOauthBasic?: string;
  productType?: ProductType;
  count?: number;
  includeLacms?: boolean;
  doDisplay?: boolean;
  doStock?: boolean;
  stockQuantity?: string;
  partnerStoreNo?: string;
  cmsSellerId?: number;
  cmsMdNo?: number;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // 검증
  const openapiBase = (body.openapiBase ?? "https://third-party-external-api.stg.kurly.com").trim();
  const adminHost = (body.adminHost ?? "https://third-party-partner-gateway.stg.kurly.com").trim();
  const cmsHost = (body.cmsHost ?? "https://gateway.cloud.stg.kurly.services").trim();
  const accessToken = (body.accessToken ?? "").trim();
  const adminId = (body.adminId ?? "").trim();
  const adminPw = (body.adminPw ?? "").trim();
  const VALID_TYPES: ProductType[] = ["NORMAL_PARCEL", "KURLY_PARCEL", "KURLY_PARCEL_LIQUOR", "INSTALLATION_DELIVERY", "GOURMET_DELIVERY", "QUICK_DELIVERY", "ACCOMMODATION", "AIRLINE_TICKET", "ONLINE_TICKET", "SELF_PICKUP_WINE"];
  const productType: ProductType = VALID_TYPES.includes(body.productType as ProductType)
    ? (body.productType as ProductType)
    : "NORMAL_PARCEL";
  const count = Math.max(1, Math.min(50, (body.count ?? 1) | 0 || 1));
  const includeLacms = !!body.includeLacms;
  const doDisplay = !!body.doDisplay;
  const doStock = !!body.doStock;

  if (!accessToken) return new Response(JSON.stringify({ error: "OpenAPI access_token 필수" }), { status: 400 });
  if (!adminId || !adminPw) return new Response(JSON.stringify({ error: "어드민 ID/PW 필수" }), { status: 400 });
  if (includeLacms && (!body.cmsUsername || !body.cmsPassword)) {
    return new Response(JSON.stringify({ error: "La-CMS 단계 포함 시 username/password 필수" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const { results, lacmsOk, lacmsError } = await createProducts3pBatch(
          {
            openapiBase, adminHost, cmsHost,
            accessToken, adminId, adminPw,
            cmsUsername: body.cmsUsername, cmsPassword: body.cmsPassword,
            cmsOauthBasic: body.cmsOauthBasic,
            productType, count, includeLacms, doDisplay, doStock,
            stockQuantity: body.stockQuantity,
            partnerStoreNo: body.partnerStoreNo,
            cmsSellerId: body.cmsSellerId,
            cmsMdNo: body.cmsMdNo,
          },
          (e) => send({ kind: "progress", event: e })
        );
        const okCount = results.filter((r) => r.approved).length;
        send({
          kind: "done",
          okCount, total: results.length,
          results, lacmsOk, lacmsError: lacmsError ?? null,
        });
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
