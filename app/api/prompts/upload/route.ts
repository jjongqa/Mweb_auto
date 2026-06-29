import { NextRequest } from "next/server";
import {
  uploadPrompt,
  fileExists,
  isAllowedFolder,
  sanitizeFilename,
  type AllowedFolder,
} from "@/lib/prompt-manager";

export const dynamic = "force-dynamic";

// 충돌 체크 (실제 업로드 전에 미리 확인하기 위해)
export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder") ?? "";
  const filename = req.nextUrl.searchParams.get("filename") ?? "";
  if (!isAllowedFolder(folder)) {
    return Response.json({ error: "허용되지 않은 폴더" }, { status: 400 });
  }
  const checked = sanitizeFilename(filename);
  if (!checked.ok) {
    return Response.json({ error: checked.error }, { status: 400 });
  }
  const exists = fileExists(folder as AllowedFolder, checked.safe);
  return Response.json({ exists, folder, filename: checked.safe });
}

// 업로드 (덮어쓰기 명시적 동의 필요)
export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const folder = String(fd.get("folder") ?? "");
    const file = fd.get("file") as File | null;
    const allowOverwrite = String(fd.get("allow_overwrite") ?? "0") === "1";
    const uploadedBy = String(fd.get("uploaded_by") ?? "").trim() || null;

    if (!isAllowedFolder(folder)) {
      return Response.json({ error: "허용되지 않은 폴더" }, { status: 400 });
    }
    if (!file) {
      return Response.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const result = uploadPrompt({
      folder: folder as AllowedFolder,
      filename: file.name,
      content: buf,
      uploadedBy,
      allowOverwrite,
    });

    return Response.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 400 });
  }
}
