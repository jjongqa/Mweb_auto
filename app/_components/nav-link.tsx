"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 헤더 네비 링크 — 현재 경로면 KPDS 퍼플로 하이라이트(active).
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded-[8px] px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-kurly-50 text-kurly-500"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      }`}
    >
      {children}
    </Link>
  );
}
