"use client";

import { useEffect, useState } from "react";

const LS_KEY = "kurly-qa.logistics.kurlyro-actions.v1";

const CLUSTER_CENTER_MAP: Record<string, [string, string][]> = {
  CC02: [["GGH1", "김포상온"], ["GGM1", "김포냉장"], ["GGL1", "김포냉동"], ["GGHUB1", "김포허브"], ["GGQ1", "김포QC"], ["GGC1", "김포CS"], ["GGR1", "김포회수"], ["GGH3", "김포롱테일"], ["GGIM1", "김포재고관리"]],
  CC03: [["GPH1", "평택상온"], ["GPM1", "평택냉장"], ["GPL1", "평택냉동"], ["GPHS1", "평택상온SIOC"], ["GPHUB1", "평택허브"], ["GPQ1", "평택QC"], ["GPC1", "평택CS"], ["GPR1", "평택 통합회수"], ["GPH2", "평택 부자재"], ["GPH3", "평택뷰티"], ["GPIM1", "평택재고관리"]],
  CC04: [["KCH1", "창원상온"], ["KCM1", "창원냉장"], ["KCL1", "창원냉동"], ["KCHUB1", "창원허브"], ["KCQ1", "창원QC"], ["KCC1", "창원CS"], ["KCR1", "창원회수"], ["KCIM1", "창원재고관리"]],
  MC01: [["MC01", "DMC"], ["MC02", "도곡"]],
};
const CLUSTERS = Object.keys(CLUSTER_CENTER_MAP);
const WORK_PARTS = ["IB", "OB", "QC", "IM"];
const PROCESSES: [string, string][] = [["picking", "피킹"], ["packing", "패킹"], ["shipping", "출하"]];

export type Category = "basic" | "arbeit" | "manage" | "smedical";
const ACTIONS: Record<Category, { key: string; label: string; hint?: string }[]> = {
  basic: [
    { key: "signup", label: "📝 회원가입", hint: "이름/전화 필요" },
    { key: "convert", label: "🔄 상용직 전환", hint: "사번·센터" },
    { key: "workplan", label: "📋 근무계획 생성" },
    { key: "contractStart", label: "🏢 출근 처리", hint: "근무시간대" },
    { key: "checkin", label: "✅ 체크인", hint: "공정" },
    { key: "checkout", label: "⏹️ 체크아웃" },
    { key: "endCommute", label: "🏠 퇴근 처리" },
    { key: "delete", label: "🗑️ 회원탈퇴" },
  ],
  arbeit: [
    { key: "personalInfo", label: "📋 개인정보 등록" },
    { key: "certifyLabor", label: "🪪 관리자 작업인증" },
    { key: "registerContract", label: "📝 근무 등록" },
    { key: "shortStart", label: "🚪 아르바이트 출근", hint: "연장근무" },
    { key: "laborContract5", label: "📜 작업자 근로계약 (5단계)" },
  ],
  manage: [
    { key: "safetyComplete", label: "🎓 안전교육 진행" },
    { key: "safetyStatus", label: "📛 안전교육 갱신 필요" },
    { key: "passwordDate", label: "🔑 비밀번호 90일 경과" },
    { key: "initPassword", label: "🔄 계정 초기화" },
  ],
  smedical: [
    { key: "smAddTarget", label: "👥 대상자 추가 (아르바이트)" },
    { key: "smRegister", label: "📋 대상자 등록처리" },
    { key: "smSubmit1", label: "📱 1차 등록 (모바일)", hint: "검진일" },
    { key: "smReject", label: "🚫 반려 (공통)", hint: "1·2차/사유" },
    { key: "smApprove", label: "✅ 승인 (공통)", hint: "1·2차" },
    { key: "smRegister2", label: "🔄 2차 등록처리 (어드민)" },
    { key: "smSubmit2", label: "📱 2차 등록 (모바일)", hint: "검진일" },
  ],
};

interface Common {
  username: string; password: string; name: string; phone: string; empNum: string;
  cluster: string; center: string; workPart: string;
  processCode: string; overWork: "WISHED" | "NOT_WISHED"; workShift: string;
  examinationDate: string; rejectionReason: string; isSecond: boolean; workerType: "short" | "contract";
}
function today() { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
const INIT: Common = {
  username: "", password: "kurly12@", name: "", phone: "", empNum: "",
  cluster: "CC02", center: "GGH1", workPart: "IB",
  processCode: "picking", overWork: "WISHED", workShift: "09:00 ~ 09:30",
  examinationDate: today(), rejectionReason: "반려 처리", isSecond: false, workerType: "short",
};

export default function ActionPanel({ category }: { category: Category }) {
  const [c, setC] = useState<Common>(INIT);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; logs: string[] }>>({});

  useEffect(() => { try { const s = localStorage.getItem(LS_KEY); if (s) setC((p) => ({ ...p, ...JSON.parse(s) })); } catch {} }, []);
  useEffect(() => { if (!running) { try { localStorage.setItem(LS_KEY, JSON.stringify({ ...c, password: undefined })); } catch {} } }, [c, running]);
  const up = <K extends keyof Common>(k: K, v: Common[K]) => setC((p) => ({ ...p, [k]: v }));
  const centerOpts = CLUSTER_CENTER_MAP[c.cluster] || [];

  async function run(key: string) {
    if (running) return;
    if (!c.username.trim() || !c.password.trim()) { setResults((r) => ({ ...r, [key]: { ok: false, logs: ["❌ 계정 ID/PW 필요"] } })); return; }
    setRunning(key);
    try {
      const res = await fetch("/api/test-data/logistics-kurlyro/action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: key, username: c.username.trim(), password: c.password, name: c.name, phone: c.phone, empNum: c.empNum.trim() || undefined, cluster: c.cluster, center: c.center, workPart: c.workPart, processCode: c.processCode, processName: PROCESSES.find(([p]) => p === c.processCode)?.[1], overWork: c.overWork, workShift: c.workShift, examinationDate: c.examinationDate, rejectionReason: c.rejectionReason, isSecond: c.isSecond, workerType: c.workerType }),
      });
      const j = await res.json();
      setResults((r) => ({ ...r, [key]: { ok: !!j.ok, logs: j.logs || [j.error || `HTTP ${res.status}`] } }));
    } catch (e) {
      setResults((r) => ({ ...r, [key]: { ok: false, logs: [e instanceof Error ? e.message : String(e)] } }));
    } finally { setRunning(null); }
  }

  return (
    <div className="space-y-4">
      {/* 공용 입력 */}
      <fieldset className="card grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <legend className="text-xs font-semibold text-neutral-500">공용 입력</legend>
        <F label="작업자 ID *"><input className="input font-mono" value={c.username} onChange={(e) => up("username", e.target.value.trim())} placeholder="kurlyroapi0001" /></F>
        <F label="PW *"><input type="password" className="input" value={c.password} onChange={(e) => up("password", e.target.value)} /></F>
        <F label="이름(가입)"><input className="input" value={c.name} onChange={(e) => up("name", e.target.value)} /></F>
        <F label="전화번호(가입)"><input className="input font-mono" value={c.phone} onChange={(e) => up("phone", e.target.value.trim())} placeholder="01099990001" /></F>
        <F label="Cluster"><select className="input" value={c.cluster} onChange={(e) => setC((p) => ({ ...p, cluster: e.target.value, center: CLUSTER_CENTER_MAP[e.target.value]?.[0]?.[0] || "" }))}>{CLUSTERS.map((x) => <option key={x}>{x}</option>)}</select></F>
        <F label="Center"><select className="input" value={c.center} onChange={(e) => up("center", e.target.value)}>{centerOpts.map(([code, n]) => <option key={code} value={code}>{code} · {n}</option>)}</select></F>
        <F label="업무파트"><select className="input" value={c.workPart} onChange={(e) => up("workPart", e.target.value)}>{WORK_PARTS.map((w) => <option key={w}>{w}</option>)}</select></F>
        <F label="사번(전환)"><input className="input font-mono" value={c.empNum} onChange={(e) => up("empNum", e.target.value.trim())} placeholder="비우면 자동" /></F>
        {category === "basic" && <>
          <F label="체크인 공정"><select className="input" value={c.processCode} onChange={(e) => up("processCode", e.target.value)}>{PROCESSES.map(([p, n]) => <option key={p} value={p}>{p} · {n}</option>)}</select></F>
          <F label="근무시간대(출근)"><input className="input font-mono" value={c.workShift} onChange={(e) => up("workShift", e.target.value)} /></F>
        </>}
        {category === "arbeit" && <F label="연장근무"><select className="input" value={c.overWork} onChange={(e) => up("overWork", e.target.value as Common["overWork"])}><option value="WISHED">WISHED</option><option value="NOT_WISHED">NOT_WISHED</option></select></F>}
        {category === "smedical" && <>
          <F label="검진일"><input type="date" className="input font-mono" value={c.examinationDate} onChange={(e) => up("examinationDate", e.target.value)} /></F>
          <F label="작업자유형"><select className="input" value={c.workerType} onChange={(e) => up("workerType", e.target.value as Common["workerType"])}><option value="short">아르바이트(short)</option><option value="contract">상용직(contract)</option></select></F>
          <F label="반려 사유"><input className="input" value={c.rejectionReason} onChange={(e) => up("rejectionReason", e.target.value)} /></F>
          <label className="flex items-center gap-2 self-end text-sm text-neutral-700"><input type="checkbox" checked={c.isSecond} onChange={(e) => up("isSecond", e.target.checked)} /> 2차(반려/승인)</label>
        </>}
      </fieldset>

      {/* 액션 카드 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {ACTIONS[category].map((a) => {
          const res = results[a.key];
          return (
            <div key={a.key} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-neutral-800">{a.label}</div>
                  {a.hint && <div className="text-[11px] text-neutral-400">{a.hint}</div>}
                </div>
                <button type="button" onClick={() => run(a.key)} disabled={!!running} className="btn-primary shrink-0">{running === a.key ? "실행 중..." : "실행"}</button>
              </div>
              {res && (
                <div className={`mt-2 rounded border p-2 text-xs ${res.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                  <div className={`mb-1 font-semibold ${res.ok ? "text-green-700" : "text-red-700"}`}>{res.ok ? "✅ 성공" : "❌ 실패"}</div>
                  <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] text-neutral-600">{res.logs.map((l, i) => <div key={i}>{l}</div>)}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-neutral-700">{label}</span>{children}</label>;
}
