"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { copyToClipboard } from "@/lib/clipboard";

type WorkerMeta = {
  ok: boolean;
  version: string | null;
  description: string | null;
  changelog: string | null;
  mtime: string | null;
};

export default function WorkerUpdatePage() {
  const [adminUrl, setAdminUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [meta, setMeta] = useState<WorkerMeta | null>(null);

  useEffect(() => {
    setAdminUrl(window.location.origin);
    fetch("/api/workers/meta")
      .then((r) => r.json())
      .then((j) => setMeta(j))
      .catch(() => setMeta(null));
  }, []);

  const oneLiner = adminUrl
    ? `curl -fsSL ${adminUrl}/api/workers/install.sh | bash`
    : "...";

  const copy = async () => {
    const ok = await copyToClipboard(oneLiner);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      alert("복사가 안 되네요. 명령어를 마우스로 드래그해서 직접 복사해주세요.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🔄 워커 업데이트</h1>
        <p className="mt-2 text-sm text-neutral-600">
          이미 워커를 설치하신 분 전용 — 어드민에 새 패치가 반영되면 워커도 함께 업데이트.
        </p>
      </div>

      <div className="card border-l-4 border-l-emerald-400 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-emerald-700">한 줄 명령으로 재설치</h2>
          {meta?.version && (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              현재 패키지 버전: v{meta.version}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-600">
          아래 명령을 Terminal 에 붙여넣으면 <strong>기존 설치 백업 → 최신 코드로 재설치 → 자동 실행</strong>까지 한 번에 처리됩니다.
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-neutral-900 p-3">
          <code className="flex-1 break-all font-mono text-xs text-emerald-300">{oneLiner}</code>
          <button
            onClick={copy}
            className="shrink-0 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
          >
            {copied ? "✓ 복사됨" : "복사"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          기존 <code className="rounded bg-neutral-100 px-1 py-0.5">~/kurly-qa-worker-v1</code> 폴더는 자동으로{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5">.bak.YYYYMMDD-HHMMSS</code> 로 백업됩니다.{" "}
          실행 중인 워커가 있으면 먼저 종료 후 실행하세요 (<code className="rounded bg-neutral-100 px-1 py-0.5">Ctrl+C</code> 또는 워커 터미널 닫기).
          {meta?.mtime && (
            <> · 최신 패치 시각: <span className="font-mono">{new Date(meta.mtime).toLocaleString("ko-KR")}</span></>
          )}
        </p>
      </div>

      {meta?.changelog && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-neutral-700">📝 변경 내역 (CHANGELOG)</h2>
          <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 font-mono text-[11px] leading-relaxed text-neutral-700">
{meta.changelog}
          </pre>
        </div>
      )}

      <div className="card p-4 text-xs text-neutral-500">
        처음 설치하시나요? →{" "}
        <Link href="/workers/install" className="text-kurly-500 underline">
          /workers/install
        </Link>
      </div>
    </div>
  );
}
