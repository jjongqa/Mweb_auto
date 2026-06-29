import { NextRequest } from "next/server";
import { confirmPromotionsBatch, type PromotionConfirmInput } from "@/lib/test-data-promotion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Partial<PromotionConfirmInput> & { codesText?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  if (!body.lacmsEmail || !body.lacmsPassword) {
    return new Response(JSON.stringify({ error: "lacms 이메일/패스워드 필수" }), { status: 400 });
  }

  let codes: string[] = body.promotionCodes ?? [];
  if (body.codesText) {
    codes = body.codesText.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  if (codes.length === 0) {
    return new Response(JSON.stringify({ error: "프로모션 코드 최소 1개 필요" }), { status: 400 });
  }
  if (codes.length > 50) {
    return new Response(JSON.stringify({ error: "한 번에 최대 50개" }), { status: 400 });
  }

  const input: PromotionConfirmInput = {
    lacmsEmail: body.lacmsEmail,
    lacmsPassword: body.lacmsPassword,
    promotionUserName: (body.promotionUserName ?? "").trim() || (body.lacmsEmail.split("@")[0] ?? "user"),
    promotionUserGroupType: (body.promotionUserGroupType ?? "Marketing_ALL").trim(),
    promotionCodes: codes,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const { results, oauthError } = await confirmPromotionsBatch(input, (e) => send({ kind: "progress", event: e }));
        if (oauthError) {
          send({ kind: "fatal", error: `lacms 로그인 실패: ${oauthError}` });
        } else {
          const okCount = results.filter((r) => r.confirmed).length;
          send({ kind: "done", okCount, total: results.length, results });
        }
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
