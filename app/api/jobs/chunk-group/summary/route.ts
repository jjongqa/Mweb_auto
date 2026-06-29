import { NextRequest } from "next/server";
import { getChunkSiblings } from "@/lib/jobs";
import { splitCsvLines } from "@/lib/csv-parser";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/jobs/chunk-group/summary?groupId= — 청크 그룹의 summary.csv 들을 하나로 병합 다운로드.
// 청크는 chunk_index 순으로 서로소 No 구간을 가지므로, 순서대로 데이터행을 이어붙이면 No 순서가 된다.
export async function GET(req: NextRequest) {
  const groupId = (req.nextUrl.searchParams.get("groupId") || "").trim();
  if (!groupId) return new Response("groupId 필수", { status: 400 });

  const sibs = getChunkSiblings(groupId);
  if (sibs.length === 0) return new Response("그룹을 찾을 수 없음", { status: 404 });

  let header: string | null = null;
  const dataLines: string[] = [];
  const missing: string[] = [];

  for (const j of sibs) {
    const p = j.result_dir ? path.join(j.result_dir, "summary.csv") : null;
    if (!p || !fs.existsSync(p)) {
      const nick = (j.task_name || "").match(/\[([^\]]+)\]\s*$/)?.[1] || `청크${(j.chunk_index ?? 0) + 1}`;
      missing.push(nick);
      continue;
    }
    let text: string;
    try {
      text = fs.readFileSync(p, "utf-8").replace(/^﻿/, "");
    } catch {
      continue;
    }
    const lines = splitCsvLines(text);
    if (lines.length < 1) continue;
    if (!header) header = lines[0]; // 첫 청크 헤더를 대표로
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) dataLines.push(lines[i]);
    }
  }

  if (!header) {
    return new Response("아직 완료된 청크 결과(summary.csv)가 없습니다.", { status: 409 });
  }

  const csv = "﻿" + [header, ...dataLines].join("\n") + "\n";
  const fname = `merged_summary_${groupId}.csv`;
  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fname}"`,
  };
  // 미완료 청크가 있으면 헤더로 알림(다운로드는 가능 — 완료분만 합침)
  if (missing.length > 0) headers["X-Partial-Missing"] = encodeURIComponent(missing.join(","));
  return new Response(csv, { status: 200, headers });
}
