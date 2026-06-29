import { NextRequest } from "next/server";
import { testJiraConnection, getSettingsById } from "@/lib/jira";

export const dynamic = "force-dynamic";

// { id } → 저장된(복호화된) 토큰으로 테스트 (마스킹돼서 재입력 불가한 행 검증용)
// { host, email, api_token } → 폼에 입력한 값으로 테스트 (신규 등록 전 확인)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.id != null) {
      const s = getSettingsById(Number(body.id));
      if (!s) return Response.json({ ok: false, error: "행 없음" }, { status: 404 });
      const result = await testJiraConnection({ host: s.host, email: s.email, api_token: s.api_token });
      return Response.json(result);
    }

    if (!body.host || !body.email || !body.api_token) {
      return Response.json({ ok: false, error: "host, email, api_token 필수" }, { status: 400 });
    }
    const result = await testJiraConnection({
      host: String(body.host),
      email: String(body.email),
      api_token: String(body.api_token),
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
