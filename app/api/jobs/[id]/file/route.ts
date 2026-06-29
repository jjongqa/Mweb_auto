import { NextRequest } from "next/server";
import { getJob } from "@/lib/jobs";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = req.nextUrl.searchParams.get("name");
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  if (!name) return new Response("name required", { status: 400 });

  const job = getJob(id);
  if (!job?.result_dir) return new Response("not found", { status: 404 });

  const baseAbs = path.resolve(job.result_dir);
  const requested = path.resolve(baseAbs, name);
  if (!requested.startsWith(baseAbs + path.sep) && requested !== baseAbs) {
    return new Response("forbidden", { status: 403 });
  }
  if (!fs.existsSync(requested)) return new Response("not found", { status: 404 });
  if (!fs.statSync(requested).isFile()) return new Response("not a file", { status: 400 });

  const data = fs.readFileSync(requested);
  const baseName = path.basename(requested);
  const ext = baseName.split(".").pop()?.toLowerCase() ?? "";

  const contentType = /^(png|jpg|jpeg|webp|gif)$/i.test(ext)
    ? `image/${ext === "jpg" ? "jpeg" : ext}`
    : ext === "csv"
    ? "text/csv; charset=utf-8"
    : ext === "md"
    ? "text/markdown; charset=utf-8"
    : "application/octet-stream";

  const disposition = inline ? "inline" : `attachment; filename="${encodeURIComponent(baseName)}"`;
  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
    },
  });
}
