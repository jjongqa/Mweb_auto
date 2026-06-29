"use client";

import { useEffect, useState, useCallback } from "react";
import { PixelAgent } from "./pixel-agent";

interface Agent {
  id: number;
  grp: string;
  nickname: string;
  hat: string;
  exp: string;
  color_c: string;
  color_b: string;
  color_s: string;
  instruction: string;
}

interface AgentInsight {
  nickname: string;
  grp: "design" | "write";
  runs: number;
  avgScore: number | null;
  bestScore: number | null;
  lowRuns: number;
  issueCounts: { error: number; warn: number };
  topIssues: { code: string; count: number }[];
  suggestions: string[];
}

interface AgentOfficeInsights {
  byNickname: Record<string, AgentInsight>;
  summary: {
    totalRuns: number;
    weakAgents: string[];
    repeatedIssueCodes: { code: string; count: number }[];
  };
}

interface TuneDraft {
  id: number;
  nickname: string;
  summary: string;
  current: string;
  proposed: string;
  model?: string;
}

const SUBS = [
  { g: "design", label: "설계", emoji: "🔬", use: "QA 설계", href: "/qa-design" },
  { g: "write", label: "작성", emoji: "🧬", use: "TC 생성", href: "/tc-gen" },
  { g: "exec", label: "수행", emoji: "▶️", use: "기능테스트 실행", href: "/upload" },
  { g: "data", label: "테스트데이터", emoji: "🧪", use: "데이터 생성", href: "/test-data" },
];

const WRITE_INSTRUCTION_TEMPLATES = [
  {
    label: "정상/노출",
    text: "정상 플로우, 화면 노출, 문구, CTA, 상태 전환을 담당한다. 각 TC는 단일 검증 의도로 쪼개고 Expected Result에는 화면 판정 기준을 구체적으로 적는다.",
  },
  {
    label: "경계/예외",
    text: "경계값, 예외, 미노출, 권한/상태 불일치, 실패 조건을 담당한다. 정상 케이스와 중복하지 말고 실패 시 관찰 가능한 화면/응답 기준을 Expected Result에 적는다.",
  },
  {
    label: "리그레션",
    text: "리그레션/회귀 영향 범위를 담당한다. 기존 기능, 기존 팝업/배너, GNB/장바구니, 로그인 상태 전환 등 영향받을 수 있는 주변 기능을 Type='리그레션'으로 작성한다.",
  },
  {
    label: "REQ 커버",
    text: "QA 설계의 REQ-ID 커버리지를 담당한다. 각 TC Tags에 관련 REQ-ID를 반드시 포함하고, 미커버 REQ가 없도록 요구사항별 정상/예외/경계 케이스를 보강한다.",
  },
];

const DATA_INSTRUCTION_TEMPLATES = [
  {
    label: "사전 준비",
    text: "TC의 사전조건과 기대결과를 읽고 필요한 테스트 데이터를 먼저 식별한다. 회원/멤버스/주문/상품/쿠폰/배송/후기/물류 데이터로 분류하고, 사용 가능한 테스트 데이터 페이지와 API를 매핑한다.",
  },
  {
    label: "안전 생성",
    text: "STG 테스트 데이터만 다룬다. 실제 생성 전에는 생성 계획, 필요한 계정/토큰, 생성 수량, 영향 범위를 요약한다. 상태 변경성 데이터(VIP, 쿠폰 발급, 배송완료, 구독 변경)는 승인 없이 대량 생성하지 않는다.",
  },
  {
    label: "수행 전달",
    text: "생성된 memberNo, orderNo, dealProductNo, couponId, promotionCode 등 실행에 필요한 식별자를 dataContext로 정리해 수행 에이전트에게 전달한다. TC 수행 중 데이터가 부족하면 추가 생성 후보와 이유를 먼저 보고한다.",
  },
  {
    label: "데이터 검증",
    text: "생성 또는 준비된 테스트 데이터가 TC 사전조건을 실제로 만족하는지 검증한다. memberNo, orderNo, dealProductNo, couponId, promotionCode 등 식별자가 유효한지 확인하고, 누락/불일치/상태 미충족 항목은 수행 전 보완 필요로 분리한다.",
  },
];

// ⚠️ NameEdit/InstrEditor 는 반드시 모듈 레벨. AgentsOffice 안에 정의하면 매 렌더(특히 3초 폴링·타이핑)마다
// 새 함수 신원이 생겨 React 가 <input>/<textarea> 를 리마운트 → 조합 중인 한글 IME 가 깨져 자모로 분해된다.
function NameEdit({
  a, big, editing, value, onStart, onChange, onSave, onCancel,
}: {
  a: Agent; big?: boolean; editing: boolean; value: string;
  onStart: (a: Agent) => void; onChange: (v: string) => void; onSave: (id: number) => void; onCancel: () => void;
}) {
  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onSave(a.id)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return; // 한글 조합 확정용 Enter 는 무시
          if (e.key === "Enter") onSave(a.id);
          if (e.key === "Escape") onCancel();
        }}
        maxLength={24}
        className="w-24 rounded border border-kurly-300 px-1 py-0.5 text-center text-sm focus:outline-none"
      />
    );
  }
  return (
    <button
      onClick={() => onStart(a)}
      className={`group inline-flex items-center gap-1 ${big ? "text-[15px]" : "text-[13px]"} font-medium hover:text-kurly-500`}
      title="클릭해서 이름 변경"
    >
      {a.nickname}
      <span className="text-[10px] text-neutral-300 group-hover:text-kurly-400">✏️</span>
    </button>
  );
}

function InstrEditor({
  a, full, open, onToggle, onChangeLocal, onSave,
}: {
  a: Agent; full?: boolean; open: boolean;
  onToggle: (id: number) => void; onChangeLocal: (id: number, v: string) => void; onSave: (id: number, v: string) => void;
}) {
  const has = (a.instruction || "").trim().length > 0;
  if (open) {
    return (
      <div className={full ? "mt-2" : "mt-2 border-t border-neutral-100 pt-2 text-left"}>
        {(a.grp === "write" || a.grp === "data") && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(a.grp === "data" ? DATA_INSTRUCTION_TEMPLATES : WRITE_INSTRUCTION_TEMPLATES).map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChangeLocal(a.id, tpl.text)}
                className="rounded border border-kurly-200 bg-kurly-50 px-2 py-0.5 text-[10px] font-medium text-kurly-700 hover:bg-kurly-100"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          autoFocus
          value={a.instruction || ""}
          onChange={(e) => onChangeLocal(a.id, e.target.value)}
          onBlur={(e) => onSave(a.id, e.target.value)}
          rows={full ? 3 : 2}
          maxLength={2000}
          placeholder="이 에이전트에게 줄 지시 — 멀티 수행 시 이 에이전트의 프롬프트에 주입됩니다. (예: 결제·쿠폰 시나리오 위주, 엣지케이스 강화)"
          className="w-full resize-y rounded border border-kurly-300 px-2 py-1 text-[12px] leading-snug focus:border-kurly-400 focus:outline-none"
        />
        <p className="mt-0.5 text-[10px] text-neutral-400">입력칸 밖을 클릭하면 저장돼요</p>
      </div>
    );
  }
  return (
    <div className={full ? "mt-2" : "mt-2 border-t border-neutral-100 pt-1.5 text-left"}>
      <button
        onClick={() => onToggle(a.id)}
        className={`inline-flex max-w-full items-center gap-1 ${has ? "text-kurly-600" : "text-neutral-400 hover:text-kurly-500"} text-[11px]`}
        title="이 에이전트에게 줄 지시 편집"
      >
        <span className="shrink-0">📝</span>
        {has ? <span className="truncate">{a.instruction}</span> : <span>지시 추가</span>}
      </button>
    </div>
  );
}

function gradeTone(score: number | null) {
  if (score === null) return "bg-neutral-100 text-neutral-500";
  if (score >= 90) return "bg-emerald-100 text-emerald-700";
  if (score >= 75) return "bg-blue-100 text-blue-700";
  if (score >= 60) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function agentInsightKey(a: Agent) {
  if (a.grp !== "design" && a.grp !== "write") return "";
  return `${a.grp}:${a.nickname}`;
}

function extractTokens(text: string) {
  const words = (text || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  const stop = new Set(["담당한다", "작성한다", "검증", "Expected", "Result", "REQ", "TC", "화면", "조건", "기대결과", "작성"]);
  return new Set(words.filter((w) => !stop.has(w)));
}

function roleConflicts(agents: Agent[]) {
  const write = agents.filter((a) => a.grp === "write" && a.instruction.trim());
  const out: { a: string; b: string; terms: string[] }[] = [];
  for (let i = 0; i < write.length; i++) {
    for (let j = i + 1; j < write.length; j++) {
      const ai = extractTokens(write[i].instruction);
      const bj = extractTokens(write[j].instruction);
      const terms = [...ai].filter((t) => bj.has(t)).slice(0, 5);
      if (terms.length >= 2) out.push({ a: write[i].nickname, b: write[j].nickname, terms });
    }
  }
  return out.slice(0, 3);
}

function AgentOpsPanel({
  agents,
  insights,
}: {
  agents: Agent[];
  insights: AgentOfficeInsights | null;
}) {
  const conflicts = roleConflicts(agents);
  if (!insights && conflicts.length === 0) return null;
  const repeated = insights?.summary.repeatedIssueCodes ?? [];
  const weak = insights?.summary.weakAgents ?? [];
  return (
    <section className="card border-cyan-200 bg-cyan-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-cyan-950">에이전트 운영 인사이트</h2>
          <p className="mt-0.5 text-xs text-cyan-800">최근 설계/TC 품질 리뷰를 기준으로 반복 이슈와 역할 충돌을 점검합니다.</p>
        </div>
        {insights && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-cyan-700">최근 {insights.summary.totalRuns}건 분석</span>}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="rounded-md border border-cyan-100 bg-white p-3">
          <div className="text-[11px] font-medium text-neutral-500">반복 품질 이슈</div>
          {repeated.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {repeated.map((i) => <span key={i.code} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700">{i.code} {i.count}</span>)}
            </div>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">아직 집계할 이슈가 적습니다.</p>
          )}
        </div>
        <div className="rounded-md border border-cyan-100 bg-white p-3">
          <div className="text-[11px] font-medium text-neutral-500">보완 우선 에이전트</div>
          {weak.length > 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-neutral-700">{weak.slice(0, 4).join(" · ")}</p>
          ) : (
            <p className="mt-2 text-xs text-emerald-700">최근 평균 기준 미달 에이전트가 없습니다.</p>
          )}
        </div>
        <div className="rounded-md border border-cyan-100 bg-white p-3">
          <div className="text-[11px] font-medium text-neutral-500">작성 역할 충돌 감지</div>
          {conflicts.length > 0 ? (
            <div className="mt-2 space-y-1">
              {conflicts.map((c) => (
                <p key={`${c.a}-${c.b}`} className="text-xs text-amber-700">{c.a}/{c.b}: {c.terms.join(", ")}</p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-emerald-700">현재 작성 지시 간 키워드 충돌은 낮습니다.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function AgentsOffice({
  workers,
  detected,
  insightsByWorker,
}: {
  workers: { name: string; label: string }[];
  detected?: string | null;
  insightsByWorker?: Record<string, AgentOfficeInsights>;
}) {
  const [worker, setWorker] = useState<string>("");
  const [picking, setPicking] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [modes, setModes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const [openInstr, setOpenInstr] = useState<Set<number>>(new Set());
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const [mainActive, setMainActive] = useState(false);
  const [savingSuggestionId, setSavingSuggestionId] = useState<number | null>(null);
  const [suggestionMsg, setSuggestionMsg] = useState<Record<number, { kind: "ok" | "error"; text: string }>>({});
  const [tuningId, setTuningId] = useState<number | null>(null);
  const [tuneDraft, setTuneDraft] = useState<TuneDraft | null>(null);
  const [tuneError, setTuneError] = useState("");

  const load = useCallback(async (w: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/agents?worker=${encodeURIComponent(w)}`);
      const d = await r.json();
      setAgents(d.agents || []);
      setModes(d.modes || {});
    } finally {
      setLoading(false);
    }
  }, []);

  // 마운트 시 워커 결정: 1) 기억한 선택 2) 접속 IP 자동감지 3) 선택 화면
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("agents.worker") : null;
    const savedValid = saved && workers.some((w) => w.name === saved) ? saved : "";
    if (savedValid) {
      setWorker(savedValid);
      setPicking(false);
    } else if (detected && workers.some((w) => w.name === detected)) {
      if (typeof window !== "undefined") localStorage.setItem("agents.worker", detected);
      setWorker(detected);
      setPicking(false);
    } else {
      setPicking(true);
    }
  }, [workers, detected]);

  useEffect(() => {
    if (worker && !picking) load(worker);
  }, [worker, picking, load]);

  // 수행 중 에이전트 폴링 — 3초마다 캐릭터 깡총 모션 갱신.
  useEffect(() => {
    if (!worker || picking) {
      setActiveAgents(new Set());
      setMainActive(false);
      return;
    }
    let cancel = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/agents/active?worker=${encodeURIComponent(worker)}`);
        const d = await r.json();
        if (cancel) return;
        setActiveAgents(new Set<string>(d.active || []));
        setMainActive(!!d.main);
      } catch {
        /* 무시 */
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [worker, picking]);

  function chooseWorker(w: string) {
    if (typeof window !== "undefined") localStorage.setItem("agents.worker", w);
    setWorker(w);
    setPicking(false);
  }

  const startEdit = (a: Agent) => {
    setEditingId(a.id);
    setEditVal(a.nickname);
  };
  const cancelEdit = () => setEditingId(null);

  async function saveName(id: number) {
    const v = editVal.trim();
    setEditingId(null);
    if (!v) return;
    setAgents((a) => a.map((x) => (x.id === id ? { ...x, nickname: v } : x)));
    await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rename", id, nickname: v }) });
  }

  async function toggleMode(grp: string, mode: string) {
    setModes((m) => ({ ...m, [grp]: mode }));
    await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mode", worker, grp, mode }) });
  }

  async function add(grp: string) {
    const r = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", worker, grp }) });
    const d = await r.json();
    if (d.agent) setAgents((a) => [...a, d.agent]);
  }

  async function del(id: number) {
    setAgents((a) => a.filter((x) => x.id !== id));
    await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
  }

  function toggleInstr(id: number) {
    setOpenInstr((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function setInstrLocal(id: number, val: string) {
    setAgents((a) => a.map((x) => (x.id === id ? { ...x, instruction: val } : x)));
  }

  async function saveInstr(id: number, value: string) {
    setOpenInstr((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setAgents((a) => a.map((x) => (x.id === id ? { ...x, instruction: value } : x)));
    const res = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "instruct", id, instruction: value }) });
    if (!res.ok) throw new Error("지시 저장 실패");
  }

  async function applySuggestion(id: number, suggestion: string) {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    const cur = (agent.instruction || "").trim();
    const already = cur.includes(suggestion);
    const next = already ? cur : [cur, suggestion].filter(Boolean).join("\n");
    setSavingSuggestionId(id);
    setSuggestionMsg((m) => ({ ...m, [id]: { kind: "ok", text: already ? "이미 반영된 지시입니다." : "지시 개선을 반영 중..." } }));
    try {
      setInstrLocal(id, next);
      const res = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "instruct", id, instruction: next }) });
      if (!res.ok) throw new Error("지시 저장 실패");
      setOpenInstr((s) => {
        const n = new Set(s);
        n.add(id);
        return n;
      });
      setSuggestionMsg((m) => ({ ...m, [id]: { kind: "ok", text: already ? "이미 반영되어 있어요." : "반영 완료. 지시 내용을 열어뒀어요." } }));
    } catch (err) {
      setInstrLocal(id, cur);
      setSuggestionMsg((m) => ({ ...m, [id]: { kind: "error", text: err instanceof Error ? err.message : "반영 실패" } }));
    } finally {
      setSavingSuggestionId(null);
    }
  }

  async function makeAiTune(a: Agent) {
    setTuningId(a.id);
    setTuneError("");
    try {
      const res = await fetch("/api/agents/tune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "AI 개선안 생성 실패");
      setTuneDraft({
        id: a.id,
        nickname: a.nickname,
        summary: json.summary || "지시사항 개선안",
        current: json.current_instruction || "",
        proposed: json.proposed_instruction || "",
        model: json.model,
      });
    } catch (err) {
      setTuneError(err instanceof Error ? err.message : "AI 개선안 생성 실패");
    } finally {
      setTuningId(null);
    }
  }

  async function applyAiTune() {
    if (!tuneDraft) return;
    await saveInstr(tuneDraft.id, tuneDraft.proposed);
    setOpenInstr((s) => {
      const n = new Set(s);
      n.add(tuneDraft.id);
      return n;
    });
    setSuggestionMsg((m) => ({ ...m, [tuneDraft.id]: { kind: "ok", text: "AI 개선안을 반영했어요." } }));
    setTuneDraft(null);
  }

  const main = agents.find((a) => a.grp === "main");
  const insights = worker ? insightsByWorker?.[worker] ?? null : null;

  if (workers.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        등록된 워커가 없어요. 워커를 시작하면 여기서 그 워커의 에이전트를 꾸밀 수 있어요.
      </div>
    );
  }

  // 이 PC의 워커 선택 화면 (최초 1회 또는 "변경" 시)
  if (picking || !worker) {
    return (
      <div className="card p-6">
        <h2 className="text-base font-semibold">이 PC의 워커를 선택하세요</h2>
        <p className="mt-1 text-sm text-neutral-500">
          접속한 PC가 자동 인식되면 그 워커로 바로 고정됩니다. 인식이 안 될 때만 여기서 한 번 고르면 이 브라우저에 기억돼요. (다른 워커 것은 보이지 않음)
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {workers.map((w) => {
            const isDetected = !!detected && w.name === detected;
            return (
              <button
                key={w.name}
                onClick={() => chooseWorker(w.name)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm ${
                  isDetected || w.name === worker
                    ? "border-kurly-500 bg-kurly-50 text-kurly-700"
                    : "border-neutral-200 hover:border-kurly-300 hover:bg-neutral-50"
                }`}
              >
                {w.label}
                {isDetected && <span className="rounded-full bg-kurly-500 px-1.5 py-0.5 text-[10px] font-medium text-white">이 PC</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const currentLabel = workers.find((w) => w.name === worker)?.label || worker;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">나(워커):</span>
          <span className="font-medium">{currentLabel}</span>
          <button onClick={() => setPicking(true)} className="text-xs text-neutral-400 underline-offset-2 hover:text-kurly-500 hover:underline" title="이 PC가 다른 워커라면 변경">
            변경
          </button>
        </div>
        {loading && <span className="text-xs text-neutral-400">불러오는 중…</span>}
      </div>

      {main && (
        <div className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-neutral-50">
            <PixelAgent hat={main.hat} exp={main.exp} c={main.color_c} b={main.color_b} s={main.color_s} size={52} hop={mainActive} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <NameEdit a={main} big editing={editingId === main.id} value={editVal} onStart={startEdit} onChange={setEditVal} onSave={saveName} onCancel={cancelEdit} />
              <span className="text-xs text-neutral-400">· 오케스트레이터</span>
              {mainActive && <span className="badge bg-emerald-100 text-emerald-700">● 수행 중</span>}
            </div>
            <p className="mt-0.5 text-sm text-neutral-600">TC 분석 · 분할 · 배분 · 결과 취합 (멀티 모드의 지휘자 · 단일 모드에선 메인 혼자 수행)</p>
            <InstrEditor a={main} full open={openInstr.has(main.id)} onToggle={toggleInstr} onChangeLocal={setInstrLocal} onSave={saveInstr} />
          </div>
        </div>
      )}

      <AgentOpsPanel agents={agents} insights={insights} />
      {tuneError && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{tuneError}</div>}

      {SUBS.map(({ g, label, emoji, use, href }) => {
        const list = agents.filter((a) => a.grp === g);
        const multi = modes[g] === "multi";
        return (
          <div key={g}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">
                  {emoji} {label} 에이전트
                </span>
                <span className="text-xs text-neutral-400">{multi ? `멀티 · ${list.length}명` : "단일 모드 — 메인만 수행"}</span>
                <a href={href} className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-500 hover:border-kurly-200 hover:text-kurly-600">
                  {use}에 적용
                </a>
              </div>
              <div className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs">
                <button onClick={() => toggleMode(g, "single")} className={`px-3 py-1 ${!multi ? "bg-kurly-500 text-white" : "text-neutral-500 hover:bg-neutral-50"}`}>
                  단일
                </button>
                <button onClick={() => toggleMode(g, "multi")} className={`px-3 py-1 ${multi ? "bg-kurly-500 text-white" : "text-neutral-500 hover:bg-neutral-50"}`}>
                  멀티
                </button>
              </div>
            </div>
            {g === "write" && multi && (
              <p className="mb-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800">
                💡 지시를 <b>비워두면</b> 자동으로 상호배타 역할(① 정상·노출·문구 / ② 경계·예외·엣지 / ③ 리그레션·회귀)이 배정돼 <b>중복 없이</b> 분담합니다. 지시를 적으면 그 지시가 그 에이전트의 담당 영역이 되고, 다른 에이전트 영역은 작성하지 않습니다.
              </p>
            )}
            {g === "data" && (
              <p className="mb-2 rounded-md bg-cyan-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-cyan-800">
                🧪 테스트데이터 에이전트는 TC 수행 중 수행 에이전트가 데이터 부족을 발견했을 때만 호출됩니다. 필요한 데이터 생성/검증 후 dataContext를 돌려주고, 수행 에이전트가 그 데이터로 이어서 실행합니다.
              </p>
            )}
            <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 ${multi ? "" : "opacity-50"}`}>
              {list.map((a, i) => (
                <div key={a.id} className="card relative flex flex-col p-3 text-center">
                  {a.grp !== "main" && list.length > 1 && (
                    <button onClick={() => del(a.id)} className="absolute right-1.5 top-1.5 text-neutral-300 hover:text-rose-500" title="삭제" aria-label="삭제">
                      <span className="text-xs">✕</span>
                    </button>
                  )}
                  <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-md bg-neutral-50">
                    <PixelAgent hat={a.hat} exp={a.exp} c={a.color_c} b={a.color_b} s={a.color_s} size={44} hop={activeAgents.has(a.nickname)} />
                  </div>
                  <div>
                    <NameEdit a={a} editing={editingId === a.id} value={editVal} onStart={startEdit} onChange={setEditVal} onSave={saveName} onCancel={cancelEdit} />
                  </div>
                  <p className="mt-0.5 text-[11px]">
                    {activeAgents.has(a.nickname) ? (
                      <span className="font-medium text-emerald-600">● 수행 중</span>
                    ) : (
                      <span className="text-neutral-400">{label}-{i + 1}</span>
                    )}
                  </p>
                  <InstrEditor a={a} open={openInstr.has(a.id)} onToggle={toggleInstr} onChangeLocal={setInstrLocal} onSave={saveInstr} />
                  {(() => {
                    const insight = insights?.byNickname[agentInsightKey(a)];
                    if (!insight || insight.runs === 0) return null;
                    return (
                      <div className="mt-2 rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5 text-left">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${gradeTone(insight.avgScore)}`}>
                            평균 {insight.avgScore ?? "-"}
                          </span>
                          <span className="text-[10px] text-neutral-400">{insight.runs}회</span>
                        </div>
                        {insight.topIssues.length > 0 && (
                          <div className="mt-1 truncate text-[10px] text-neutral-500" title={insight.topIssues.map((x) => `${x.code} ${x.count}`).join(", ")}>
                            {insight.topIssues.slice(0, 2).map((x) => x.code).join(" · ")}
                          </div>
                        )}
                        {insight.suggestions[0] && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => makeAiTune(a)}
                              disabled={tuningId === a.id}
                              className="rounded border border-violet-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                              title="현재 지시사항과 반복 품질 이슈를 AI가 함께 보고 개선안을 만듭니다."
                            >
                              {tuningId === a.id ? "AI 생성 중..." : "AI 개선안"}
                            </button>
                            <button
                              type="button"
                              onClick={() => applySuggestion(a.id, insight.suggestions[0])}
                              disabled={savingSuggestionId === a.id}
                              className="rounded border border-cyan-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                              title={insight.suggestions[0]}
                            >
                              {savingSuggestionId === a.id ? "반영 중..." : "규칙 반영"}
                            </button>
                          </div>
                        )}
                        {suggestionMsg[a.id] && (
                          <div className={`mt-1 text-[10px] ${suggestionMsg[a.id].kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
                            {suggestionMsg[a.id].text}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
              {multi && (
                <button onClick={() => add(g)} className="flex min-h-[120px] flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-neutral-300 text-neutral-400 hover:border-kurly-300 hover:text-kurly-500">
                  <span className="text-2xl leading-none">+</span>
                  <span className="text-xs">에이전트 추가</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
      {tuneDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setTuneDraft(null)}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">AI 지시 튜닝 · {tuneDraft.nickname}</h2>
                <p className="mt-1 text-xs text-neutral-500">{tuneDraft.summary}{tuneDraft.model ? ` · ${tuneDraft.model}` : ""}</p>
              </div>
              <button onClick={() => setTuneDraft(null)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">현재 지시</div>
                <pre className="min-h-[260px] whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-700">{tuneDraft.current || "(비어 있음)"}</pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-violet-600">AI 개선안</div>
                <textarea
                  value={tuneDraft.proposed}
                  onChange={(e) => setTuneDraft((d) => d ? { ...d, proposed: e.target.value } : d)}
                  rows={14}
                  maxLength={2000}
                  className="min-h-[260px] w-full resize-y rounded-md border border-violet-200 bg-violet-50/40 p-3 text-xs leading-relaxed focus:border-violet-400 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTuneDraft(null)} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">취소</button>
              <button onClick={applyAiTune} className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">이 개선안 반영</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
