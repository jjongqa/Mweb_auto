// RFC 4180 호환 CSV 파서.
// quoted field 안의 콤마/줄바꿈을 안전하게 처리.
//
// admin-v1 의 모든 CSV 파싱은 이 파일을 단일 소스로 사용 (드리프트 방지).
// CJS 로 작성해 worker/index.js (Node, no-TS) 와 TS 파일 양쪽에서 require 가능.
// kurly-qa-worker-v1/src/index.js 는 별도 프로젝트라 자체 사본 유지 — 정의 변경 시 같이 갱신.

function splitCsvLines(text) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // escaped quote ("") 는 한 토큰으로 유지 — 행 경계 판정에서 따옴표 상태가 안 바뀌도록
      if (inQ && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQ = !inQ;
      cur += c;
    } else if ((c === "\n" || c === "\r") && !inQ) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (cur.length > 0) out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function parseCsvRow(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

module.exports = { splitCsvLines, parseCsvRow };
