"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.work-type.v2";

interface Account { idx: number; username: string; name: string; phone: string; empNum: string; workType: string; group: string; workOk: boolean; expStart: string | null; expEnd: string | null }
interface AcctResult { index: number; username: string; workType: string; signup: string; login: string; convert: string; plan: string; start: string; end: string; ok: boolean }
interface AdminRow { username: string; laborName: string; workType: string; commuteStatus: string; workShift: string; workStartedAt: string; workEndedAt: string; lateTime: number; needCheck: boolean }
interface VerifyRow { username: string; workType: string; date: string; status: string; typeMatch: string; startMatch: string; endMatch: string; lateMatch: string; result: string; detail: string }

function today() { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

type Tab = "overview" | "batch" | "individual" | "commute" | "admin" | "verify" | "custom";
const TABS: [Tab, string][] = [
  ["overview", "계정 매핑"], ["batch", "일괄 실행"], ["individual", "개별 실행"],
  ["commute", "출퇴근(수동)"], ["admin", "어드민 조회"], ["verify", "모바일-어드민 검증"], ["custom", "커스텀 실행"],
];

// 공용 SSE 리더
async function streamSSE(url: string, body: unknown, signal: AbortSignal, onProgress: (e: any) => void, onDone: (p: any) => void): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) { const t = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let nl;
    while ((nl = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
      if (!chunk.startsWith("data:")) continue;
      try { const p = JSON.parse(chunk.slice(5).trim());
        if (p.kind === "progress") onProgress(p.event);
        else if (p.kind === "done") onDone(p);
        else if (p.kind === "fatal") throw new Error(p.error);
      } catch (e) { if (e instanceof Error && e.message && !chunk.includes("progress")) throw e; }
    }
  }
}

export default function WorkTypeForm() {
  const [tab, setTab] = useState<Tab>("overview");
  // 공용
  const [adminId, setAdminId] = useState("autoqa99");
  const [adminPw, setAdminPw] = useState("kurly12@");
  const [workDate, setWorkDate] = useState(today());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [acctErr, setAcctErr] = useState<string | null>(null);

  useEffect(() => {
    try { const s = localStorage.getItem(LS_KEY); if (s) { const j = JSON.parse(s); if (j.adminId) setAdminId(j.adminId); if (j.workDate) setWorkDate(j.workDate); } } catch {}
    fetch("/api/test-data/logistics-work-type/accounts").then((r) => r.json()).then((j) => { if (j.ok) setAccounts(j.accounts); else setAcctErr(j.error); }).catch((e) => setAcctErr(String(e)));
  }, []);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify({ adminId, workDate })); } catch {} }, [adminId, workDate]);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50 p-3 text-xs text-indigo-900 leading-relaxed">
        🧪 <strong>근무유형별 테스트</strong> — 근무유형 마스터(48종) 기반 7개 기능. ⚠ 일괄/개별/커스텀은 <strong>실제 계정·근무데이터를 생성</strong>합니다. 컬리로 QA 내부망 필요.
      </div>

      {/* 공용 어드민/근무일자 */}
      <fieldset className="card grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
        <legend className="text-xs font-semibold text-neutral-500">공용 (어드민 / 근무일자)</legend>
        <Field label="어드민 ID"><input className="input font-mono" value={adminId} onChange={(e) => setAdminId(e.target.value.trim())} /></Field>
        <Field label="어드민 PW"><input type="password" className="input" value={adminPw} onChange={(e) => setAdminPw(e.target.value)} /></Field>
        <Field label="근무일자"><input type="date" className="input font-mono" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></Field>
        <div className="self-end text-[11px] text-neutral-400">{accounts.length}개 프리셋 로드됨{acctErr ? ` · ⚠ ${acctErr}` : ""}</div>
      </fieldset>

      {/* 탭 */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-200">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium transition ${tab === t ? "border-b-2 border-kurly-500 text-kurly-700" : "text-neutral-500 hover:text-neutral-700"}`}>{label}</button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab accounts={accounts} />}
      {tab === "batch" && <BatchTab adminId={adminId} adminPw={adminPw} workDate={workDate} />}
      {tab === "individual" && <IndividualTab adminId={adminId} adminPw={adminPw} workDate={workDate} accounts={accounts} />}
      {tab === "commute" && <CommuteTab workDate={workDate} accounts={accounts} />}
      {tab === "admin" && <AdminTab adminId={adminId} adminPw={adminPw} workDate={workDate} accounts={accounts} />}
      {tab === "verify" && <VerifyTab adminId={adminId} adminPw={adminPw} workDate={workDate} accounts={accounts} />}
      {tab === "custom" && <CustomTab adminId={adminId} adminPw={adminPw} workDate={workDate} accounts={accounts} />}
    </div>
  );
}

// ── 1. 계정 매핑 ──
function OverviewTab({ accounts }: { accounts: Account[] }) {
  return (
    <div className="card p-4">
      <div className="mb-2 text-sm font-semibold text-neutral-700">48개 근무유형 ↔ 프리셋 계정 매핑</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50"><tr><th className="p-1.5 text-left">#</th><th className="p-1.5 text-left">계정</th><th className="p-1.5 text-left">근무유형</th><th className="p-1.5 text-left">그룹</th><th className="p-1.5 text-left">근무인정</th><th className="p-1.5 text-left">예상출근</th><th className="p-1.5 text-left">예상퇴근</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.username} className="border-t border-neutral-100">
                <td className="p-1.5">{a.idx + 1}</td><td className="p-1.5 font-mono">{a.username}</td><td className="p-1.5">{a.workType}</td>
                <td className="p-1.5">{a.group}</td><td className="p-1.5">{a.workOk ? "O" : "X"}</td><td className="p-1.5 font-mono">{a.expStart ?? "-"}</td><td className="p-1.5 font-mono">{a.expEnd ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 공용 진행/결과 hook 패턴 (간단 버전)
function useRunner() {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reset = () => { setSteps([]); setErr(null); };
  return { running, setRunning, steps, setSteps, err, setErr, abortRef, reset };
}
function StepLog({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  return <div className="card mt-3 max-h-64 space-y-1 overflow-y-auto p-3 font-mono text-xs">{steps.map((s, i) => <div key={i} className={s.includes("❌") || s.includes("실패") || s.includes("FAIL") ? "text-red-600" : "text-neutral-700"}>{s}</div>)}</div>;
}

// ── 2. 일괄 실행 ──
function BatchTab({ adminId, adminPw, workDate }: { adminId: string; adminPw: string; workDate: string }) {
  const r = useRunner();
  const [scope, setScope] = useState<"workOk" | "all">("workOk");
  const [includeStart, setIncludeStart] = useState(true);
  const [includeEnd, setIncludeEnd] = useState(true);
  const [results, setResults] = useState<AcctResult[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number } | null>(null);

  async function run() {
    r.reset(); setResults([]); setDone(null); r.setRunning(true);
    const ctrl = new AbortController(); r.abortRef.current = ctrl;
    try {
      await streamSSE("/api/test-data/logistics-work-type", { adminId, adminPw, scope, workDate, includeStart, includeEnd }, ctrl.signal,
        (e) => r.setSteps((x) => [...x, e.message]), (p) => { setResults(p.results ?? []); setDone({ okCount: p.okCount, total: p.total }); if (p.error) r.setErr(p.error); });
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) r.setErr(e instanceof Error ? e.message : String(e)); }
    finally { r.setRunning(false); }
  }
  return (
    <div className="card p-5 space-y-4">
      <div className="text-sm font-semibold text-neutral-700">일괄 실행 (계정생성 + 근무계획 + 출퇴근)</div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="실행 범위"><select className="input" value={scope} onChange={(e) => setScope(e.target.value as any)} disabled={r.running}><option value="workOk">근무인정 계정만 (22)</option><option value="all">전체 (48)</option></select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeStart} onChange={(e) => setIncludeStart(e.target.checked)} disabled={r.running} /> 출근 포함</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeEnd} onChange={(e) => setIncludeEnd(e.target.checked)} disabled={r.running} /> 퇴근 포함</label>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={run} disabled={r.running} className="btn-primary">{r.running ? "실행 중..." : "🚀 일괄 실행"}</button>
        {r.running && <button type="button" onClick={() => r.abortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
      </div>
      {r.err && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {r.err}</div>}
      <StepLog steps={r.steps} />
      {done && (
        <div>
          <div className="mb-2 text-sm font-semibold">완료: <span className={done.okCount === done.total ? "text-green-600" : "text-amber-600"}>{done.okCount}/{done.total} 성공</span></div>
          <ResultTable results={results} />
        </div>
      )}
    </div>
  );
}

function ResultTable({ results }: { results: AcctResult[] }) {
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead className="bg-neutral-50"><tr><th className="p-1.5 text-left">#</th><th className="p-1.5 text-left">계정</th><th className="p-1.5 text-left">근무유형</th><th className="p-1.5 text-left">가입</th><th className="p-1.5 text-left">로그인</th><th className="p-1.5 text-left">전환</th><th className="p-1.5 text-left">계획</th><th className="p-1.5 text-left">출근</th><th className="p-1.5 text-left">퇴근</th></tr></thead>
      <tbody>{results.map((r) => (<tr key={r.index} className="border-t border-neutral-100"><td className="p-1.5">{r.index}</td><td className="p-1.5 font-mono">{r.username}</td><td className="p-1.5">{r.workType}</td><td className="p-1.5">{r.signup}</td><td className="p-1.5">{r.login}</td><td className="p-1.5">{r.convert}</td><td className={`p-1.5 ${r.plan.startsWith("FAIL") ? "text-red-600" : ""}`}>{r.plan}</td><td className={`p-1.5 ${r.start.startsWith("FAIL") ? "text-red-600" : ""}`}>{r.start}</td><td className={`p-1.5 ${r.end.startsWith("FAIL") ? "text-red-600" : ""}`}>{r.end}</td></tr>))}</tbody>
    </table></div>
  );
}

// ── 3. 개별 실행 ──
function IndividualTab({ adminId, adminPw, workDate, accounts }: { adminId: string; adminPw: string; workDate: string; accounts: Account[] }) {
  const r = useRunner();
  const [username, setUsername] = useState("");
  const [results, setResults] = useState<AcctResult[]>([]);
  const [done, setDone] = useState<{ okCount: number; total: number } | null>(null);
  useEffect(() => { if (!username && accounts.length) setUsername(accounts[0].username); }, [accounts, username]);

  async function run() {
    r.reset(); setResults([]); setDone(null); r.setRunning(true);
    const ctrl = new AbortController(); r.abortRef.current = ctrl;
    try {
      await streamSSE("/api/test-data/logistics-work-type", { adminId, adminPw, scope: "all", workDate, includeStart: true, includeEnd: true, usernames: [username] }, ctrl.signal,
        (e) => r.setSteps((x) => [...x, e.message]), (p) => { setResults(p.results ?? []); setDone({ okCount: p.okCount, total: p.total }); if (p.error) r.setErr(p.error); });
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) r.setErr(e instanceof Error ? e.message : String(e)); }
    finally { r.setRunning(false); }
  }
  return (
    <div className="card p-5 space-y-4">
      <div className="text-sm font-semibold text-neutral-700">개별 계정 생성 + 근무계획 + 출퇴근</div>
      <Field label="계정 선택"><select className="input" value={username} onChange={(e) => setUsername(e.target.value)} disabled={r.running}>{accounts.map((a) => <option key={a.username} value={a.username}>{a.username} ({a.workType} / {a.group})</option>)}</select></Field>
      <div className="flex gap-3"><button type="button" onClick={run} disabled={r.running || !username} className="btn-primary">{r.running ? "실행 중..." : "개별 실행"}</button>{r.running && <button type="button" onClick={() => r.abortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}</div>
      {r.err && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {r.err}</div>}
      <StepLog steps={r.steps} />
      {done && <ResultTable results={results} />}
    </div>
  );
}

// ── 4. 출퇴근(수동) ──
function CommuteTab({ workDate, accounts }: { workDate: string; accounts: Account[] }) {
  const workOk = accounts.filter((a) => a.workOk);
  const [username, setUsername] = useState("");
  const [startTime, setStartTime] = useState("08:00:00");
  const [endTime, setEndTime] = useState("17:00:00");
  const [overtime, setOvertime] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!username && workOk.length) { setUsername(workOk[0].username); } }, [workOk, username]);
  useEffect(() => { const a = workOk.find((x) => x.username === username); if (a) { setStartTime((a.expStart || "08:00") + ":00"); setEndTime((a.expEnd || "17:00") + ":00"); } }, [username]); // eslint-disable-line

  async function go(action: "start" | "end") {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/test-data/logistics-work-type/commute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, username, workDate, time: action === "start" ? startTime : endTime, overtimeMins: overtime }) });
      const j = await res.json();
      setMsg(`${action === "start" ? "출근" : "퇴근"} ${j.ok ? "성공" : "실패"} (HTTP ${j.status}) — ${username}`);
    } catch (e) { setMsg(`오류: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }
  return (
    <div className="card p-5 space-y-4">
      <div className="text-sm font-semibold text-neutral-700">개별 출퇴근 (수동 시간 지정)</div>
      <Field label="계정 선택 (근무인정만)"><select className="input" value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy}>{workOk.map((a) => <option key={a.username} value={a.username}>{a.username} ({a.workType})</option>)}</select></Field>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 p-3 space-y-2">
          <div className="text-sm font-semibold text-neutral-700">출근</div>
          <input className="input font-mono" value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="08:00:00" />
          <button type="button" onClick={() => go("start")} disabled={busy || !username} className="btn-primary w-full">출근 실행</button>
        </div>
        <div className="rounded-lg border border-neutral-200 p-3 space-y-2">
          <div className="text-sm font-semibold text-neutral-700">퇴근</div>
          <input className="input font-mono" value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="17:00:00" />
          <label className="block text-xs"><span className="mb-1 block text-neutral-500">연장(분)</span><input type="number" min={0} step={30} className="input font-mono" value={overtime} onChange={(e) => setOvertime(Math.max(0, Number(e.target.value) || 0))} /></label>
          <button type="button" onClick={() => go("end")} disabled={busy || !username} className="btn-primary w-full">퇴근 실행</button>
        </div>
      </div>
      {msg && <div className="rounded border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-700">{msg}</div>}
    </div>
  );
}

// ── 5. 어드민 조회 ──
function AdminTab({ adminId, adminPw, workDate, accounts }: { adminId: string; adminPw: string; workDate: string; accounts: Account[] }) {
  const [scope, setScope] = useState<"preset" | "all" | "select" | "text">("preset");
  const [selAcct, setSelAcct] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!selAcct && accounts.length) setSelAcct(accounts[0].username); }, [accounts, selAcct]);

  async function run() {
    setBusy(true); setErr(null); setRows(null);
    try {
      const res = await fetch("/api/test-data/logistics-work-type/admin-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminId, adminPw, workDate }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setTotal(j.total);
      const presetSet = new Set(accounts.map((a) => a.username));
      let filtered: AdminRow[] = j.rows;
      if (scope === "preset") filtered = j.rows.filter((r: AdminRow) => presetSet.has(r.username));
      else if (scope === "select") filtered = j.rows.filter((r: AdminRow) => r.username === selAcct);
      else if (scope === "text" && text) filtered = j.rows.filter((r: AdminRow) => (r.username || "").includes(text) || (r.laborName || "").includes(text));
      setRows(filtered);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="card p-5 space-y-4">
      <div className="text-sm font-semibold text-neutral-700">어드민 리스트 조회 (work-schedules)</div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="조회 범위"><select className="input" value={scope} onChange={(e) => setScope(e.target.value as any)}><option value="preset">프리셋 계정만</option><option value="all">전체(센터 전체)</option><option value="select">프리셋 선택</option><option value="text">직접 입력</option></select></Field>
        {scope === "select" && <Field label="계정"><select className="input" value={selAcct} onChange={(e) => setSelAcct(e.target.value)}>{accounts.map((a) => <option key={a.username} value={a.username}>{a.username}</option>)}</select></Field>}
        {scope === "text" && <Field label="아이디/이름 포함"><input className="input font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="kurlyqa" /></Field>}
        <button type="button" onClick={run} disabled={busy} className="btn-primary">{busy ? "조회 중..." : "조회"}</button>
      </div>
      {err && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {err}</div>}
      {rows && (
        <div>
          <div className="mb-2 text-xs text-neutral-500">전체 {total}건 / 표시 {rows.length}건</div>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead className="bg-neutral-50"><tr><th className="p-1.5 text-left">아이디</th><th className="p-1.5 text-left">이름</th><th className="p-1.5 text-left">근무유형</th><th className="p-1.5 text-left">상태</th><th className="p-1.5 text-left">근무시간대</th><th className="p-1.5 text-left">출근</th><th className="p-1.5 text-left">퇴근</th><th className="p-1.5 text-left">지각</th><th className="p-1.5 text-left">확인필요</th></tr></thead>
            <tbody>{rows.map((r, i) => (<tr key={i} className="border-t border-neutral-100"><td className="p-1.5 font-mono">{r.username}</td><td className="p-1.5">{r.laborName}</td><td className="p-1.5">{r.workType}</td><td className="p-1.5">{r.commuteStatus}</td><td className="p-1.5 font-mono">{r.workShift}</td><td className="p-1.5 font-mono">{r.workStartedAt}</td><td className="p-1.5 font-mono">{r.workEndedAt}</td><td className="p-1.5">{r.lateTime}분</td><td className="p-1.5">{r.needCheck ? "⚠" : "-"}</td></tr>))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

// ── 6. 모바일-어드민 검증 ──
function VerifyTab({ adminId, adminPw, workDate, accounts }: { adminId: string; adminPw: string; workDate: string; accounts: Account[] }) {
  const r = useRunner();
  const [scope, setScope] = useState<"one" | "workOk" | "all" | "multi">("one");
  const [selAcct, setSelAcct] = useState("");
  const [multi, setMulti] = useState<string[]>([]);
  const [month, setMonth] = useState(workDate.slice(0, 7));
  const [rows, setRows] = useState<VerifyRow[]>([]);
  const [done, setDone] = useState<{ passed: number; total: number } | null>(null);
  useEffect(() => { if (!selAcct && accounts.length) setSelAcct(accounts[0].username); }, [accounts, selAcct]);
  useEffect(() => { setMonth(workDate.slice(0, 7)); }, [workDate]);

  const targets = useMemo(() => {
    if (scope === "one") return selAcct ? [selAcct] : [];
    if (scope === "workOk") return accounts.filter((a) => a.workOk).map((a) => a.username);
    if (scope === "all") return accounts.map((a) => a.username);
    return multi;
  }, [scope, selAcct, multi, accounts]);

  async function run() {
    r.reset(); setRows([]); setDone(null); r.setRunning(true);
    const ctrl = new AbortController(); r.abortRef.current = ctrl;
    try {
      await streamSSE("/api/test-data/logistics-work-type/verify", { adminId, adminPw, usernames: targets, month }, ctrl.signal,
        (e) => r.setSteps((x) => [...x, e.message]), (p) => { setRows(p.rows ?? []); setDone({ passed: p.passed, total: p.total }); if (p.error) r.setErr(p.error); });
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) r.setErr(e instanceof Error ? e.message : String(e)); }
    finally { r.setRunning(false); }
  }
  return (
    <div className="card p-5 space-y-4">
      <div className="text-sm font-semibold text-neutral-700">모바일 vs 어드민 교차 검증</div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="검증 범위"><select className="input" value={scope} onChange={(e) => setScope(e.target.value as any)} disabled={r.running}><option value="one">개별 선택</option><option value="workOk">근무인정 전체(22)</option><option value="all">프리셋 전체(48)</option><option value="multi">부분 선택</option></select></Field>
        {scope === "one" && <Field label="계정"><select className="input" value={selAcct} onChange={(e) => setSelAcct(e.target.value)} disabled={r.running}>{accounts.map((a) => <option key={a.username} value={a.username}>{a.username} ({a.workType})</option>)}</select></Field>}
        <Field label="조회 월"><input className="input font-mono" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="2026-06" disabled={r.running} /></Field>
        <div className="self-end text-[11px] text-neutral-400">대상 {targets.length}개</div>
      </div>
      {scope === "multi" && (
        <div className="flex flex-wrap gap-1">
          {accounts.map((a) => { const on = multi.includes(a.username); return (
            <button key={a.username} type="button" onClick={() => setMulti((m) => on ? m.filter((x) => x !== a.username) : [...m, a.username])} disabled={r.running}
              className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${on ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 text-neutral-500"}`}>{a.username}</button>
          ); })}
        </div>
      )}
      <div className="flex gap-3"><button type="button" onClick={run} disabled={r.running || !targets.length} className="btn-primary">{r.running ? "검증 중..." : "교차 검증 실행"}</button>{r.running && <button type="button" onClick={() => r.abortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}</div>
      {r.err && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {r.err}</div>}
      <StepLog steps={r.steps} />
      {done && (
        <div>
          <div className="mb-2 text-sm font-semibold">{done.passed === done.total ? <span className="text-green-600">ALL PASS ({done.passed}/{done.total})</span> : <span className="text-red-600">FAIL {done.total - done.passed}건 / 전체 {done.total}건</span>}</div>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead className="bg-neutral-50"><tr><th className="p-1.5 text-left">계정</th><th className="p-1.5 text-left">날짜</th><th className="p-1.5 text-left">상태</th><th className="p-1.5 text-left">유형</th><th className="p-1.5 text-left">출근</th><th className="p-1.5 text-left">퇴근</th><th className="p-1.5 text-left">지각</th><th className="p-1.5 text-left">결과</th><th className="p-1.5 text-left">상세</th></tr></thead>
            <tbody>{rows.map((r, i) => (<tr key={i} className="border-t border-neutral-100"><td className="p-1.5 font-mono">{r.username}</td><td className="p-1.5 font-mono">{r.date}</td><td className="p-1.5">{r.status}</td><td className="p-1.5">{r.typeMatch}</td><td className="p-1.5">{r.startMatch}</td><td className="p-1.5">{r.endMatch}</td><td className="p-1.5">{r.lateMatch}</td><td className="p-1.5">{r.result === "PASS" ? <span className="text-green-600">PASS</span> : <span className="text-red-600 font-semibold">FAIL</span>}</td><td className="p-1.5 text-[11px] text-neutral-500">{r.detail}</td></tr>))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

// ── 7. 커스텀 실행 ──
function CustomTab({ adminId, adminPw, workDate, accounts }: { adminId: string; adminPw: string; workDate: string; accounts: Account[] }) {
  const r = useRunner();
  const STEPS = ["1. 계정생성", "2. 근무계획", "3. 출퇴근", "4. 어드민 조회", "5. 모바일-어드민 검증"];
  const [username, setUsername] = useState(""); const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [empNum, setEmpNum] = useState("");
  const [workTypeName, setWorkTypeName] = useState(""); const [shift, setShift] = useState("08:00 ~ 17:00");
  const [startTime, setStartTime] = useState(""); const [endTime, setEndTime] = useState("");
  const [startStep, setStartStep] = useState(1); const [endStep, setEndStep] = useState(5);
  const [done, setDone] = useState<any>(null);
  const wtNames = useMemo(() => Array.from(new Set(accounts.map((a) => a.workType))), [accounts]);
  useEffect(() => { if (!workTypeName && wtNames.length) setWorkTypeName(wtNames[0]); }, [wtNames, workTypeName]);
  useEffect(() => { const a = accounts.find((x) => x.workType === workTypeName); if (a) { setStartTime(a.expStart ? a.expStart + ":00" : ""); setEndTime(a.expEnd ? a.expEnd + ":00" : ""); } }, [workTypeName]); // eslint-disable-line

  async function run() {
    r.reset(); setDone(null); r.setRunning(true);
    const ctrl = new AbortController(); r.abortRef.current = ctrl;
    try {
      await streamSSE("/api/test-data/logistics-work-type/custom", { adminId, adminPw, username, name, phone, empNum, workTypeName, shift, startTime, endTime, workDate, month: workDate.slice(0, 7), startStep, endStep }, ctrl.signal,
        (e) => r.setSteps((x) => [...x, e.message]), (p) => setDone(p.result));
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) r.setErr(e instanceof Error ? e.message : String(e)); }
    finally { r.setRunning(false); }
  }
  return (
    <div className="card p-5 space-y-4">
      <div className="text-sm font-semibold text-neutral-700">커스텀 시나리오 실행 (1~5단계)</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="아이디 *"><input className="input font-mono" value={username} onChange={(e) => setUsername(e.target.value.trim())} placeholder="testuser01" /></Field>
        <Field label="이름 *"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" /></Field>
        <Field label="전화번호"><input className="input font-mono" value={phone} onChange={(e) => setPhone(e.target.value.trim())} placeholder="01099990001" /></Field>
        <Field label="사번 *"><input className="input font-mono" value={empNum} onChange={(e) => setEmpNum(e.target.value.trim())} placeholder="mk9901" /></Field>
        <Field label="근무유형"><select className="input" value={workTypeName} onChange={(e) => setWorkTypeName(e.target.value)}>{wtNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label="근무시간대"><input className="input font-mono" value={shift} onChange={(e) => setShift(e.target.value)} /></Field>
        <Field label="출근 시각"><input className="input font-mono" value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="08:00:00" /></Field>
        <Field label="퇴근 시각"><input className="input font-mono" value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="17:00:00" /></Field>
        <Field label="시작 Step"><select className="input" value={startStep} onChange={(e) => setStartStep(Number(e.target.value))}>{STEPS.map((s, i) => <option key={i} value={i + 1}>{s}</option>)}</select></Field>
        <Field label="종료 Step"><select className="input" value={endStep} onChange={(e) => setEndStep(Number(e.target.value))}>{STEPS.map((s, i) => <option key={i} value={i + 1}>{s}</option>)}</select></Field>
      </div>
      <div className="flex gap-3"><button type="button" onClick={run} disabled={r.running || !username || !name || !empNum} className="btn-primary">{r.running ? "실행 중..." : "커스텀 실행"}</button>{r.running && <button type="button" onClick={() => r.abortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}</div>
      {r.err && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {r.err}</div>}
      <StepLog steps={r.steps} />
      {done?.adminRows?.length > 0 && (
        <div><div className="mb-1 text-xs font-semibold text-neutral-600">어드민 조회</div>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-neutral-50"><tr><th className="p-1.5 text-left">아이디</th><th className="p-1.5 text-left">근무유형</th><th className="p-1.5 text-left">상태</th><th className="p-1.5 text-left">출근</th><th className="p-1.5 text-left">퇴근</th></tr></thead>
          <tbody>{done.adminRows.map((r: AdminRow, i: number) => (<tr key={i} className="border-t border-neutral-100"><td className="p-1.5 font-mono">{r.username}</td><td className="p-1.5">{r.workType}</td><td className="p-1.5">{r.commuteStatus}</td><td className="p-1.5 font-mono">{r.workStartedAt}</td><td className="p-1.5 font-mono">{r.workEndedAt}</td></tr>))}</tbody></table></div>
        </div>
      )}
      {done?.verifyRows?.length > 0 && (
        <div><div className="mb-1 text-xs font-semibold text-neutral-600">모바일-어드민 검증</div>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-neutral-50"><tr><th className="p-1.5 text-left">날짜</th><th className="p-1.5 text-left">유형</th><th className="p-1.5 text-left">출근</th><th className="p-1.5 text-left">퇴근</th><th className="p-1.5 text-left">지각</th><th className="p-1.5 text-left">결과</th></tr></thead>
          <tbody>{done.verifyRows.map((r: VerifyRow, i: number) => (<tr key={i} className="border-t border-neutral-100"><td className="p-1.5 font-mono">{r.date}</td><td className="p-1.5">{r.typeMatch}</td><td className="p-1.5">{r.startMatch}</td><td className="p-1.5">{r.endMatch}</td><td className="p-1.5">{r.lateMatch}</td><td className="p-1.5">{r.result === "PASS" ? <span className="text-green-600">PASS</span> : <span className="text-red-600">FAIL</span>}</td></tr>))}</tbody></table></div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-neutral-700">{label}</span>{children}</label>;
}
