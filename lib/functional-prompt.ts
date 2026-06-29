/**
 * 기능테스트 inline 컨텍스트 조립 (admin 측).
 *
 * 워커가 기능테스트 실행 시 로컬에서 읽던 base/도메인 프롬프트 + CLAUDE.md + knowledge 폴더를,
 * admin이 (Drive 자동 동기화된) 로컬에서 읽어 한 덩어리 텍스트로 만들어 잡에 저장한다.
 * 워커(v1.9+)는 이 텍스트를 "파일 읽어라" 대신 그대로 임베드 → 외부 워커도 Drive 최신본 사용.
 * (TC생성이 스킬·정책을 inline 하는 것과 동일한 방식.)
 *
 * ⚠️ DOMAIN_FILE_MAP 은 워커 prompts.js 와 동기 유지(drift 주의). 베이스 파일 네이밍 규칙.
 */

import fs from "node:fs";
import path from "node:path";
import { getQaCoworkHome } from "./prompt-manager";
import { getDomainById } from "./domains";

const DOMAIN_FILE_MAP: Record<string, { web: string; app: string | null }> = {
  "멤버스": { web: "base-prompt-멤버스.md", app: "base-prompt-멤버스-app.md" },
  "회원":   { web: "base-prompt-회원.md",   app: "base-prompt-회원-app.md" },
  "3P":     { web: "base-prompt-3P.md",     app: null },
};

// 도메인별로 inline 할 가이드(prompts/guides/) — 명시 매핑. 여기 없는 도메인은 가이드 없음.
// 가이드 추가/도메인 추가 시 이 맵만 편집하면 됨.
const DOMAIN_GUIDE_MAP: Record<string, string[]> = {
  "3P": ["3p-product-register-guide.md", "3p-full-cycle-guide.md", "fbk-full-cycle-guide.md"],
  "회원": ["prompt_회원가입_테스트.md"],
  "주문": ["prompt_주문_flow.md"],
};

function readIf(p: string): string | null {
  try { return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null; } catch { return null; }
}

// ===== 과제명 기반 knowledge 관련도 점수 (워커 knowledge-matcher.js 이식 — drift 주의) =====
const STOPWORDS = new Set(["재실행", "재시작", "fail", "blocked", "필수", "수동", "자동", "step", "test", "테스트", "tc"]);
function extractKeywords(taskName: string): string[] {
  if (!taskName) return [];
  const clean = taskName.replace(/__RETRY_ENCOURAGE__/g, "").trim();
  return clean.split(/[\s_\-()[\]/,]+/).map((t) => t.trim()).filter((t) => t.length >= 2 && !STOPWORDS.has(t.toLowerCase()));
}
const SYSTEM_PATTERNS: { kw: string[]; canon: string }[] = [
  { kw: ["파트너오피스", "오피스", "partneroffice"], canon: "파트너오피스" },
  { kw: ["파트너어드민", "어드민", "partneradmin"], canon: "파트너어드민" },
  { kw: ["lacms", "라크엠스"], canon: "lacms" },
  { kw: ["컬리몰", "kurlymall", "kurly"], canon: "컬리몰" },
  { kw: ["레고", "lego"], canon: "레고" },
  { kw: ["앱", "app", "android", "ios"], canon: "앱" },
];
function detectSystems(taskName: string): string[] {
  const c = (taskName || "").toLowerCase();
  const out: string[] = [];
  for (const s of SYSTEM_PATTERNS) for (const k of s.kw) if (c.includes(k)) { if (!out.includes(s.canon)) out.push(s.canon); break; }
  return out;
}
function scoreFile(filename: string, kws: string[], systems: string[]): number {
  const lower = filename.toLowerCase();
  let score = 0;
  for (const kw of kws) if (lower.includes(kw.toLowerCase())) score += kw.length >= 4 ? 10 : 5;
  for (const s of systems) if (lower.includes(s.toLowerCase())) score += 7;
  return score;
}

export interface FunctionalContext {
  text: string | null;        // 임베드할 inline 블록 (없으면 null → 워커 로컬 폴백)
  includedFiles: string[];    // 포함된 파일 상대경로
  bytes: number;              // 대략 크기(토큰 가늠용)
  note: string;
}

// 기능테스트용 inline 컨텍스트 생성. platform: web/mweb→web 베이스, app→app 베이스.
// taskName: knowledge 를 과제 관련 파일로 좁히는 데 사용(매칭 없으면 폴더 전체 폴백).
export function buildFunctionalContext(domain: string, platform: "web" | "mweb" | "app", taskName = ""): FunctionalContext {
  const home = getQaCoworkHome();
  const promptsDir = path.join(home, "prompts");
  let baseDir = path.join(promptsDir, "베이스");
  if (!fs.existsSync(baseDir)) {
    const alt = path.join(promptsDir, "base");
    if (fs.existsSync(alt)) baseDir = alt;
  }

  const sections: string[] = [];
  const included: string[] = [];

  // 1. 전역 규칙 CLAUDE.md (신규 워커는 로컬에 없으므로 반드시 inline)
  const claude = readIf(path.join(home, "CLAUDE.md"));
  if (claude) { sections.push(`### [전역 규칙] CLAUDE.md\n\n${claude.trim()}`); included.push("CLAUDE.md"); }

  // 2. 공통 베이스 프롬프트 (Web/app)
  const baseFile = platform === "app" ? "base-prompt-app.md" : "base-prompt-Web.md";
  const baseTxt = readIf(path.join(baseDir, baseFile));
  if (baseTxt) { sections.push(`### [공통 베이스] ${baseFile}\n\n${baseTxt.trim()}`); included.push(`prompts/${baseFile}`); }

  // 3. 도메인 전용 베이스 프롬프트 (있을 때만)
  const map = DOMAIN_FILE_MAP[domain];
  const domainFile = map ? (platform === "app" ? map.app : map.web) : null;
  if (domainFile) {
    const cand = [
      path.join(promptsDir, domainFile),
      path.join(baseDir, domainFile),
      path.join(promptsDir, "도메인", domainFile),
    ];
    const found = cand.find((c) => fs.existsSync(c));
    const t = found ? readIf(found) : null;
    if (t) { sections.push(`### [도메인 전용] ${domainFile}\n\n${t.trim()}`); included.push(`prompts/${domainFile}`); }
  }

  // 3.5 도메인별 가이드 inline — DOMAIN_GUIDE_MAP 명시 매핑(그 도메인에 지정된 가이드만).
  const guidesDir = path.join(promptsDir, "guides");
  let guideCount = 0;
  for (const name of DOMAIN_GUIDE_MAP[domain] ?? []) {
    const found = [path.join(guidesDir, name), path.join(promptsDir, name)].find((c) => fs.existsSync(c));
    const t = found ? readIf(found) : null;
    if (t) { sections.push(`### [가이드] ${name}\n\n${t.trim()}`); included.push(`prompts/guides/${name}`); guideCount++; }
  }

  // 4. 선택 도메인의 knowledge 폴더에서 과제 관련 .md 만 (매칭 없으면 폴더 전체 폴백)
  // 폴더 구조: knowledge/{commerce|logistics}/{도메인}(중첩) 우선, 없으면 knowledge/{도메인}(평면, 레거시) 폴백.
  // BU 판별: knowledgeFolder 가 "물류"로 시작하면 logistics, 아니면 commerce.
  const knowledgeFolder = getDomainById(domain)?.knowledgeFolder || domain;
  const kgParent = knowledgeFolder.startsWith("물류") ? "logistics" : "commerce";
  const kgNested = path.join(home, "knowledge", kgParent, knowledgeFolder);
  const knowledgeDir = fs.existsSync(kgNested) ? kgNested : path.join(home, "knowledge", knowledgeFolder);
  const kgRel = path.relative(home, knowledgeDir);
  const kfiles: { rel: string; full: string }[] = [];
  const walk = (dir: string, base = "") => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, rel);
      else if (e.name.endsWith(".md")) kfiles.push({ rel, full });
    }
  };
  walk(knowledgeDir);

  // 과제명 키워드/시스템명으로 점수 → 관련(>0)만. 매칭 0이면(범용 과제명) 폴더 전체.
  const kws = extractKeywords(taskName);
  const systems = detectSystems(taskName);
  const scored = kfiles.map((k) => ({ ...k, score: scoreFile(path.basename(k.rel), kws, systems) }));
  const matched = scored.filter((k) => k.score > 0).sort((a, b) => b.score - a.score);
  const narrowed = matched.length > 0;
  const selected = (narrowed ? matched : kfiles.slice()).sort((a, b) => a.rel.localeCompare(b.rel));
  for (const k of selected) {
    const t = readIf(k.full);
    if (t) { sections.push(`### [knowledge] ${kgRel}/${k.rel}\n\n${t.trim()}`); included.push(`${kgRel}/${k.rel}`); }
  }
  const kInfo = kfiles.length === 0 ? "knowledge 0" : narrowed ? `knowledge ${selected.length}/${kfiles.length}(과제관련)` : `knowledge ${kfiles.length}(전체)`;

  if (sections.length === 0) {
    return { text: null, includedFiles: [], bytes: 0, note: "inline 자료 없음(로컬 미동기화?) — 워커 로컬 폴백" };
  }
  const text = sections.join("\n\n---\n\n");
  const guideInfo = guideCount > 0 ? ` · 가이드 ${guideCount}` : "";
  return { text, includedFiles: included, bytes: Buffer.byteLength(text, "utf8"), note: `inline ${included.length}개(${kInfo}${guideInfo}) · ${(Buffer.byteLength(text, "utf8") / 1024).toFixed(0)}KB` };
}
