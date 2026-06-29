/**
 * v1.1: 기획문서 참조용 텍스트 추출 유틸
 * - PDF: pdf-parse로 본문 추출
 * - 너무 길면 앞부분만 잘라 토큰 폭주 방지
 * - v1.8: Confluence(*.atlassian.net/wiki/*) URL은 jira_settings 의 토큰으로 인증된 REST API 호출
 * - v1.9: 워커별 토큰 분기 — requested_by 로 jira_settings 행 매칭, 없으면 default 행 사용
 */
import { getSettings, getSettingsByName } from "./jira";

const MAX_CHARS = 30000;

export async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdf-parse는 CJS이므로 dynamic import
  const mod: any = await import("pdf-parse");
  const pdf = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
  const out = await pdf(buffer);
  return truncate((out.text ?? "").trim());
}

interface ConfluenceUrl {
  host: string;
  pageId: string | null;
  shortKey: string | null;
}

function parseConfluenceUrl(url: string): ConfluenceUrl | null {
  try {
    const u = new URL(url);
    if (!/\.atlassian\.net$/i.test(u.hostname)) return null;
    if (!u.pathname.startsWith("/wiki/")) return null;

    // 정식: /wiki/spaces/{spaceKey}/pages/{pageId}/...
    const m = u.pathname.match(/\/wiki\/spaces\/[^/]+\/pages\/(\d+)/);
    if (m) return { host: u.hostname, pageId: m[1], shortKey: null };

    // 짧은 URL: /wiki/x/{key}
    const sm = u.pathname.match(/\/wiki\/x\/([^/?#]+)/);
    if (sm) return { host: u.hostname, pageId: null, shortKey: sm[1] };

    return null;
  } catch { return null; }
}

async function resolveShortUrl(host: string, shortKey: string, auth: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${host}/wiki/x/${shortKey}`, {
      method: "GET",
      redirect: "manual",
      headers: { "Authorization": `Basic ${auth}`, "Accept": "text/html" },
    });
    const loc = res.headers.get("location");
    if (!loc) return null;
    const m = loc.match(/\/pages\/(\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

async function fetchConfluencePageBody(host: string, pageId: string, auth: string): Promise<string> {
  // v2 API: body-format=storage → HTML 형식의 본문
  const res = await fetch(`https://${host}/wiki/api/v2/pages/${pageId}?body-format=storage`, {
    headers: {
      "Authorization": `Basic ${auth}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Confluence API HTTP ${res.status}`);
  }
  const j: any = await res.json();
  const html = j?.body?.storage?.value ?? "";
  const title = j?.title ?? "";
  return (title ? `# ${title}\n\n` : "") + htmlToText(html);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(h[1-6]|li|tr|div|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchConfluenceAuthed(conf: ConfluenceUrl, url: string, requestedBy?: string | null): Promise<string | null> {
  // 1. requested_by 로 워커 매칭 시도 → 없으면 default
  const matched = getSettingsByName(requestedBy);
  const settings = matched ?? getSettings();
  const usedDefault = !matched && settings != null;

  if (!settings || !settings.api_token) {
    return `### ⚠️ Confluence 본문 미추출\nURL: ${url}\n원인: 어드민 /jira-settings 에 Atlassian API token 미등록.\n해결: 토큰 등록 후 잡 재실행.`;
  }
  const usedBy = `${settings.name} (${settings.email})${usedDefault && requestedBy ? ` [default fallback — 실행자 "${requestedBy}" 와 매칭되는 토큰 없음]` : ""}`;
  try {
    const auth = Buffer.from(`${settings.email}:${settings.api_token}`).toString("base64");
    let pageId = conf.pageId;
    if (!pageId && conf.shortKey) {
      pageId = await resolveShortUrl(conf.host, conf.shortKey, auth);
    }
    if (!pageId) {
      return `### ⚠️ Confluence 본문 미추출\nURL: ${url}\n원인: 페이지 ID 추출 실패 (URL 형식이 /wiki/spaces/{key}/pages/{id}/... 도 /wiki/x/{key} 도 아님).`;
    }
    const text = await fetchConfluencePageBody(conf.host, pageId, auth);
    const header = usedDefault ? `\n\n_(※ Confluence 본문은 default 토큰으로 추출됨: ${usedBy})_\n\n` : "";
    return truncate(header + text);
  } catch (err) {
    return `### ⚠️ Confluence 본문 추출 실패\nURL: ${url}\n사용 토큰: ${usedBy}\n원인: ${err instanceof Error ? err.message : String(err)}\n해결: 토큰 유효성 / 페이지 권한 확인.`;
  }
}

export async function fetchSpecUrlAsText(url: string, requestedBy?: string | null): Promise<string> {
  // Confluence 분기 — jira_settings 의 API token 으로 인증된 v2 API 호출
  const conf = parseConfluenceUrl(url);
  if (conf) {
    const text = await fetchConfluenceAuthed(conf, url, requestedBy);
    if (text) return text;
  }

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "kurly-qa-admin/1.1" },
      // 사내망 도구에 따라 일부 URL은 가져올 수 없을 수 있음
    });
    if (!res.ok) return "";
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("pdf")) {
      const buf = Buffer.from(await res.arrayBuffer());
      return await extractPdfText(buf);
    }
    const html = await res.text();
    return truncate(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  } catch {
    return "";
  }
}

function truncate(s: string): string {
  if (!s) return s;
  if (s.length <= MAX_CHARS) return s;
  return s.slice(0, MAX_CHARS) + `\n\n…(이하 생략: 원문 ${s.length}자 중 ${MAX_CHARS}자만 발췌)`;
}

/**
 * v1.7 다중 URL 지원 — 여러 기획서 URL 을 병렬 fetch 후 본문 구분선 join.
 * 각 URL 의 본문에 헤더(원문 URL) 를 prefix 로 붙임 → Claude 가 어느 문서에서 온 내용인지 구분 가능.
 * 최종 결과도 전체 길이 제한.
 */
export async function fetchMultipleSpecUrls(urls: string[], requestedBy?: string | null): Promise<string> {
  const cleaned = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return fetchSpecUrlAsText(cleaned[0], requestedBy);

  const fetched = await Promise.all(cleaned.map((u) => fetchSpecUrlAsText(u, requestedBy).catch(() => "")));
  const sections: string[] = [];
  cleaned.forEach((u, i) => {
    const body = fetched[i];
    if (!body) {
      sections.push(`### 📎 기획 문서 ${i + 1} — ${u}\n\n(본문 미추출 — 사람이 직접 참고)`);
    } else {
      sections.push(`### 📎 기획 문서 ${i + 1} — ${u}\n\n${body}`);
    }
  });
  return truncate(sections.join("\n\n---\n\n"));
}
