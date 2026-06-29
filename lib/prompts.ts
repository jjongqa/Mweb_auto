import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * QA-Cowork 폴더 경로 (~/Documents/QA-Cowork/AI_Test).
 * 환경변수 KURLY_QA_HOME 으로 오버라이드 가능.
 */
export function getQaCoworkHome(): string {
  if (process.env.KURLY_QA_HOME) return process.env.KURLY_QA_HOME;
  return path.join(os.homedir(), "Documents", "QA-Cowork", "AI_Test");
}

export interface PromptResolution {
  domainPromptPath: string;        // 예: prompts/base-prompt-멤버스.md
  basePromptPath: string;          // 예: prompts/베이스/base-prompt-Web.md
  exists: { domain: boolean; base: boolean };
  domainPromptContent?: string;
  basePromptContent?: string;
  knowledgeFolderPath: string;     // 예: knowledge/멤버스
  knowledgeFiles: string[];        // 절대경로 목록
}

const DOMAIN_FILE_MAP: Record<string, { web: string; app: string | null }> = {
  "멤버스": { web: "base-prompt-멤버스.md", app: "base-prompt-멤버스-app.md" },
  "회원": { web: "base-prompt-회원.md", app: "base-prompt-회원-app.md" },
  "3P": { web: "base-prompt-3P.md", app: null }, // 3P는 Web만
};

export function resolvePrompts(
  domain: string,
  platform: "web" | "app"
): PromptResolution {
  const home = getQaCoworkHome();
  const promptsDir = path.join(home, "prompts");
  const baseDir = path.join(promptsDir, "베이스");

  const map = DOMAIN_FILE_MAP[domain];
  if (!map) throw new Error(`Unknown domain: ${domain}`);
  const domainFile = platform === "app" ? map.app : map.web;
  if (!domainFile) {
    throw new Error(`${domain} 도메인은 ${platform} 플랫폼을 지원하지 않습니다`);
  }

  const baseFile = platform === "app" ? "base-prompt-app.md" : "base-prompt-Web.md";

  const domainPromptPath = path.join(promptsDir, domainFile);
  const basePromptPath = path.join(baseDir, baseFile);

  const domainExists = fs.existsSync(domainPromptPath);
  const baseExists = fs.existsSync(basePromptPath);

  // knowledge/{commerce|logistics}/{도메인}(중첩) 우선, 없으면 knowledge/{도메인}(평면, 레거시)
  const kgParent = domain.startsWith("물류") ? "logistics" : "commerce";
  const kgNested = path.join(home, "knowledge", kgParent, domain);
  const knowledgeFolderPath = fs.existsSync(kgNested) ? kgNested : path.join(home, "knowledge", domain);
  let knowledgeFiles: string[] = [];
  if (fs.existsSync(knowledgeFolderPath)) {
    knowledgeFiles = fs
      .readdirSync(knowledgeFolderPath)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(knowledgeFolderPath, f));
  }

  return {
    domainPromptPath,
    basePromptPath,
    exists: { domain: domainExists, base: baseExists },
    domainPromptContent: domainExists ? fs.readFileSync(domainPromptPath, "utf-8") : undefined,
    basePromptContent: baseExists ? fs.readFileSync(basePromptPath, "utf-8") : undefined,
    knowledgeFolderPath,
    knowledgeFiles,
  };
}

/**
 * Claude Code에 던질 자연어 메시지 생성.
 * 종관님이 평소 쓰는 스타일과 동일하게 — 단, 어드민이 컨텍스트(파일경로, 환경 등)를 명시.
 */
export function buildClaudeMessage(input: {
  domain: string;
  platform: "web" | "app";
  qaEnv: string;        // 'stg', 'qa1' ... 'qa15'
  taskName: string;
  tcCsvAbsPath: string;
  resultDirAbsPath: string;
  resolution: PromptResolution;
}): string {
  const { domain, platform, qaEnv, taskName, tcCsvAbsPath, resultDirAbsPath, resolution } = input;

  const domainKor = domain;
  const platformKor = platform === "app" ? "앱" : "웹";
  const envKor = qaEnv === "stg" ? "기본 STG" : qaEnv.toUpperCase();

  const domainPromptRel = path.relative(getQaCoworkHome(), resolution.domainPromptPath);
  const basePromptRel = path.relative(getQaCoworkHome(), resolution.basePromptPath);
  const knowledgeRel = path.relative(getQaCoworkHome(), resolution.knowledgeFolderPath);

  return `${domainKor} 도메인 TC를 ${platformKor}으로 ${envKor} 환경에서 돌려줘.

## 실행 정보
- TC CSV 파일: ${tcCsvAbsPath}
- 환경: ${envKor} (${qaEnv === "stg" ? "stg.kurly.com" : `${qaEnv}.stg.kurly.com`})
- 도메인: ${domainKor}
- 플랫폼: ${platformKor}
- 과제명: ${taskName}
- 결과 저장 위치: ${resultDirAbsPath}

## 참조 프롬프트
- ${basePromptRel} (공통 베이스)
- ${domainPromptRel} (도메인 전용)
- ${knowledgeRel}/ 폴더의 모든 .md 파일을 시작 전 반드시 읽기
- CLAUDE.md의 모든 규칙을 따른다

## 결과 출력 형식
${resultDirAbsPath} 폴더 안에 다음 파일들을 생성해줘:
- summary.csv (UTF-8 BOM, 컬럼: No, Priority, Type, TC Title${platform === "app" ? ", Platform" : ""}, Test Step, Expected Result, Actual Result, Result, Notes, Screenshot)
- fail-detail.csv (UTF-8 BOM, FAIL 케이스만)
- TC-{No}/ 하위에 케이스별 스크린샷 (PASS는 1장, FAIL은 반드시 1장 이상)

## 주의
- 운영(production) 절대 접근 금지. STG 전용.
- NO BATCH PASS — 모든 TC 개별 실행.
- 진행 상황을 표준출력으로 알려줘 (예: "TC-1 PASS", "TC-2 FAIL: 사유...").
`;
}
