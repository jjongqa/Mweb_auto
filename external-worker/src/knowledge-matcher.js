// 과제명 기반 knowledge 파일 자동 매칭
// 종관님 파일명 컨벤션: knowledge-{과제명키워드}-{시스템명}.md

const fs = require("node:fs");
const path = require("node:path");

/**
 * 과제명에서 키워드 추출.
 * "KC 인증정보 입력 강화 _오피스" → ["KC", "인증정보", "입력", "강화", "오피스"]
 */
function extractKeywords(taskName) {
  if (!taskName) return [];
  // 마커 제거
  const clean = taskName.replace(/__RETRY_ENCOURAGE__/g, "").trim();
  // 공백, _, -, (, ), [, ] 등으로 분리
  const tokens = clean.split(/[\s_\-()\[\]/,]+/).filter((t) => t.length >= 2);
  // 의미 없는 단어 제거
  const stopwords = new Set([
    "재실행", "재시작", "FAIL", "BLOCKED", "필수", "수동", "자동",
    "step", "test", "테스트", "tc",
  ]);
  return tokens
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !stopwords.has(t.toLowerCase()));
}

/**
 * 과제명에서 시스템명(파트너오피스 등) 추출.
 * "KC 인증정보 입력 강화 _오피스" → "파트너오피스" 매칭 유도
 */
function detectSystemNames(taskName) {
  const clean = taskName.toLowerCase();
  const systems = [];
  // 종관님 환경에서 자주 쓰이는 시스템명들
  const systemPatterns = [
    { keywords: ["파트너오피스", "오피스", "partneroffice"], canonical: "파트너오피스" },
    { keywords: ["파트너어드민", "어드민", "partneradmin"], canonical: "파트너어드민" },
    { keywords: ["lacms", "라크엠스"], canonical: "LaCMS" },
    { keywords: ["컬리몰", "kurlymall", "kurly"], canonical: "컬리몰" },
    { keywords: ["레고", "lego"], canonical: "레고" },
    { keywords: ["앱", "app", "android", "ios"], canonical: "앱" },
  ];
  for (const sys of systemPatterns) {
    for (const kw of sys.keywords) {
      if (clean.includes(kw)) {
        if (!systems.includes(sys.canonical)) systems.push(sys.canonical);
        break;
      }
    }
  }
  return systems;
}

/**
 * 한 knowledge 파일이 과제와 얼마나 매칭되는지 점수 계산.
 * 점수 높을수록 핵심 자료.
 */
function scoreKnowledgeFile(filename, taskKeywords, taskSystems) {
  const lower = filename.toLowerCase();
  let score = 0;

  // 1. 과제명 키워드 매칭 (가장 큰 가중치)
  for (const kw of taskKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      // 긴 키워드일수록 가치 큼
      score += kw.length >= 4 ? 10 : 5;
    }
  }

  // 2. 시스템명 매칭 (가중치 중간)
  for (const sys of taskSystems) {
    if (lower.includes(sys.toLowerCase())) {
      score += 7;
    }
  }

  return score;
}

/**
 * knowledge 폴더에서 과제와 매칭되는 파일들을 점수 순으로 반환.
 *
 * @returns {Array<{filename, score, size, relPath}>}
 */
function findRelevantKnowledge(knowledgeDirAbsPath, taskName, qaCoworkHome) {
  if (!fs.existsSync(knowledgeDirAbsPath)) return [];

  const keywords = extractKeywords(taskName);
  const systems = detectSystemNames(taskName);

  // knowledge 폴더 안의 모든 .md 파일 수집 (하위 폴더 포함)
  const allFiles = [];
  function walk(dir, baseRel = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.name.endsWith(".md")) {
        const stat = fs.statSync(full);
        allFiles.push({
          filename: entry.name,
          fullPath: full,
          relPath: path.relative(qaCoworkHome, full),
          size: stat.size,
        });
      }
    }
  }
  walk(knowledgeDirAbsPath);

  // 각 파일 점수 매기기
  const scored = allFiles.map((f) => ({
    ...f,
    score: scoreKnowledgeFile(f.filename, keywords, systems),
  }));

  // 점수 0 초과만 + 점수 높은 순
  const matched = scored
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);

  return matched;
}

module.exports = {
  extractKeywords,
  detectSystemNames,
  scoreKnowledgeFile,
  findRelevantKnowledge,
};
