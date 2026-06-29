// shared/csv-parser.js (CJS) 의 TS 래퍼. .ts/.tsx 호출부 용도.
// 단일 정의 — shared/csv-parser.js 에 로직 있음.

import parser from "../shared/csv-parser.js";

export const splitCsvLines: (text: string) => string[] = parser.splitCsvLines;
export const parseCsvRow: (line: string) => string[] = parser.parseCsvRow;
