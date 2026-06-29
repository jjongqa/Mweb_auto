import path from "node:path";
import fs from "node:fs";

export const dynamic = "force-dynamic";

// 워커 소스 폴더 — /api/workers/download 와 동일 경로 규칙
const WORKER_SRC = process.env.KURLY_WORKER_PATH
  ? path.resolve(process.env.KURLY_WORKER_PATH)
  : path.resolve(process.cwd(), "external-worker"); // git 정식본(어드민 레포 안). KURLY_WORKER_PATH 로 override.

/**
 * 워커 패키지 메타 — 어드민 install/재설치 페이지에서 자동 표시용.
 * 워커 코드 패치할 때마다:
 *  1) package.json 의 version 을 bump
 *  2) CHANGELOG.md 상단에 새 항목 추가
 * 만 하면 이 endpoint 가 자동으로 반환 → install 페이지에 노출.
 */
export async function GET() {
  const result: {
    ok: boolean;
    version: string | null;
    description: string | null;
    changelog: string | null;
    mtime: string | null;
    error?: string;
  } = {
    ok: false,
    version: null,
    description: null,
    changelog: null,
    mtime: null,
  };

  try {
    const pkgPath = path.join(WORKER_SRC, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      result.version = String(pkg.version ?? "");
      result.description = String(pkg.description ?? "");
      const stat = fs.statSync(pkgPath);
      result.mtime = stat.mtime.toISOString();
    }
    const changelogPath = path.join(WORKER_SRC, "CHANGELOG.md");
    if (fs.existsSync(changelogPath)) {
      result.changelog = fs.readFileSync(changelogPath, "utf-8");
    }
    result.ok = true;
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { ...result, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
