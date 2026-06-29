import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/:id/tc?worker=jiho-mac
 *
 * 워커가 Job 의 TC CSV 파일을 다운로드. 권한 체크 후 raw bytes 반환.
 * 클레임 한 워커만 다운로드 가능.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const worker = req.nextUrl.searchParams.get("worker")?.trim();
  if (!worker) {
    return Response.json({ error: "worker 파라미터 필수" }, { status: 400 });
  }

  const job = db.prepare(`SELECT tc_path, tc_filename, worker_name FROM jobs WHERE id=?`).get(id) as
    | { tc_path: string; tc_filename: string; worker_name: string | null }
    | undefined;
  if (!job) return Response.json({ error: "Job 없음" }, { status: 404 });

  // 권한: 클레임 한 워커 또는 null (워커 미지정 — 누구든 OK)
  if (job.worker_name && job.worker_name !== worker) {
    return Response.json({ error: "권한 없음" }, { status: 403 });
  }

  if (!fs.existsSync(job.tc_path)) {
    return Response.json({ error: `TC 파일 없음 (서버): ${job.tc_path}` }, { status: 404 });
  }

  const buf = fs.readFileSync(job.tc_path);
  const filename = path.basename(job.tc_filename || "tc.csv");
  // RFC 5987 utf-8 인코딩 (한글 파일명 안전)
  const encodedName = encodeURIComponent(filename);

  return new Response(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(buf.length),
    },
  });
}
