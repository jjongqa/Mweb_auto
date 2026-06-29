import { NextRequest } from "next/server";
import { OPENAPI_BASE } from "@/lib/threep-openapi-catalog";
import { STG_OPENAPI_ACCESS_TOKEN } from "@/app/test-data/_stg-defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 3P OpenAPI 콘솔 프록시.
// 브라우저는 method/path/query/body 만 보내고, 서버가 Authorization: Bearer 토큰을 주입해
// third-party-external-api.stg 로 호출한다. (토큰을 클라가 직접 들고 다니지 않음)
const ALLOWED = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

interface Body {
  method?: string;
  path?: string;
  query?: Record<string, string>;
  bodyText?: string;
  accessToken?: string; // 선택 override — 비우면 STG 기본 토큰
}

export async function POST(req: NextRequest) {
  let b: Body;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const method = (b.method || "GET").toUpperCase();
  if (!ALLOWED.has(method)) return json({ error: `허용되지 않은 method: ${method}` }, 400);

  const path = (b.path || "").trim();
  // SSRF 가드: 우리가 base 를 고정 prepend 하므로 host 변조 불가. 추가로 형태 검증.
  if (!path.startsWith("/open-api/") || path.includes("://") || path.includes("..")) {
    return json({ error: `허용되지 않은 path: ${path}` }, 400);
  }
  if (path.includes("{") || path.includes("}")) {
    return json({ error: `경로 파라미터가 치환되지 않았습니다: ${path}` }, 400);
  }

  // 쿼리스트링 — 빈 값은 제외
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(b.query || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") qs.append(k, String(v));
  }
  const url = OPENAPI_BASE + path + (qs.toString() ? `?${qs.toString()}` : "");

  const token = (b.accessToken && b.accessToken.trim()) || STG_OPENAPI_ACCESS_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "DELETE" && b.bodyText && b.bodyText.trim()) {
    headers["Content-Type"] = "application/json;charset=UTF-8";
    init.body = b.bodyText;
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(url, init);
    const durationMs = Date.now() - startedAt;
    const contentType = res.headers.get("content-type") || "";
    let data: unknown = null;
    const text = await res.text();
    if (contentType.includes("application/json")) {
      try { data = JSON.parse(text); } catch { data = text; }
    } else {
      data = text.length > 20000 ? text.slice(0, 20000) + "\n…(생략)" : text;
    }
    return json({ ok: res.ok, status: res.status, durationMs, url, method, contentType, data }, 200);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    return json(
      { ok: false, status: 0, durationMs, url, method, error: err instanceof Error ? err.message : String(err) },
      200
    );
  }
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
