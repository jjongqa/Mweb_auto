import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export const dynamic = "force-dynamic";

// 워커 소스 폴더. env 로 override 가능.
const WORKER_SRC = process.env.KURLY_WORKER_PATH
  ? path.resolve(process.env.KURLY_WORKER_PATH)
  : path.resolve(process.cwd(), "external-worker"); // git 정식본(어드민 레포 안). KURLY_WORKER_PATH 로 override.

// 워커 설치 폴더명(install.sh 의 INSTALL_DIR ~/kurly-qa-worker-v1 과 결합) — 소스 폴더명과 무관하게 고정.
const ZIP_FOLDER = "kurly-qa-worker-v1";

const SKIP = new Set(["node_modules", ".env", ".env.local", ".git", ".DS_Store"]);

function buildZip(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(WORKER_SRC)) {
      return reject(new Error(`워커 소스 폴더를 찾을 수 없음: ${WORKER_SRC}`));
    }
    // 소스 폴더명(external-worker 등)과 무관하게 항상 ZIP_FOLDER(kurly-qa-worker-v1)로 스테이징 후 zip.
    // → install.sh 가 $HOME/kurly-qa-worker-v1 로 풀고 그 폴더로 cd 하므로 내부 폴더명이 고정돼야 함.
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "kqw-stage-"));
    const staged = path.join(stage, ZIP_FOLDER);
    try {
      fs.cpSync(WORKER_SRC, staged, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
    } catch (err) {
      fs.rm(stage, { recursive: true, force: true }, () => {});
      return reject(err);
    }
    const tmpZip = path.join(os.tmpdir(), `kurly-qa-worker-${Date.now()}.zip`);
    const p = spawn("zip", ["-r", "-q", tmpZip, ZIP_FOLDER], { cwd: stage });
    p.on("error", (e) => { fs.rm(stage, { recursive: true, force: true }, () => {}); reject(e); });
    p.on("close", async (code) => {
      fs.rm(stage, { recursive: true, force: true }, () => {});
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
        "Content-Disposition": `attachment; filename="kurly-qa-worker-v1.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`zip 빌드 실패: ${msg}`, { status: 500 });
  }
}
