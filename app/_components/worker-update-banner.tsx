"use client";

// 본인 PC(is_self) 워커가 최신보다 구버전이면 메인페이지에 업데이트 배너.
// - 구버전 워커 운영자에게만 보임(is_self + version < latest, 또는 버전 미보고=구 v1.8)
// - 최신 워커만 가진 사람에겐 안 보임
// 30초마다 재확인 → 업데이트하면 자동으로 사라짐.

import Link from "next/link";
import { useEffect, useState } from "react";

function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

// 외부 워커 업데이트 대상 판정. 빌트인 워커(version='builtin' 등 비-semver)는 어드민 내장이라 제외.
// 버전 미보고(null/빈값)=구 외부워커 → 대상. semver 면 latest 와 비교.
function isOutdated(v: string | null | undefined, latest: string): boolean {
  if (!v) return true;
  if (!/^\d+\.\d+/.test(v)) return false; // 'builtin' 등 → 외부 워커 아님 → 제외
  return cmpVer(v, latest) < 0;
}

type Outdated = { name: string; version: string | null };

export function WorkerUpdateBanner() {
  const [info, setInfo] = useState<{ outdated: Outdated[]; latest: string } | null>(null);

  useEffect(() => {
    let cancel = false;
    async function check() {
      try {
        const [listRes, metaRes] = await Promise.all([fetch("/api/workers/list"), fetch("/api/workers/meta")]);
        const list = await listRes.json();
        const meta = await metaRes.json();
        const latest: string = (meta && meta.version) || "";
        if (!latest) { if (!cancel) setInfo(null); return; }
        // 본인 PC + 현재 켜져있는(online/busy) 워커만 — 꺼진(offline) 워커는 지금 돌고 있지 않으니 업데이트 알림 대상 아님.
        const selfs = (list.workers || []).filter((w: { is_self?: boolean; status?: string }) => w.is_self && w.status !== "offline");
        // 이미 '최신 외부 워커'를 켜둔 사람에겐 배너 숨김 — 재설치(업데이트)하면 옛 워커가 잠깐 좀비로 같이 떠있어도
        // 다시 나타나지 않게. (builtin 등 비-semver 는 '외부 워커' 판정에서 제외)
        const hasLatestExternal = selfs.some((w: { version?: string | null }) =>
          /^\d+\.\d+/.test(w.version || "") && cmpVer(w.version || "0", latest) >= 0);
        const outdated: Outdated[] = hasLatestExternal ? [] : selfs
          .filter((w: { version?: string | null }) => isOutdated(w.version, latest))
          .map((w: { name: string; label?: string | null; version?: string | null }) => ({ name: w.label || w.name, version: w.version || null }));
        if (!cancel) setInfo(outdated.length ? { outdated, latest } : null);
      } catch { if (!cancel) setInfo(null); }
    }
    check();
    const t = setInterval(check, 30000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  if (!info) return null;
  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-amber-900">
          <div className="font-semibold">⚠️ 워커 업데이트 필요 — 최신 v{info.latest}</div>
          <div className="mt-1 text-amber-800">
            본인 PC 워커가 구버전입니다: {info.outdated.map((w) => `${w.name} (${w.version ? "v" + w.version : "구버전"})`).join(", ")}
            <br />
            재설치하면 Drive 최신 프롬프트·기능(기능테스트 inline 등)이 반영됩니다.
          </div>
        </div>
        <Link href="/workers" className="shrink-0 self-center rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600">
          재설치 명령 보기 →
        </Link>
      </div>
    </div>
  );
}
