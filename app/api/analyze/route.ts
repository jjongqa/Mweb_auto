import { NextRequest } from "next/server";
import { analyzeCsv, type CsvAnalysisResult } from "@/lib/csv-analyzer";
import { POC_IDS } from "@/lib/pocs";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  // v1.2: 다중 파일 우선, 단일 파일도 호환
  const multi = formData.getAll("tc_files").filter((v) => v instanceof File && (v as File).size > 0) as File[];
  const single = formData.get("tc_file") as File | null;
  const files: File[] = multi.length > 0 ? multi : (single && single.size > 0 ? [single] : []);
  if (files.length === 0) return Response.json({ error: "tc_file required" }, { status: 400 });

  const tmpPaths: string[] = [];
  try {
    const perFile: { filename: string; size: number; analysis: CsvAnalysisResult }[] = [];
    for (const f of files) {
      const tmp = path.join(os.tmpdir(), `csv-analyze-${randomUUID()}.csv`);
      const buf = Buffer.from(await f.arrayBuffer());
      fs.writeFileSync(tmp, buf);
      tmpPaths.push(tmp);
      perFile.push({ filename: f.name, size: buf.length, analysis: analyzeCsv(tmp) });
    }

    // 단일 파일 호환: 기존 응답 그대로
    if (files.length === 1) {
      const r = perFile[0];
      return Response.json({ ok: true, filename: r.filename, size: r.size, analysis: r.analysis });
    }

    // 다중 파일: 집계
    const agg: CsvAnalysisResult = {
      totalRows: 0,
      headers: perFile[0].analysis.headers,
      hasPlatformCol: perFile.some((r) => r.analysis.hasPlatformCol),
      detectedPlatforms: { web: 0, app: 0, mWeb: 0, pc: 0, ios: 0, android: 0 },
      priorityCounts: { P1: 0, P2: 0, P3: 0, other: 0 },
      domainHints: { 멤버스: 0, 회원: 0, "3P": 0 },
      recommendedDomain: null,
      recommendedPlatform: null,
      pocCounts: [],
      warnings: [],
    };
    const pocAgg = new Map<string, number>();
    for (const r of perFile) {
      const a = r.analysis;
      for (const pc of a.pocCounts) pocAgg.set(pc.poc, (pocAgg.get(pc.poc) ?? 0) + pc.count);
      agg.totalRows += a.totalRows;
      agg.priorityCounts.P1 += a.priorityCounts.P1;
      agg.priorityCounts.P2 += a.priorityCounts.P2;
      agg.priorityCounts.P3 += a.priorityCounts.P3;
      agg.priorityCounts.other += a.priorityCounts.other;
      agg.detectedPlatforms.web += a.detectedPlatforms.web;
      agg.detectedPlatforms.app += a.detectedPlatforms.app;
      agg.detectedPlatforms.mWeb += a.detectedPlatforms.mWeb;
      agg.detectedPlatforms.pc += a.detectedPlatforms.pc;
      agg.detectedPlatforms.ios += a.detectedPlatforms.ios;
      agg.detectedPlatforms.android += a.detectedPlatforms.android;
      agg.domainHints.멤버스 += a.domainHints.멤버스 || 0;
      agg.domainHints.회원 += a.domainHints.회원 || 0;
      agg.domainHints["3P"] += a.domainHints["3P"] || 0;
      for (const w of a.warnings) agg.warnings.push(`[${r.filename}] ${w}`);
    }
    // 최다 힌트 → 추천 도메인 (단일 파일 분석기 로직 재현)
    const hintsSorted = Object.entries(agg.domainHints).sort((a, b) => b[1] - a[1]);
    if (hintsSorted[0] && hintsSorted[0][1] > 0) {
      agg.recommendedDomain = hintsSorted[0][0] as CsvAnalysisResult["recommendedDomain"];
    }
    // 플랫폼 추천: 첫 번째 파일 분석 결과를 사용 (대개 동일)
    agg.recommendedPlatform = perFile[0].analysis.recommendedPlatform;
    // 시트분류(POC) 집계 — POCS 정의 순
    agg.pocCounts = POC_IDS.filter((id) => pocAgg.has(id)).map((id) => ({ poc: id, count: pocAgg.get(id)! }));

    return Response.json({
      ok: true,
      filename: `${files.length} files`,
      size: perFile.reduce((s, r) => s + r.size, 0),
      analysis: agg,
      perFile,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    for (const p of tmpPaths) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  }
}
