import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { AiTestMenu } from "./_components/ai-test-menu";
import { NavLink } from "./_components/nav-link";

export const metadata: Metadata = {
  title: "jjongqa V2",
  description: "AI-powered TC execution platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 shadow-kpds1 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
              <span className="text-lg font-extrabold leading-none text-kurly-500">jjongqa V2</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <AiTestMenu />
              <span className="mx-1 h-4 w-px bg-neutral-200" />
              <NavLink href="/test-data">🧪 테스트 데이터</NavLink>
              <NavLink href="/history">🕘 히스토리</NavLink>
              <NavLink href="/suites">📁 스위트</NavLink>
              <NavLink href="/jira-settings">🪲 Jira</NavLink>
              <NavLink href="/workers">🖥️ 워커</NavLink>
              <NavLink href="/agents">🎮 에이전트</NavLink>
              <NavLink href="/prompts">📝 프롬프트</NavLink>
              <Link
                href="/guide"
                className="ml-2 shrink-0 whitespace-nowrap rounded-[8px] border border-kurly-500 bg-white px-3 py-1.5 font-semibold text-kurly-500 transition-colors hover:bg-kurly-500 hover:text-white"
                title="처음 사용하시나요? 사용법 가이드 모음"
              >
                📖 가이드
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-neutral-400">
          로컬 개발 환경 · Claude Code + Playwright/Mobile MCP
        </footer>
      </body>
    </html>
  );
}
