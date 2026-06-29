import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export const dynamic = "force-dynamic";

// QA-Cowork 자산 (prompts / knowledge / CLAUDE.md / .mcp.json) 만 zip
// test-results / .playwright-mcp / 그외 무거운 폴더는 제외
const SOURCE_HOME = process.env.KURLY_QA_COWORK_HOME
  ? path.resolve(process.env.KURLY_QA_COWORK_HOME)
  : path.join(os.homedir(), "Documents", "QA-Cowork", "AI_Test");

const INCLUDE_PATHS = ["prompts", "knowledge", "CLAUDE.md", ".mcp.json"];

function buildZip(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SOURCE_HOME)) {
      return reject(new Error(`QA-Cowork 폴더 없음: ${SOURCE_HOME}`));
    }
    // 실제로 존재하는 항목만 골라서 zip
    const present = INCLUDE_PATHS.filter((p) => fs.existsSync(path.join(SOURCE_HOME, p)));
    if (present.length === 0) {
      return reject(new Error(`QA-Cowork 안에 prompts/knowledge/CLAUDE.md 가 없음: ${SOURCE_HOME}`));
    }
    const tmpZip = path.join(os.tmpdir(), `qa-cowork-${Date.now()}.zip`);

    const p = spawn(
      "zip",
      [
        "-r", "-q",
        tmpZip,
        ...present,
        "-x",
        ".DS_Store",
        "*/.DS_Store",
        "**/.DS_Store",
      ],
      { cwd: SOURCE_HOME }
    );
    p.on("error", reject);
    p.on("close", async (code) => {
      if (code !== 0) return reject(new Error(`zip 실패 (exit ${code})`));
      try {
        const buf = await fs.promises.readFile(tmpZip);
        fs.promises.unlink(tmpZip).catch(() => {});
        resolve(buf);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function GET() {
  try {
    const buf = await buildZip();
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="qa-cowork-assets.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`zip 빌드 실패: ${msg}`, { status: 500 });
  }
}
