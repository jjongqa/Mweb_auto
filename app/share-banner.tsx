"use client";

import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

export function ShareUrlBanner() {
  const [ips, setIps] = useState<{ name: string; address: string }[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    // 혼자 쓰는 로컬 환경이 기본. 팀 공유가 필요할 때만 NEXT_PUBLIC_SHOW_SHARE_URL=true 로 켠다.
    if (process.env.NEXT_PUBLIC_SHOW_SHARE_URL !== "true") {
      setHidden(true);
      return;
    }
    // 자기 자신이 localhost로 보고 있을 때만 안내 (이미 다른 사람이 IP로 들어왔다면 굳이 보여줄 필요 X)
    if (typeof window === "undefined") return;
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setHidden(true);
      return;
    }
    fetch("/api/network").then((r) => r.json()).then((d) => setIps(d.candidates ?? []));
  }, []);

  if (hidden || !ips) return null;
  if (ips.length === 0) {
    return (
      <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>공유용 URL 안내:</strong>{" "}
        외부 네트워크 인터페이스를 못 찾았어요. 같은 와이파이의 다른 사람은 접속 못 해요.
      </div>
    );
  }

  async function copy(text: string) {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } else {
      alert("복사 실패 — 직접 드래그해서 복사해주세요");
    }
  }

  return (
    <div className="card border-blue-200 bg-blue-50 p-4 text-sm">
      <div className="flex items-start gap-3">
        <span className="text-lg">📡</span>
        <div className="flex-1">
          <div className="font-semibold text-blue-900">팀원에게 공유할 URL</div>
          <p className="mt-1 text-xs text-blue-800">
            같은 사내 와이파이의 팀원에게 아래 URL을 공유하세요. (맥북이 켜져있는 동안만 접속 가능)
          </p>
          <div className="mt-3 space-y-1.5">
            {ips.map((ip) => {
              const url = `http://${ip.address}:3000`;
              return (
                <div key={ip.address} className="flex items-center gap-2">
                  <span className="font-mono text-sm text-blue-900">{url}</span>
                  <span className="text-[10px] text-blue-500">({ip.name})</span>
                  <button
                    onClick={() => copy(url)}
                    className="rounded border border-blue-300 bg-white px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-100"
                  >
                    {copied === url ? "✓ 복사됨" : "복사"}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-blue-700">
            ⚠ 인증 없음 — 시연/회의 끝나면 워커 끄기 (Ctrl+C)
          </div>
        </div>
      </div>
    </div>
  );
}
