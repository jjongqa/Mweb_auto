import fs from "node:fs";
import { splitCsvLines, parseCsvRow } from "./csv-parser";
import { normalizePoc, POC_IDS } from "./pocs";

export interface CsvAnalysisResult {
  totalRows: number;
  headers: string[];
  hasPlatformCol: boolean;
  detectedPlatforms: { web: number; app: number; mWeb: number; pc: number; ios: number; android: number };
  // 도메인 추정
  domainHints: { 멤버스: number; 회원: number; "3P": number };
  recommendedDomain: "멤버스" | "회원" | "3P" | null;
  recommendedPlatform: "web" | "app" | null;
  // 우선순위 통계
  priorityCounts: { P1: number; P2: number; P3: number; other: number };
  // 시트분류(POC) 컬럼 — 있으면 distinct 값 + 건수 (POCS 정의 순). 없으면 빈 배열.
  pocCounts: { poc: string; count: number }[];
  warnings: string[];
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  "멤버스": ["멤버스", "members", "VIP", "VVIP", "혜택가", "최대혜택"],
  "회원": ["회원가입", "로그인", "탈퇴", "마이페이지", "회원정보", "휴면", "비밀번호", "인증번호", "약관"],
  "3P": ["3P", "파트너", "파트너오피스", "파트너어드민", "셀러", "상품등록", "FBK", "컬리배송", "LACMS", "LaCMS"],
};

export function analyzeCsv(filePath: string): CsvAnalysisResult {
  const text = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  // v0.4b 버그 수정: CSV 셀 안의 줄바꿈 (따옴표 안)을 고려한 행 분리
  // 단순 text.split(/\r?\n/) 는 quoted newline 을 행 경계로 잘못 인식함
  const lines = splitCsvLines(text);

  const result: CsvAnalysisResult = {
    totalRows: 0,
    headers: [],
    hasPlatformCol: false,
    detectedPlatforms: { web: 0, app: 0, mWeb: 0, pc: 0, ios: 0, android: 0 },
    domainHints: { 멤버스: 0, 회원: 0, "3P": 0 },
    recommendedDomain: null,
    recommendedPlatform: null,
    priorityCounts: { P1: 0, P2: 0, P3: 0, other: 0 },
    pocCounts: [],
    warnings: [],
  };

  if (lines.length < 2) {
    result.warnings.push("CSV에 데이터 행이 없습니다");
    return result;
  }

  // 헤더 파싱 (간단한 CSV 파서 — 쌍따옴표 안의 콤마는 무시)
  result.headers = parseCsvRow(lines[0]);
  const dataRows = lines.slice(1).map(parseCsvRow);
  result.totalRows = dataRows.length;

  // 플랫폼 컬럼 감지
  const headerLc = result.headers.map((h) => h.toLowerCase().trim());
  const platformColIdx = headerLc.findIndex((h) =>
    /^(platform|플랫폼|pc|mweb|m\.web|aos|android|ios|디바이스)/.test(h)
  );
  result.hasPlatformCol = platformColIdx >= 0;

  // priority 컬럼 인덱스
  const priIdx = headerLc.findIndex((h) => /^(priority|우선순위)/.test(h));

  // 1depth/2depth 컬럼 (도메인 힌트 추출용)
  const depthIdxs = headerLc
    .map((h, i) => (/(1depth|2depth|3depth|title|제목)/.test(h) ? i : -1))
    .filter((i) => i >= 0);

  // 모든 셀 텍스트 합쳐서 도메인 키워드 카운트
  const allText = dataRows
    .flatMap((r) => depthIdxs.length > 0 ? depthIdxs.map((i) => r[i] ?? "") : r)
    .join(" ")
    .toLowerCase();

  for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of kws) {
      const re = new RegExp(escapeRegex(kw.toLowerCase()), "g");
      const matches = allText.match(re);
      if (matches) result.domainHints[domain as keyof typeof result.domainHints] += matches.length;
    }
  }

  // 추천 도메인
  const sorted = Object.entries(result.domainHints).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] > 0) {
    result.recommendedDomain = sorted[0][0] as CsvAnalysisResult["recommendedDomain"];
    if (sorted[0][1] === sorted[1][1]) {
      result.warnings.push(`도메인 추정 불확실: ${sorted[0][0]} vs ${sorted[1][0]} 동률`);
    }
  } else {
    result.warnings.push("도메인 키워드를 찾지 못함 — 수동 선택 필요");
  }

  // 플랫폼 통계
  if (platformColIdx >= 0) {
    for (const r of dataRows) {
      const v = (r[platformColIdx] ?? "").toLowerCase().trim();
      if (!v) continue;
      if (v.includes("ios")) result.detectedPlatforms.ios++;
      if (v.includes("android") || v.includes("aos")) result.detectedPlatforms.android++;
      if (v.includes("mweb") || v.includes("m.web") || v === "m") result.detectedPlatforms.mWeb++;
      if (v === "pc" || v.includes("desktop") || v.includes("web")) result.detectedPlatforms.pc++;
    }
  } else {
    // 컬럼명 기반 추정 (PC, mWeb 등이 별도 컬럼인 경우)
    for (let i = 0; i < headerLc.length; i++) {
      const h = headerLc[i];
      if (h === "pc") {
        // 해당 컬럼에 값이 있는 행 카운트
        const filled = dataRows.filter((r) => (r[i] ?? "").trim().length > 0).length;
        result.detectedPlatforms.pc += filled;
      } else if (h === "mweb" || h === "m.web") {
        const filled = dataRows.filter((r) => (r[i] ?? "").trim().length > 0).length;
        result.detectedPlatforms.mWeb += filled;
      }
    }
  }

  // 추천 플랫폼
  const dp = result.detectedPlatforms;
  const webScore = dp.pc + dp.web;
  const appScore = dp.ios + dp.android + dp.mWeb;
  if (webScore > 0 || appScore > 0) {
    if (webScore >= appScore * 2) result.recommendedPlatform = "web";
    else if (appScore >= webScore * 2) result.recommendedPlatform = "app";
    else {
      result.recommendedPlatform = webScore >= appScore ? "web" : "app";
      result.warnings.push(`PC/App 혼재 감지 (PC ${webScore} / App ${appScore})`);
    }
  }

  // 우선순위 카운트
  if (priIdx >= 0) {
    for (const r of dataRows) {
      const v = (r[priIdx] ?? "").trim().toUpperCase();
      if (v === "P1") result.priorityCounts.P1++;
      else if (v === "P2") result.priorityCounts.P2++;
      else if (v === "P3") result.priorityCounts.P3++;
      else if (v) result.priorityCounts.other++;
    }
  }

  // 시트분류(POC) 카운트 — 컬럼이 있으면 표준화한 distinct 값별 건수 (POCS 정의 순)
  const pocIdx = headerLc.findIndex((h) => h === "시트분류" || h === "poc" || h === "sheet");
  if (pocIdx >= 0) {
    const counts = new Map<string, number>();
    for (const r of dataRows) {
      const id = normalizePoc(r[pocIdx] ?? "");
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    result.pocCounts = POC_IDS.filter((id) => counts.has(id)).map((id) => ({ poc: id, count: counts.get(id)! }));
  }

  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// splitCsvLines, parseCsvRow 는 lib/csv-parser.ts 로 통합 (위에서 import).
