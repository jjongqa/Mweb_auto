import Link from "next/link";
import path from "node:path";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { getQaCoworkHome, ensureWithinHome } from "@/lib/prompt-manager";

export const dynamic = "force-dynamic";

export default async function PromptViewPage({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  const { path: relPath } = await searchParams;
  if (!relPath) notFound();
  if (!relPath.endsWith(".md")) notFound();

  // 경로 검증은 lib/prompt-manager 의 realpath 하드닝 버전 재사용 (심볼릭 링크 우회 차단).
  const home = getQaCoworkHome();
  const target = path.resolve(path.resolve(home), relPath);
  try {
    ensureWithinHome(target, home);
  } catch {
    notFound();
  }
  if (!fs.existsSync(target)) notFound();
  if (!fs.statSync(target).isFile()) notFound();

  const content = fs.readFileSync(target, "utf-8");

  return (
    <div className="space-y-4">
      <Link href="/prompts" className="inline-block text-sm text-kurly-500 hover:underline">
        ← 프롬프트 목록
      </Link>
      <div>
        <div className="text-xs text-neutral-500">파일</div>
        <h1 className="font-mono text-lg">{relPath}</h1>
        <p className="mt-1 text-xs text-neutral-500">{target}</p>
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
          {content.split("\n").length} 줄 · {(content.length / 1024).toFixed(1)} KB · 읽기 전용
        </div>
        <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-neutral-800">
{content}
        </pre>
      </div>
    </div>
  );
}
