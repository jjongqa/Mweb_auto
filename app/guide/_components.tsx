// 가이드 페이지 공통 UI 컴포넌트 — 초보자 모드 톤 일관 유지

import React from "react";

export function GuideShell({
  title,
  subtitle,
  meta,
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-neutral-600">{subtitle}</p>}
        {meta && (
          <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
            {meta}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-5">{children}</div>;
}

export function StepCard({
  num,
  title,
  children,
}: {
  num: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kurly-500 text-base font-bold text-white">
          {num}
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="mt-3 pl-12">{children}</div>
    </div>
  );
}

export function Howto({ children }: { children: React.ReactNode }) {
  return (
    <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-neutral-700">
      {children}
    </ol>
  );
}

export function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-block min-w-[1.5em] rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-center font-mono text-[11px] font-medium text-neutral-700 shadow-sm">
      {children}
    </kbd>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

export function CommandBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg bg-neutral-900 p-3 font-mono text-sm text-neutral-100">
      {children}
    </div>
  );
}

export function Preview({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <pre className="mt-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11px] leading-relaxed text-neutral-700">
        {children}
      </pre>
    </div>
  );
}

export function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 open:bg-white">
      <summary className="cursor-pointer text-sm font-medium text-neutral-800">{q}</summary>
      <div className="mt-2 pl-1 text-xs text-neutral-600">{children}</div>
    </details>
  );
}

export function Note({
  variant = "info",
  children,
  title,
}: {
  variant?: "info" | "warn" | "error" | "success";
  children: React.ReactNode;
  title?: string;
}) {
  const styles = {
    info: "border-l-blue-400 bg-blue-50 text-blue-900",
    warn: "border-l-amber-400 bg-amber-50 text-amber-900",
    error: "border-l-rose-400 bg-rose-50 text-rose-900",
    success: "border-l-emerald-400 bg-emerald-50 text-emerald-900",
  };
  return (
    <div className={`mt-3 rounded border-l-4 p-3 text-xs ${styles[variant]}`}>
      {title && <strong className="block">{title}</strong>}
      <div className={title ? "mt-1.5" : ""}>{children}</div>
    </div>
  );
}
