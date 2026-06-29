"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LS_KEY = "kurly-qa.logistics.po-capa.v1";
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

// 30분 단위 48슬롯
const TIME_POINTS: string[] = [];
for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 30) TIME_POINTS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
const START_OPTS = TIME_POINTS.map((t, i) => ({ slot: i + 1, label: t, time: t + ":00" }));
const END_OPTS = TIME_POINTS.map((t, i) => { const [hh, mm] = t.split(":"); const em = String(Number(mm) + 29).padStart(2, "0"); return { slot: i + 1, label: `${hh}:${em}`, time: `${hh}:${em}:59` }; });
const WD_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WD_LABEL: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

interface CapaRow { fc: string; fcName: string; dock: string; dockName: string; exists: boolean; detail: string }
interface CapaDay { date: string; rows: CapaRow[] }
interface Missing { fc: string; fcName: string; dock: string; dockName: string; date: string; weekday: string }
interface StepEvent { type: "capa"; index: number; ok: boolean; message: string }

export default function CapaForm({ envName }: { envName: string }) {
  const [empEmail, setEmpEmail] = useState("");
  const [rmsId, setRmsId] = useState("");
  const [rmsPw, setRmsPw] = useState("");
  const [dateFrom, setDateFrom] = useState(tomorrow());
  const [dateTo, setDateTo] = useState(tomorrow());
  const [shipFilter, setShipFilter] = useState<"CAR" | "PARCEL">("CAR");
  const [wpFilter, setWpFilter] = useState(""); // "" 전체 / "false" 일반 / "true" 대행

  const [querying, setQuerying] = useState(false);
  const [qErr, setQErr] = useState<string | null>(null);
  const [days, setDays] = useState<CapaDay[]>([]);
  const [missing, setMissing] = useState<Missing[]>([]);
  const [empName, setEmpName] = useState("");

  // 등록 설정
  const [prefix, setPrefix] = useState("CAPA");
  const [partyType, setPartyType] = useState<"1P" | "3PL">("1P");
  const [startSlot, setStartSlot] = useState(1);
  const [endSlot, setEndSlot] = useState(47);
  const [xdock, setXdock] = useState<"N" | "Y">("N");
  const [selMissing, setSelMissing] = useState<Set<string>>(new Set());
  const [sku, setSku] = useState<Record<string, number>>({});
  const [unit, setUnit] = useState<Record<string, number>>({});

  const [registering, setRegistering] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [done, setDone] = useState<{ okCount: number; failCount: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { try { const s = localStorage.getItem(LS_KEY); if (s) { const j = JSON.parse(s); if (j.empEmail) setEmpEmail(j.empEmail); if (j.rmsId) setRmsId(j.rmsId); } } catch {} }, []);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify({ empEmail, rmsId })); } catch {} }, [empEmail, rmsId]);
  useEffect(() => { setDays([]); setMissing([]); setDone(null); setSteps([]); }, [envName]);
  useEffect(() => { if (shipFilter === "PARCEL") { setStartSlot(1); setEndSlot(47); } }, [shipFilter]);

  const missingKey = (m: Missing) => `${m.date}|${m.fc}|${m.dock}`;

  async function onQuery() {
    if (querying) return;
    if (!empEmail.trim() || !rmsId.trim() || !rmsPw.trim()) { setQErr("임직원/RMS 계정 필요"); return; }
    setQuerying(true); setQErr(null); setDays([]); setMissing([]); setDone(null); setSteps([]);
    try {
      const res = await fetch("/api/test-data/logistics-po/capa/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envName, empEmail: empEmail.trim(), rmsId: rmsId.trim(), rmsPw, dateFrom, dateTo, shipFilter, wpFilter }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setEmpName(j.empName || ""); setDays(j.days || []);
      const mis: Missing[] = j.missing || []; setMissing(mis);
      setSelMissing(new Set(mis.map(missingKey)));
      // 누락 날짜의 요일 자동 채움 (9999999)
      const targetWd = new Set(mis.map((m) => m.weekday));
      const s: Record<string, number> = {}, u: Record<string, number> = {};
      WD_ORDER.forEach((d) => { const v = targetWd.has(d) ? 9999999 : 0; s[d] = v; u[d] = v; });
      setSku(s); setUnit(u);
    } catch (e) { setQErr(e instanceof Error ? e.message : String(e)); }
    finally { setQuerying(false); }
  }

  const isParcel = shipFilter === "PARCEL";
  async function onRegister() {
    if (registering) return;
    const items = missing.filter((m) => selMissing.has(missingKey(m))).map((m) => ({ fc: m.fc, dock: m.dock, date: m.date }));
    if (!items.length) { setQErr("등록할 입고지를 선택하세요"); return; }
    setRegistering(true); setSteps([]); setDone(null); setQErr(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const startTime = isParcel ? "00:00:00" : (START_OPTS[startSlot - 1]?.time || "00:00:00");
    const endTime = isParcel ? "23:29:59" : (END_OPTS[endSlot - 1]?.time || "23:29:59");
    const settings = { prefix: prefix || "CAPA", partyType, releaseGroup: shipFilter, xdock, startSlot, endSlot, startTime, endTime, sku, unit };
    try {
      const res = await fetch("/api/test-data/logistics-po/capa/register", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal, body: JSON.stringify({ envName, rmsId: rmsId.trim(), rmsPw, items, settings }) });
      if (!res.ok || !res.body) { const t = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let nl;
        while ((nl = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2); if (!chunk.startsWith("data:")) continue;
          try { const p = JSON.parse(chunk.slice(5).trim()); if (p.kind === "progress") setSteps((x) => [...x, p.event]); else if (p.kind === "done") { setDone({ okCount: p.okCount, failCount: p.failCount }); if (p.error) setQErr(p.error); } else if (p.kind === "fatal") setQErr(p.error); } catch {} } }
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) setQErr(e instanceof Error ? e.message : String(e)); }
    finally { setRegistering(false); abortRef.current = null; }
  }

  const okCnt = useMemo(() => days.reduce((a, d) => a + d.rows.filter((r) => r.exists).length, 0), [days]);
  const totalRows = useMemo(() => days.reduce((a, d) => a + d.rows.length, 0), [days]);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border-l-4 border-sky-400 bg-sky-50 p-3 text-xs text-sky-900 leading-relaxed">
        📦 <strong>CAPA 관리</strong> — RMS 수용능력(CAPA) 조회 + 누락 입고지 일괄 등록. <strong>{envName}</strong> 환경.
        <br />⚠ 등록은 RMS에 실제 CAPA를 생성합니다 · 임직원(daily-capa 조회) + RMS 계정 + 내부망 필요.
      </div>

      <fieldset className="card space-y-4 p-5" disabled={querying || registering}>
        <legend className="text-sm font-semibold text-neutral-700">① 계정 / 조회 조건</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="임직원 이메일 *"><input className="input font-mono" value={empEmail} onChange={(e) => setEmpEmail(e.target.value.trim())} /></Field>
          <Field label="RMS ID *"><input className="input font-mono" value={rmsId} onChange={(e) => setRmsId(e.target.value.trim())} /></Field>
          <Field label="RMS PW *"><input type="password" className="input" value={rmsPw} onChange={(e) => setRmsPw(e.target.value)} /></Field>
          <Field label="시작일"><input type="date" className="input font-mono" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
          <Field label="종료일"><input type="date" className="input font-mono" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
          <Field label="입고방법"><select className="input" value={shipFilter} onChange={(e) => setShipFilter(e.target.value as any)}><option value="CAR">차량</option><option value="PARCEL">택배</option></select></Field>
          <Field label="입고대행"><select className="input" value={wpFilter} onChange={(e) => setWpFilter(e.target.value)}><option value="">전체</option><option value="false">일반</option><option value="true">대행</option></select></Field>
        </div>
        <button type="button" onClick={onQuery} disabled={querying} className="btn-primary">{querying ? "조회 중..." : "CAPA 조회"}</button>
        {qErr && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠ {qErr}</div>}
      </fieldset>

      {days.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">CAPA 현황 <span className="text-neutral-500">(보유 {okCnt}/{totalRows} · 누락 {missing.length})</span> {empName && <span className="text-[11px] text-neutral-400">· {empName}</span>}</div>
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {days.map((d) => (
              <div key={d.date}>
                <div className="mb-1 border-b border-neutral-100 pb-0.5 text-[11px] font-bold text-neutral-600">{d.date}</div>
                {d.rows.map((r, i) => (
                  <div key={i} className={`flex items-start gap-2 py-0.5 text-xs ${r.exists ? "text-neutral-700" : "text-red-600"}`}>
                    <span>{r.exists ? "🟢" : "🔴"}</span>
                    <span className="flex-1">{r.fcName} &gt; {r.dockName} <span className="text-[11px] text-neutral-400">— {r.detail}</span></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <fieldset className="card space-y-4 p-5" disabled={registering}>
          <legend className="text-sm font-semibold text-neutral-700">② CAPA 일괄 등록 ({missing.length}건 누락)</legend>
          <div className="max-h-40 overflow-y-auto rounded border border-neutral-200 p-2">
            <label className="mb-1 block text-[11px] text-neutral-500"><input type="checkbox" checked={selMissing.size === missing.length} onChange={(e) => setSelMissing(e.target.checked ? new Set(missing.map(missingKey)) : new Set())} /> 전체 선택</label>
            {missing.map((m) => { const k = missingKey(m); return (
              <label key={k} className="block text-[11px] text-neutral-600"><input type="checkbox" checked={selMissing.has(k)} onChange={(e) => setSelMissing((p) => { const n = new Set(p); e.target.checked ? n.add(k) : n.delete(k); return n; })} /> {m.date} · {m.fcName} &gt; {m.dockName}</label>
            ); })}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="코드 접두어"><input className="input font-mono" value={prefix} maxLength={10} onChange={(e) => setPrefix(e.target.value)} /></Field>
            <Field label="판매주체"><select className="input" value={partyType} onChange={(e) => setPartyType(e.target.value as any)}><option value="1P">1P+FBK</option><option value="3PL">3PL</option></select></Field>
            <Field label="입고대행(xdock)"><select className="input" value={xdock} onChange={(e) => setXdock(e.target.value as any)}><option value="N">N</option><option value="Y">Y</option></select></Field>
            <div className="text-[11px] text-neutral-400 self-end">입고방법: {isParcel ? "택배(시간 00:00~23:29 고정)" : "차량"}</div>
            <Field label="시작시간"><select className="input" value={startSlot} disabled={isParcel} onChange={(e) => setStartSlot(Number(e.target.value))}>{START_OPTS.map((o) => <option key={o.slot} value={o.slot}>{o.label}</option>)}</select></Field>
            <Field label="종료시간"><select className="input" value={endSlot} disabled={isParcel} onChange={(e) => setEndSlot(Number(e.target.value))}>{END_OPTS.map((o) => <option key={o.slot} value={o.slot}>{o.label}</option>)}</select></Field>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-700">입고가능 SKU <span className="text-[11px] text-neutral-400">(누락 요일 자동 9999999)</span></div>
            <div className="grid grid-cols-7 gap-1">
              {WD_ORDER.map((d) => <div key={d} className="text-center text-[10px] text-neutral-500">{WD_LABEL[d]}</div>)}
              {WD_ORDER.map((d) => <input key={d} type="number" className="input font-mono text-xs" value={sku[d] ?? 0} onChange={(e) => setSku((p) => ({ ...p, [d]: Number(e.target.value) || 0 }))} />)}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-700">입고가능 Unit</div>
            <div className="grid grid-cols-7 gap-1">
              {WD_ORDER.map((d) => <div key={d} className="text-center text-[10px] text-neutral-500">{WD_LABEL[d]}</div>)}
              {WD_ORDER.map((d) => <input key={d} type="number" className="input font-mono text-xs" value={unit[d] ?? 0} onChange={(e) => setUnit((p) => ({ ...p, [d]: Number(e.target.value) || 0 }))} />)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onRegister} disabled={registering} className="btn-primary">{registering ? "등록 중..." : `선택 ${selMissing.size}건 일괄 등록`}</button>
            {registering && <button type="button" onClick={() => abortRef.current?.abort()} className="btn-ghost border border-neutral-200">⛔ 중단</button>}
          </div>
          {steps.length > 0 && <div className="max-h-56 space-y-1 overflow-y-auto rounded bg-neutral-50 p-2 font-mono text-xs">{steps.map((s, i) => <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>{s.message}</div>)}</div>}
          {done && <div className="text-sm font-semibold">완료: <span className={done.failCount === 0 ? "text-green-600" : "text-amber-600"}>성공 {done.okCount} / 실패 {done.failCount}</span> — CAPA 재조회 권장</div>}
        </fieldset>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-neutral-700">{label}</span>{children}</label>;
}
