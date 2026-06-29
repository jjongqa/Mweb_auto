"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type FailItem = {
  no: string;
  priority: string;
  title: string;
  testStep: string;
  expected: string;
  actual: string;
  failReason: string;
  notes: string;
  screenshot: string;
};
export type RegisteredIssue = { id: number; tc_no: string | null; issue_key: string; issue_url: string; summary: string | null; created_at: string };

export function JiraIssuesPanel({
  jobId,
  domain,
  qaEnv,
  epicKey,
  taskName,
  failItems,
  registered: initialRegistered,
  hasSettings,
  jiraHost,
}: {
  jobId: string;
  domain: string;
  qaEnv: string;
  epicKey: string | null;
  taskName: string | null;
  failItems: FailItem[];
  registered: RegisteredIssue[];
  hasSettings: boolean;
  jiraHost: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(failItems.map(f => f.no)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [registered, setRegistered] = useState(initialRegistered);

  const alreadyKeys = new Set(registered.map(r => r.tc_no).filter(Boolean));
  const pending = failItems.filter(f => !alreadyKeys.has(f.no));

  if (!hasSettings) {
    return (
      <div className="card border-l-4 border-l-amber-400 p-5">
        <h2 className="text-sm font-semibold text-amber-700">🪲 Jira 자동 등록</h2>
        <p className="mt-2 text-xs text-amber-800">
          Jira 설정이 없습니다. <Link href="/jira-settings" className="underline">/jira-settings</Link> 에서 먼저 host/이메일/토큰 등록하세요.
        </p>
      </div>
    );
  }

  if (failItems.length === 0 && registered.length === 0) return null;

  function toggle(no: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(no)) next.delete(no); else next.add(no);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === pending.length) setSelected(new Set());
    else setSelected(new Set(pending.map(f => f.no)));
  }

  // 사용자 사양: Summary = "[AI-Test FAIL] TC-{No}: {TC Title}"
  function buildSummary(f: FailItem): string {
    return `[AI-Test FAIL] TC-${f.no}: ${f.title}`.slice(0, 250);
  }

  // 사용자 사양: Description = TC No, Priority, TC Title, Test Step, Expected Result, Actual Result, Fail Reason, 스크린샷 첨부 참고
  function buildDescription(f: FailItem): string {
    return [
      `## TC 정보`,
      `- **TC No**: ${f.no}`,
      `- **Priority**: ${f.priority || "-"}`,
      `- **TC Title**: ${f.title}`,
      ``,
      `## Test Step`,
      f.testStep || "-",
      ``,
      `## Expected Result`,
      f.expected || "-",
      ``,
      `## Actual Result`,
      f.actual || "-",
      ``,
      `## Fail Reason`,
      f.failReason || "-",
      ``,
      `## 스크린샷`,
      f.screenshot ? `첨부 참고: ${f.screenshot}` : "(없음)",
      ``,
      `---`,
      `## 테스트 정보`,
      `- 테스트 ID: ${jobId}`,
      `- 도메인: ${domain} / 환경: ${qaEnv}`,
      taskName ? `- 과제명: ${taskName}` : "",
      epicKey ? `- 에픽: ${epicKey}` : "",
      ``,
      `> 자동 등록된 이슈입니다 (kurly-qa-admin / AI-Test).`,
    ].filter(Boolean).join("\n");
  }

  // 사용자 사양: P1→Highest, P2→Medium, P3→Low
  function mapPriority(p: string): string | undefined {
    const up = p.toUpperCase().trim();
    if (up.startsWith("P1")) return "Highest";
    if (up.startsWith("P2")) return "Medium";
    if (up.startsWith("P3")) return "Low";
    return undefined;
  }

  async function submitSelected() {
    setError(""); setInfo("");
    const items = pending.filter(f => selected.has(f.no)).map(f => ({
      tc_no: f.no,
      summary: buildSummary(f),
      description: buildDescription(f),
      priority: mapPriority(f.priority),  // P1→Highest 등
    }));
    if (items.length === 0) { setError("선택된 항목 없음"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/jira/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, items }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error || "등록 실패"); return; }
      const ok = json.results.filter((r: any) => r.ok);
      const fail = json.results.filter((r: any) => !r.ok);
      setInfo(`✓ ${ok.length}건 등록 완료${fail.length ? `, ${fail.length}건 실패` : ""}`);
      if (fail.length > 0) {
        setError(fail.map((r: any) => `TC-${r.tc_no}: ${r.error}`).join(" | "));
      }
      // refresh
      const listRes = await fetch(`/api/jira/issues?job_id=${jobId}`);
      const listJson = await listRes.json();
      setRegistered(listJson.issues || []);
      setSelected(new Set());
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card border-l-4 border-l-rose-400 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-rose-700">
          🪲 Jira 이슈 등록 <span className="ml-1 text-xs text-neutral-400">(FAIL {failItems.length}건 · 등록 {registered.length}건)</span>
        </h2>
        {pending.length > 0 && (
          <button
            onClick={() => setOpen(!open)}
            className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
          >
            {open ? "닫기" : `+ Jira 등록 (${pending.length}건 미등록)`}
          </button>
        )}
      </div>

      {open && pending.length > 0 && (
        <div className="mt-4 space-y-3">
          {error && <div className="rounded border-l-4 border-rose-400 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>}
          {info && <div className="rounded border-l-4 border-emerald-400 bg-emerald-50 p-2 text-xs text-emerald-800">{info}</div>}

          <div className="flex items-center justify-between text-xs">
            <label className="cursor-pointer">
              <input
                type="checkbox"
                checked={selected.size === pending.length && pending.length > 0}
                onChange={toggleAll}
                className="mr-2"
              />
              전체 선택 ({selected.size}/{pending.length})
            </label>
            <button
              onClick={submitSelected}
              disabled={submitting || selected.size === 0}
              className="rounded-md bg-kurly-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-kurly-600 disabled:opacity-50"
            >
              {submitting ? "등록 중..." : `🚀 선택 ${selected.size}건 Jira 등록`}
            </button>
          </div>

          <div className="overflow-x-auto rounded border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-left text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="w-10 px-2 py-1.5"></th>
                  <th className="w-12 px-2 py-1.5">No</th>
                  <th className="w-16 px-2 py-1.5">Priority</th>
                  <th className="px-2 py-1.5">제목</th>
                  <th className="px-2 py-1.5">Fail Reason</th>
                  <th className="px-2 py-1.5">Screenshot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {pending.map((f) => (
                  <tr key={f.no} className="hover:bg-neutral-50">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(f.no)}
                        onChange={() => toggle(f.no)}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-mono">{f.no}</td>
                    <td className="px-2 py-1.5 font-mono">{f.priority || "-"}<span className="ml-1 text-[10px] text-neutral-400">→{mapPriority(f.priority) || "?"}</span></td>
                    <td className="px-2 py-1.5">{f.title}</td>
                    <td className="px-2 py-1.5 text-neutral-600 max-w-[300px] truncate">{f.failReason || f.notes || "-"}</td>
                    <td className="px-2 py-1.5 text-neutral-600">{f.screenshot || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {epicKey && (
            <div className="text-[11px] text-neutral-500">
              에픽 <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono">{epicKey}</code> 자식으로 자동 연결됩니다.
            </div>
          )}
        </div>
      )}

      {registered.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-neutral-600 mb-1">등록된 이슈 ({registered.length})</div>
          <ul className="space-y-1 text-xs">
            {registered.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="text-neutral-400 font-mono">{r.tc_no ? `TC-${r.tc_no}` : "?"}</span>
                <a
                  href={r.issue_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-rose-700 hover:underline"
                >
                  {r.issue_key}
                </a>
                <span className="text-neutral-700 truncate">{r.summary}</span>
                <span className="ml-auto text-neutral-400">{r.created_at}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
