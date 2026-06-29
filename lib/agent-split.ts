// Phase 2 멀티 분할 수행 — TC를 N개 청크로 나누는 분할 로직 (v1: 연속 범위 분할).
// 원본 줄 텍스트/No를 그대로 보존 → chunk_group 취합 시 원본 No 기준으로 합칠 수 있음(재넘버링 X).
import { splitCsvLines } from "./csv-parser";

export interface CsvChunk {
  text: string;   // 헤더 + 이 청크의 데이터 행
  count: number;  // 데이터 행 수
}

export interface ChunkFile {
  name: string;
  text: string;
}
export interface AgentChunkPlan {
  files: ChunkFile[]; // 이 청크(에이전트)가 받을 파일들
  count: number;      // 이 청크의 TC 행 수(추정)
}

// 한 CSV의 데이터 행을 N개 연속 청크로 등분. 헤더는 각 청크에 복제, 원본 줄은 그대로 보존.
// BOM 제거. 빈 줄은 데이터에서 제외. 행수 < n 이면 행수만큼만 청크 생성.
export function splitCsvRows(text: string, n: number): CsvChunk[] {
  const clean = text.replace(/^﻿/, "");
  const lines = splitCsvLines(clean);
  if (lines.length < 2 || n <= 1) {
    const count = Math.max(0, lines.length - 1);
    return [{ text: clean, count }];
  }
  const header = lines[0];
  const data = lines.slice(1).filter((l) => l.trim() !== "");
  if (data.length === 0) return [{ text: clean, count: 0 }];
  const parts = Math.min(n, data.length);
  const base = Math.floor(data.length / parts);
  const rem = data.length % parts; // 앞쪽 청크가 1개씩 더 가져감
  const chunks: CsvChunk[] = [];
  let cursor = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < rem ? 1 : 0);
    const slice = data.slice(cursor, cursor + size);
    cursor += size;
    chunks.push({ text: [header, ...slice].join("\n"), count: slice.length });
  }
  return chunks;
}

// N명(활성 에이전트 수)에게 줄 청크 계획.
//  - 단일 파일: 행을 N등분 → 청크마다 sub-CSV 1개
//  - 다중 파일: 파일을 N개 버킷으로 라운드로빈 분배 → 청크마다 자기 파일들(통째)
// 결과 청크 수는 min(n, 작업 단위 수). 빈 청크는 제외.
export function planAgentChunks(files: ChunkFile[], n: number): AgentChunkPlan[] {
  if (files.length === 0 || n <= 1) {
    const count = files.reduce((s, f) => s + Math.max(0, splitCsvLines(f.text.replace(/^﻿/, "")).length - 1), 0);
    return [{ files, count }];
  }
  if (files.length === 1) {
    const chunks = splitCsvRows(files[0].text, n);
    return chunks.map((c, i) => ({
      files: [{ name: `[${i + 1}/${chunks.length}] ${files[0].name}`, text: c.text }],
      count: c.count,
    }));
  }
  // 다중 파일 → 라운드로빈 버킷
  const parts = Math.min(n, files.length);
  const buckets: ChunkFile[][] = Array.from({ length: parts }, () => []);
  files.forEach((f, i) => buckets[i % parts].push(f));
  return buckets
    .filter((b) => b.length > 0)
    .map((b) => ({
      files: b,
      count: b.reduce((s, f) => s + Math.max(0, splitCsvLines(f.text.replace(/^﻿/, "")).length - 1), 0),
    }));
}
