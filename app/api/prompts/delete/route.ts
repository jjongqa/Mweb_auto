import { NextRequest } from "next/server";
import { deletePrompt, isAllowedFolder, sanitizeFilename, type AllowedFolder } from "@/lib/prompt-manager";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const folder = String(body.folder ?? "");
    const filename = String(body.filename ?? "");
    const uploadedBy = body.uploaded_by ? String(body.uploaded_by) : null;

    if (!isAllowedFolder(folder)) return Response.json({ error: "허용되지 않은 폴더" }, { status: 400 });
    const checked = sanitizeFilename(filename);
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

    const result = deletePrompt({
      folder: folder as AllowedFolder,
      filename: checked.safe,
      uploadedBy,
    });
    return Response.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 400 });
  }
}
