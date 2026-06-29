"use client";

import { useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

type Result = {
  index: number;
  memberId: string;
  email: string;
  password: string;
  name: string;
  ok: boolean;
  status?: number;
  user_id?: string | number | null;
  error?: string;
  membershipOk?: boolean;
  membershipError?: string;
  membershipTicketId?: string | number | null;
};

export function AccountCreateForm() {
  const [count, setCount] = useState(10);
  const [idPrefix, setIdPrefix] = useState("kurly");
  const [namePrefix, setNamePrefix] = useState("테스트유저");
  const [emailDomain, setEmailDomain] = useState("kurlytest.com");
  const [password, setPassword] = useState("TestPwd1234!");
  const [joinInflowType, setJoinInflowType] = useState("MOBILE_WEB");
  const [concurrency, setConcurrency] = useState(10);
  const [subscribeMembership, setSubscribeMembership] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function submit() {
    setError("");
    setResults([]);
    setProgress({ done: 0, total: count });
    setRunning(true);
    setElapsedMs(null);
    const startTs = Date.now();

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/test-data/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, idPrefix, namePrefix, emailDomain, password, joinInflowType, concurrency, subscribeMembership }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        setError(`요청 실패: ${res.status} ${res.statusText}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const live: Result[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE 파싱 — 빈 줄 단위 chunk
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const lines = chunk.split("\n");
          let type = "message"; let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data = line.slice(5).trim();
          }
          if (!data) continue;
          try {
            const payload = JSON.parse(data);
            if (type === "progress") {
              live[payload.latest.index - 1] = payload.latest;
              setResults([...live]);
              setProgress({ done: payload.done, total: payload.total });
            } else if (type === "done") {
              setResults(payload.results);
              setProgress({ done: payload.results.length, total: payload.results.length });
              setElapsedMs(Date.now() - startTs);
            } else if (type === "error") {
              setError(payload.message || "처리 실패");
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function downloadCsv() {
    const header = "No,memberId,email,password,name,result,status,user_id,error";
    const rows = results.map((r) =>
      [
        r.index,
        r.memberId,
        r.email,
        r.password,
        r.name,
        r.ok ? "OK" : "FAIL",
        r.status ?? "",
        r.user_id ?? "",
        (r.error ?? "").replace(/[\r\n,]/g, " "),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    );
    const csv = "﻿" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accounts_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyOne(r: Result) {
    const text = `${r.email}\t${r.password}\t${r.user_id ?? ""}`;
    await copyToClipboard(text);
  }

  const okCount = results.filter((r) => r && r.ok).length;
  const failCount = results.filter((r) => r && !r.ok).length;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className="label">생성 개수 *</label>
            <input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              className="input"
              disabled={running}
            />
            <p className="mt-0.5 text-[11px] text-neutral-400">1 ~ 500</p>
          </div>
          <div>
            <label className="label">동시 처리 수</label>
            <input
              type="number"
              min={1}
              max={20}
              value={concurrency}
              onChange={(e) => setConcurrency(Math.max(1, Math.min(20, Number(e.target.value) || 10)))}
              className="input"
              disabled={running}
            />
            <p className="mt-0.5 text-[11px] text-neutral-400">1 ~ 20 · stg mock 한계로 같은 번호는 자동 직렬</p>
          </div>
          <div>
            <label className="label">가입 경로</label>
            <select
              value={joinInflowType}
              onChange={(e) => setJoinInflowType(e.target.value)}
              className="input"
              disabled={running}
            >
              <option value="MOBILE_WEB">MOBILE_WEB</option>
              <option value="PC_WEB">PC_WEB</option>
              <option value="ANDROID">ANDROID</option>
              <option value="IOS">IOS</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">아이디 prefix</label>
            <input
              value={idPrefix}
              onChange={(e) => setIdPrefix(e.target.value)}
              maxLength={6}
              className="input font-mono"
              disabled={running}
              placeholder="kurly (영문+숫자만, 6자↓)"
            />
            <p className="mt-0.5 text-[11px] text-neutral-400">→ {idPrefix}abc1, {idPrefix}abc2 ... (memberId 최대 12자)</p>
          </div>
          <div>
            <label className="label">이름 prefix</label>
            <input
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              className="input"
              disabled={running}
              placeholder="테스트유저"
            />
          </div>
          <div>
            <label className="label">이메일 도메인</label>
            <input
              value={emailDomain}
              onChange={(e) => setEmailDomain(e.target.value)}
              className="input font-mono"
              disabled={running}
              placeholder="kurlytest.com"
            />
          </div>
          <div>
            <label className="label">공통 비밀번호</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input font-mono"
              disabled={running}
            />
          </div>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={subscribeMembership}
              onChange={(e) => setSubscribeMembership(e.target.checked)}
              disabled={running}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="font-medium text-amber-900">🎫 가입 후 멤버스 무료이용권 자동 구독</div>
              <p className="mt-0.5 text-[11px] text-amber-700/80 leading-relaxed">
                각 계정 생성 직후 <span className="font-mono">POST /membership-internal/v1/admin/subscriptions/tickets/vip/subscribe</span> 자동 호출.
                <br />
                기본값: 1개월 무료이용권 (productCd=KM0001, ticketMetaId=3, benefitOptionId=1) · 이번 달 1일~말일.
              </p>
            </div>
          </label>
        </div>

        <div className="flex items-center gap-2 pt-2">
          {!running ? (
            <button
              onClick={submit}
              className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              👤 {count}건 생성 시작{subscribeMembership ? " + 멤버스 구독" : ""}
            </button>
          ) : (
            <button
              onClick={cancel}
              className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
            >
              ⏹ 중단
            </button>
          )}
          {results.length > 0 && !running && (
            <button
              onClick={downloadCsv}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              📥 CSV 다운로드
            </button>
          )}
        </div>
        {error && (
          <div className="rounded border-l-4 border-rose-400 bg-rose-50 p-2 text-xs text-rose-800">⚠ {error}</div>
        )}
      </div>

      {(running || results.length > 0) && (
        <div className="card p-5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500">진행률</span>
            <span className="font-mono">
              {progress.done} / {progress.total} ({pct}%)
              {elapsedMs !== null && ` · ${(elapsedMs / 1000).toFixed(1)}초`}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md border border-neutral-200 py-2">
              <div className="text-neutral-500">완료</div>
              <div className="mt-0.5 font-semibold">{progress.done}</div>
            </div>
            <div className="rounded-md border border-neutral-200 py-2">
              <div className="text-neutral-500">성공</div>
              <div className="mt-0.5 font-semibold text-emerald-600">{okCount}</div>
            </div>
            <div className="rounded-md border border-neutral-200 py-2">
              <div className="text-neutral-500">실패</div>
              <div className="mt-0.5 font-semibold text-rose-600">{failCount}</div>
            </div>
          </div>

          {results.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-left text-[10px] uppercase text-neutral-500">
                  <tr>
                    <th className="px-2 py-1.5 w-12">No</th>
                    <th className="px-2 py-1.5">memberId</th>
                    <th className="px-2 py-1.5">email</th>
                    <th className="px-2 py-1.5">password</th>
                    <th className="px-2 py-1.5">result</th>
                    <th className="px-2 py-1.5">user_id</th>
                    {subscribeMembership && <th className="px-2 py-1.5">멤버스</th>}
                    <th className="px-2 py-1.5">error</th>
                    <th className="px-2 py-1.5 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {results.filter(Boolean).map((r) => (
                    <tr key={r.index} className={r.ok ? "" : "bg-rose-50"}>
                      <td className="px-2 py-1.5 font-mono">{r.index}</td>
                      <td className="px-2 py-1.5 font-mono">{r.memberId}</td>
                      <td className="px-2 py-1.5 font-mono text-neutral-700">{r.email}</td>
                      <td className="px-2 py-1.5 font-mono text-neutral-500">{r.password}</td>
                      <td className="px-2 py-1.5">
                        {r.ok ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OK</span>
                        ) : (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">FAIL</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-neutral-700">{r.user_id ?? "-"}</td>
                      {subscribeMembership && (
                        <td className="px-2 py-1.5 text-[11px]">
                          {r.ok && r.membershipOk
                            ? <span className="text-emerald-600">✅ ticketId={r.membershipTicketId ?? "?"}</span>
                            : r.ok && r.membershipOk === false
                              ? <span className="text-amber-700" title={r.membershipError ?? ""}>⚠ {(r.membershipError ?? "실패").slice(0, 50)}</span>
                              : <span className="text-neutral-300">-</span>}
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-rose-700 max-w-[300px] truncate" title={r.error ?? ""}>{r.error ?? ""}</td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => copyOne(r)}
                          className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-200"
                          title="email TAB password TAB user_id 형식"
                        >
                          복사
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
