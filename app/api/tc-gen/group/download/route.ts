import { NextRequest } from "next/server";
import { mergeTcGenGroupCsv, getTcGenGroupSiblings } from "@/lib/tc-gen";
import { splitCsvLines, parseCsvRow } from "@/lib/csv-parser";
import { normalizePoc } from "@/lib/pocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tc-gen/group/download?groupId=[&poc=] — 작성(tc) 그룹의 완료 CSV 를 합본해 다운로드.
// poc 지정 시 그 시트분류 행만 필터(미리보기 per-POC 다운로드와 일치).
export async function GET(req: NextRequest) {
  const groupId = (req.nextUrl.searchParams.get("groupId") || "").trim();
  const poc = (req.nextUrl.searchParams.get("poc") || "").trim();
  if (!groupId) return new Response("groupId 필수", { status: 400 });
  const merged = mergeTcGenGroupCsv(groupId);
  if (!merged) return new Response("아직 완료된 작성 결과(CSV)가 없습니다.", { status: 409 });

  let csv = merged.csv;
  if (poc) {
    const lines = splitCsvLines(csv);
    const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
    const iPoc = header.findIndex((h) => h === "시트분류" || h === "poc" || h === "sheet");
    if (iPoc >= 0) {
      const kept = [lines[0]];
      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvRow(lines[i]);
        if (cells.some((x) => x.trim()) && normalizePoc(cells[iPoc] ?? "") === poc) kept.push(lines[i]);
      }
      csv = kept.join("\n");
    }
  }

  const sibs = getTcGenGroupSiblings(groupId);
  const base = (sibs[0]?.task_name || "merged").replace(/\s*\[[^\]]+\]\s*$/, "").replace(/[\/\\:\0]/g, "_").slice(0, 60) || "merged";
  const fname = `${base}${poc ? "_" + poc : ""}_통합.csv`;
  return new Response("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}
