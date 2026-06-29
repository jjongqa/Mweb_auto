"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { copyToClipboard } from "@/lib/clipboard";

const RESTART_CMD = "cd ~/kurly-qa-worker-v1 && npm start";

type WorkerOption = {
  name: string;
  status: string;
  status_label: string;
  is_self?: boolean;
};

// 본인 PC 워커 상태를 자동 감지해서 미설치/offline 사용자에게 가이드 안내.
// 폼 상단에 노출. dismiss 가능(세션 한정).
export function WorkerStatusBanner() {
  const [state, setState] = useState<"loading" | "ok" | "offline" | "missing">("loading");
  const [selfName, setSelfName] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyCmd() {
    const ok = await copyToClipboard(RESTART_CMD);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      alert("복사가 안 되네요. 명령어를 마우스로 드래그해서 직접 복사해주세요.");
    }
  }

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const res = await fetch("/api/workers/list");
        const json = await res.json();
        if (cancel) return;
        const list: WorkerOption[] = json.workers || [];
        const selfs = list.filter((w) => w.is_self);
        if (selfs.length === 0) {
          setState("missing");
          setSelfName(null);
        } else {
          // 본인 워커가 하나라도 켜져 있으면(대기 중 OR 실행 중) OK — 다른 자기 워커가 꺼져 있어도 나그 안 함.
          const up = selfs.find((w) => w.status === "online" || w.status === "busy");
          if (up) {
            setState("ok");
            setSelfName(up.name);
          } else {
            setState("offline");
            setSelfName(selfs[0].name);
          }
        }
      } catch {
        if (!cancel) setState("loading");
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  if (dismissed) return null;
  if (state === "loading" || state === "ok") return null;

  if (state === "missing") {
    return (
      <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="font-semibold text-amber-900">⚠️ 본인 PC 워커가 없습니다</div>
            <p className="mt-1 text-xs text-amber-800">
              테스트를 본인 PC 에서 처리하려면 워커가 필요해요. (워커 "(자동)" 으로 두면 종관님 PC 가 처리하니까 그것도 OK)
            </p>
            <div className="mt-2 flex gap-2">
              <Link
                href="/workers/install"
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                📖 워커 설치 가이드 보기
              </Link>
              <Link href="/guide" className="rounded border border-amber-400 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100">
                전체 가이드 →
              </Link>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-amber-400 hover:text-amber-700 text-lg leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  // offline
  return (
    <div className="rounded-lg border-l-4 border-blue-400 bg-blue-50 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-semibold text-blue-900">
            💤 본인 PC 워커 <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs text-blue-700">{selfName}</code> 가 꺼져있어요
          </div>
          <p className="mt-1 text-xs text-blue-800">
            Terminal 에서 아래 명령으로 다시 시작:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-neutral-900 px-2 py-1 font-mono text-[11px] text-neutral-100">
              {RESTART_CMD}
            </code>
            <button
              onClick={copyCmd}
              className="rounded bg-blue-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
            >
              {copied ? "✓ 복사됨" : "복사"}
            </button>
          </div>
          <p className="mt-2 text-xs text-blue-700">
            (워커 "(자동)" 으로 두고 종관님 PC 에 맡기는 것도 가능)
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-blue-400 hover:text-blue-700 text-lg leading-none"
          aria-label="닫기"
        >
          ×
        </button>
      </div>
    </div>
  );
}
