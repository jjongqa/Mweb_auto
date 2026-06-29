import { NextRequest } from "next/server";
import { getSettings, getSettingsById, getAllSettings, upsertSettings, deleteSettings, publicSettings, testJiraConnection } from "@/lib/jira";

export const dynamic = "force-dynamic";

/**
 * GET                       → { settings: <default 1개>, all: [...] }
 *   (역호환: settings 필드는 confluence-token-banner 등 기존 호출자용)
 * GET ?id=N                 → { settings: <id 행> }
 * POST  body={...}          → 새 행 insert
 * POST  body={id, ...}      → 해당 id update (token === "__KEEP__" 면 기존 토큰 유지)
 * DELETE ?id=N              → 삭제
 */
export async function GET(req: NextRequest) {
  const idParam = req.nextUrl.searchParams.get("id");
  if (idParam) {
    const s = getSettingsById(Number(idParam));
    return Response.json({ settings: s ? publicSettings(s) : null });
  }
  const all = getAllSettings().map(publicSettings);
  const def = getSettings();
  return Response.json({
    settings: def ? publicSettings(def) : null,
    all,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name || !body.host || !body.email || !body.default_project_key) {
      return Response.json({ error: "name, host, email, default_project_key 필수" }, { status: 400 });
    }
    // id 지정 시: 토큰 빈 값 또는 "__KEEP__" 이면 기존 토큰 유지
    let apiToken = String(body.api_token ?? "");
    const updateId = body.id != null ? Number(body.id) : undefined;
    if (updateId != null) {
      if (!apiToken || apiToken === "__KEEP__") {
        const existing = getSettingsById(updateId);
        if (!existing) return Response.json({ error: "id 행 없음" }, { status: 404 });
        apiToken = existing.api_token;
      }
    } else {
      if (!apiToken) return Response.json({ error: "신규 등록은 api_token 필수" }, { status: 400 });
    }
    const s = upsertSettings({
      name: String(body.name),
      host: String(body.host),
      email: String(body.email),
      api_token: apiToken,
      default_project_key: String(body.default_project_key),
      default_issue_type: body.default_issue_type || "Bug",
      labels: body.labels || null,
      note: body.note || null,
    }, updateId);
    return Response.json({ ok: true, settings: publicSettings(s) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const idParam = req.nextUrl.searchParams.get("id");
  if (!idParam) return Response.json({ error: "id 쿼리 필수" }, { status: 400 });
  const ok = deleteSettings(Number(idParam));
  if (!ok) return Response.json({ error: "행 없음" }, { status: 404 });
  return Response.json({ ok: true });
}
