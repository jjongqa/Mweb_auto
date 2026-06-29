"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const ITEMS = [
  { href: "/qa-design", label: "🔬 QA설계" },
  { href: "/tc-gen", label: "🧬 TC생성" },
  { href: "/upload", label: "📋 기능테스트" },
  { href: "/adhoc", label: "🔍 애드혹" },
];

// 상단 "AI 테스트" 대메뉴 — 클릭 시 4개 소메뉴 드롭다운. 현재 경로가 소메뉴면 활성 표시.
export function AiTestMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = ITEMS.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  // 경로 이동하면 닫기
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`btn-ghost whitespace-nowrap ${active ? "bg-kurly-50 font-semibold text-kurly-600" : ""}`}
      >
        🤖 AI 테스트 <span className="ml-0.5 text-[10px] text-neutral-400">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 min-w-[160px] overflow-hidden rounded-[12px] border border-neutral-200 bg-white py-1 shadow-kpds3">
          {ITEMS.map((i) => {
            const on = pathname === i.href || pathname.startsWith(i.href + "/");
            return (
              <Link
                key={i.href}
                href={i.href}
                className={`block whitespace-nowrap px-3 py-2 text-sm hover:bg-neutral-50 ${on ? "font-medium text-kurly-600" : "text-neutral-700"}`}
              >
                {i.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
