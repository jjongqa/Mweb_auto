import { NextRequest } from "next/server";
import fs from "node:fs";
import { getTcGenJob, filterCsvByPoc, resolveTcOutputPath } from "@/lib/tc-gen";

export const dynamic = "force-dynamic";

// GET /api/tc-gen/:id/download          — 전체 TC CSV
// GET /api/tc-gen/:id/download?poc=...  — 해당 POC(시트분류) 행만 추려 CSV (개별 다운로드)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getTcGenJob(id);
  const outputPath = resolveTcOutputPath(job?.output_path);
  if (!job || !outputPath || !fs.existsSync(outputPath)) {
    return Response.json({ error: "생성된 CSV 없음" }, { status: 404 });
  }

  const poc = req.nextUrl.searchParams.get("poc");
  if (poc) {
    const raw = fs.readFileSync(outputPath, "utf-8");
    const { csv, count } = filterCsvByPoc(raw, poc);
    if (count === 0) return Response.json({ error: `'${poc}' POC 행 없음` }, { status: 404 });
    const base = (job.output_filename || "generated-tc.csv").replace(/\.csv$/i, "");
    const safePoc = poc.replace(/[\/\\:\0]/g, "_");
    const filename = encodeURIComponent(`${base}_${safePoc}.csv`);
    return new Response("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  }

  const buf = fs.readFileSync(outputPath);
  const filename = encodeURIComponent(job.output_filename || "generated-tc.csv");
  return new Response(buf, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
