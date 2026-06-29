import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export const dynamic = "force-dynamic";

// 하네스(커머스+물류 TC생성 파이프라인) 클론을 zip 으로 서빙 — 외부 워커가 install 시 받아 KURLY_HARNESS_PATH 로 사용.
// 실행에 필요한 것만 포함(.claude=스킬/에이전트/registry/어댑터, references=표준TC사전+정답파일, CLAUDE.md).
// _workspace_*/_inbox/.git/node_modules 등 런타임·대용량은 include 목록에서 자연 제외됨.
const HARNESS_ROOT = process.env.KURLY_HARNESS_PATH ? path.resolve(process.env.KURLY_HARNESS_PATH) : "";
const INCLUDE_PATHS = [".claude", "references", "CLAUDE.md", "README.md"];

function buildZip(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!HARNESS_ROOT || !fs.existsSync(HARNESS_ROOT)) {
      return reject(new Error(`하네스 경로 없음 — 어드민에 KURLY_HARNESS_PATH 설정 필요: ${HARNESS_ROOT || "(미설정)"}`));
    }
    const present = INCLUDE_PATHS.filter((p) => fs.existsSync(path.join(HARNESS_ROOT, p)));
    if (!present.includes(".claude") || !present.includes("references")) {
      return reject(new Error(`하네스 필수 폴더(.claude/references) 누락: ${HARNESS_ROOT}`));
    }
    const tmpZip = path.join(os.tmpdir(), `harness-${Date.now()}.zip`);
    const p = spawn(
      "zip",
      ["-r", "-q", tmpZip, ...present, "-x", ".DS_Store", "*/.DS_Store", "**/.DS_Store"],
      { cwd: HARNESS_ROOT }
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
        "Content-Disposition": `attachment; filename="kurly-qa-harness.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`zip 빌드 실패: ${msg}`, { status: 500 });
  }
}
