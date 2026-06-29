import { NextRequest } from "next/server";
import { fetchSpecUrlAsText } from "@/lib/spec-extractor";

export const dynamic = "force-dynamic";

// F10 사전 spec 검증 — 잡 실행 전에 Confluence/URL 추출이 되는지 미리 확인.
// 토큰 만료·URL 오타·권한 문제를 잡 실행 후가 아니라 등록 전에 발견.
// POST { spec_url: "줄바꿈 구분 URL들", requested_by? }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = String(body.spec_url ?? "");
  const requestedBy = body.requested_by ? String(body.requested_by) : null;

  const urls = raw
    .split(/[\n,]/)
    .map((u: string) => u.trim())
    .filter((u: string) => /^https?:\/\//i.test(u));

  if (urls.length === 0) {
    return Response.json({ error: "검증할 URL이 없습니다 (http/https 로 시작해야 함)" }, { status: 400 });
  }

  const results = await Promise.all(
    urls.map(async (url: string) => {
      try {
        const text = await fetchSpecUrlAsText(url, requestedBy);
        const failed = !text || text.startsWith("### ⚠️");
        return {
          url,
          ok: !failed,
          length: text && !failed ? text.length : 0,
          preview: text && !failed ? text.slice(0, 160) : null,
          reason: failed ? (text ? "추출 실패 (토큰/권한/형식 확인)" : "본문이 비어 있음") : null,
        };
      } catch (err) {
        return { url, ok: false, length: 0, preview: null, reason: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  return Response.json({ ok: results.every((r) => r.ok), results });
}
