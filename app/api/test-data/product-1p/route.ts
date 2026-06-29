import { NextRequest } from "next/server";
import { createProducts1pBatch, type Product1pInput, type StorageType } from "@/lib/test-data-product-1p";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STORAGE: StorageType[] = ["AMBIENT_TEMPERATURE", "COLD", "FROZEN", "ETC"];

export async function POST(req: NextRequest) {
  let body: Partial<Product1pInput>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const email = (body.lacmsEmail ?? "").trim();
  const password = String(body.lacmsPassword ?? "");
  if (!email || !password) {
    return new Response(JSON.stringify({ error: "lacms 이메일/패스워드 필수" }), { status: 400 });
  }

  const input: Product1pInput = {
    lacmsEmail: email,
    lacmsPassword: password,
    count: Math.max(1, Math.min(50, (body.count ?? 1) | 0 || 1)),
    namePrefix: String(body.namePrefix ?? "QA자동화상품").slice(0, 30),
    basePrice: Math.max(100, Math.min(10_000_000, Number(body.basePrice) || 5000)),
    storageType: VALID_STORAGE.includes(body.storageType as StorageType) ? (body.storageType as StorageType) : "AMBIENT_TEMPERATURE",
    stockQuantity: Math.max(0, Math.min(1_000_000, Number(body.stockQuantity) || 10000)),
    doMaster: body.doMaster !== false,
    doContents: body.doContents !== false,
    doStock: body.doStock !== false,
    doDisplay: body.doDisplay !== false,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const results = await createProducts1pBatch(input, (e) => send({ kind: "progress", event: e }));
        const okCount = results.filter((r) => !r.error).length;
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
