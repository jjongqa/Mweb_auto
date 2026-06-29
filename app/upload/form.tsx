"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CsvAnalysisResult } from "@/lib/csv-analyzer";
import { BuDomainSelect } from "@/app/_components/bu-domain-select";
import { WorkerStatusBanner } from "@/app/_components/worker-status-banner";
import { ConfluenceTokenBanner } from "@/app/_components/confluence-token-banner";
import { confirmDialog } from "@/app/_components/confirm-dialog";
import { SpecUrlValidator } from "@/app/_components/spec-url-validator";
import { PocSelector } from "@/app/_components/poc-selector";
import { getPocById } from "@/lib/pocs";

const MY_NAME_KEY = "kurly-qa:jira-settings:my-name";

type WorkerOption = {
  name: string;
  label?: string | null;
  status: string;
  status_label: string;
  capabilities: { web?: boolean; app?: boolean } | null;
  is_self?: boolean;
  active_jobs?: number;
  max_concurrent?: number;
  version?: string | null;
};

export function UploadForm({ domainAvgSec = {} }: { domainAvgSec?: Record<string, number> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loadedFromTcGen, setLoadedFromTcGen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [analysis, setAnalysis] = useState<CsvAnalysisResult | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string>("");

  const [domain, setDomain] = useState("");
  const [platform, setPlatform] = useState<"web" | "mweb" | "app">("web");
  const [qaEnv, setQaEnv] = useState("");
  const [taskName, setTaskName] = useState("");
  const [epicKey, setEpicKey] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);

  // localStorage 자동 임시저장 — 페이지 진입 시 복원, 변경 시 저장, 제출 후 clear
  const DRAFT_KEY = "kurly-qa:draft:upload:additional_instructions";
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        setAdditionalInstructions(saved);
        setDraftRestored(true);
      }
      // 실행자 자동 채움 — jira-settings 에서 등록한 본인 이름 재사용 (토큰 라우팅 일치 + 타이핑 0)
      const myName = localStorage.getItem(MY_NAME_KEY);
      if (myName) setRequestedBy(myName);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (additionalInstructions) localStorage.setItem(DRAFT_KEY, additionalInstructions);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [additionalInstructions]);
  const [specUrl, setSpecUrl] = useState("");
  const [specPdf, setSpecPdf] = useState<File | null>(null);
  const [mode, setMode] = useState<"mock" | "real">("mock");
  const [claudeModel, setClaudeModel] = useState<"" | "claude-sonnet-4-6" | "claude-opus-4-8" | "codex">("");

  // 특정 워커를 직접 지정하면 원격 처리 전제라 REAL 로 강제. 내장 워커 기본값은 worker_name 미지정.
  const [filterPriority, setFilterPriority] = useState<"all" | "P1" | "P1+P2">("all");
  const [filterRange, setFilterRange] = useState<{ enabled: boolean; start: number; end: number }>({
    enabled: false, start: 1, end: 10,
  });
  // v1.0 Phase 2: 워커 선택
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string>("");
  const [builtinWorker, setBuiltinWorker] = useState<string>("");

  // Phase 2 멀티 분할 수행 — 선택 워커의 exec 그룹 모드/에이전트
  const [execMode, setExecMode] = useState<string>("single");
  const [execAgents, setExecAgents] = useState<{ nickname: string; instruction: string }[]>([]);
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(true);

  // POC(시트분류) 모드 — CSV에 시트분류 컬럼이 있으면 POC 선택 → POC별 잡 분할
  const availablePocs = analysis?.pocCounts?.map((p) => p.poc) ?? [];
  const pocMode = availablePocs.length > 0;
  const [selectedPocs, setSelectedPocs] = useState<string[]>([]);
  // 분석 결과 바뀌면 시트분류 존재 시 기본 전체 선택
  useEffect(() => {
    setSelectedPocs(analysis?.pocCounts?.map((p) => p.poc) ?? []);
  }, [analysis]);

  // 워커 목록 fetch (10초마다 자동 갱신). 내장 워커 운영에서는 자동 선택하지 않고 worker_name=null 로 둔다.
  useEffect(() => {
    let cancel = false;
    async function loadWorkers() {
      try {
        const res = await fetch("/api/workers/list");
        const json = await res.json();
        if (cancel) return;
        const list: WorkerOption[] = json.workers || [];
        setWorkers(list);
        setBuiltinWorker(json.builtin_worker || "");
        setSelectedWorker((cur) => cur || json.builtin_worker || list.find((w) => w.version === "builtin")?.name || "");
      } catch {
        if (!cancel) setWorkers([]);
      }
    }
    loadWorkers();
    const t = setInterval(loadWorkers, 10000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  // 특정 워커 선택 시 MOCK 자동 비활성 → REAL 강제
  useEffect(() => {
    const selected = workers.find((w) => w.name === selectedWorker);
    const isBuiltin = !!selectedWorker && (selectedWorker === builtinWorker || selected?.version === "builtin");
    if (selectedWorker && !isBuiltin && mode === "mock") setMode("real");
  }, [selectedWorker, mode, workers, builtinWorker]);

  // 선택 워커의 exec 그룹 모드/에이전트 조회 (멀티 분할 수행 가능 여부 판단)
  useEffect(() => {
    if (!selectedWorker) { setExecMode("single"); setExecAgents([]); return; }
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/agents?worker=${encodeURIComponent(selectedWorker)}`);
        const d = await r.json();
        if (cancel) return;
        setExecMode(d.modes?.exec || "single");
        setExecAgents(
          (d.agents || [])
            .filter((a: { grp: string }) => a.grp === "exec")
            .map((a: { nickname: string; instruction?: string }) => ({ nickname: a.nickname, instruction: a.instruction || "" }))
        );
      } catch {
        if (!cancel) { setExecMode("single"); setExecAgents([]); }
      }
    })();
    return () => { cancel = true; };
  }, [selectedWorker]);

  // 멀티 분할 가능: 비-POC + 선택워커 exec=multi + 에이전트 2명 이상
  const multiAvailable = execMode === "multi" && execAgents.length >= 2;  // POC 모드와 병행 가능(POC 필터된 행을 다시 에이전트 청크로 분할)
  const selectedWorkerMeta = workers.find((w) => w.name === selectedWorker);
  const selectedIsBuiltin = !!selectedWorker && (selectedWorker === builtinWorker || selectedWorkerMeta?.version === "builtin");
  const selectedWorkerSlots = selectedWorkerMeta?.max_concurrent ?? 1;
  const hideQaEnv = !pocMode && platform === "app";

  // TC 생성 페이지에서 넘어온 경우(?tcGenId=) — 생성된 CSV 를 자동 로드 + 분석
  useEffect(() => {
    const tcGenId = searchParams.get("tcGenId");
    const tcGenGroupId = searchParams.get("tcGenGroupId");  // 작성 그룹이면 합본 CSV(전체 에이전트) 로드
    if (!tcGenId) return;
    let cancelled = false;
    (async () => {
      try {
        setError("");
        const metaRes = await fetch(`/api/tc-gen/${tcGenId}`);
        const metaJson = await metaRes.json();
        const job = metaJson.job;
        if (!job || job.status !== "succeeded") {
          setError("생성된 TC를 불러올 수 없습니다 (생성 완료 상태가 아님)");
          return;
        }
        const csvRes = await fetch(tcGenGroupId
          ? `/api/tc-gen/group/download?groupId=${encodeURIComponent(tcGenGroupId)}`
          : `/api/tc-gen/${tcGenId}/download`);
        if (!csvRes.ok) { setError("생성된 CSV 다운로드 실패"); return; }
        const blob = await csvRes.blob();
        const filename = tcGenGroupId ? `${job.domain || "TC"}_통합.csv` : (job.output_filename || `${job.domain}_TC.csv`);
        const file = new File([blob], filename, { type: "text/csv" });
        if (cancelled) return;
        if (job.requested_by) setRequestedBy(job.requested_by);
        await handleFilesChange([file]);   // 목록 추가 + CSV 자동 분석
        if (job.domain) setDomain(job.domain); // 분석 추천보다 생성 도메인 우선
        setLoadedFromTcGen(true);
      } catch (e) {
        if (!cancelled) setError("생성된 TC 불러오기 실패: " + (e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleFilesChange(newFiles: File[]) {
    // 기존 목록에 누적 (중복 파일명 제외)
    const merged = [...files];
    for (const f of newFiles) {
      if (!merged.some((x) => x.name === f.name && x.size === f.size)) merged.push(f);
    }
    setFiles(merged);
    await analyzeAll(merged);
  }

  function removeFile(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    if (next.length === 0) {
      setAnalysis(null);
      return;
    }
    analyzeAll(next);
  }

  async function analyzeAll(list: File[]) {
    if (list.length === 0) return;
    setAnalysis(null);
    setError("");
    setAnalyzing(true);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("tc_files", f);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "분석 실패");
      setAnalysis(json.analysis);
      if (json.analysis.recommendedDomain) setDomain(json.analysis.recommendedDomain);
      if (json.analysis.recommendedPlatform) setPlatform(json.analysis.recommendedPlatform);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  // 공통 필드 FormData (POC 분할 시 매 잡마다 새로 생성). poc/platform/worker 는 호출부에서 추가.
  function buildCommonFd(): FormData {
    const fd = new FormData();
    for (const f of files) fd.append("tc_files", f);
    fd.append("domain", domain);
    fd.append("qa_env", hideQaEnv ? "stg" : qaEnv);
    fd.append("task_name", taskName);
    fd.append("epic_key", epicKey);
    fd.append("requested_by", requestedBy);
    fd.append("mode", mode);
    fd.append("filter_priority", filterPriority);
    if (!pocMode && filterRange.enabled) {
      fd.append("filter_range_start", String(filterRange.start));
      fd.append("filter_range_end", String(filterRange.end));
    }
    fd.append("analyzer_summary", JSON.stringify(analysis ?? {}));
    if (additionalInstructions.trim()) fd.append("additional_instructions", additionalInstructions.trim());
    if (specUrl.trim()) fd.append("spec_url", specUrl.trim());
    if (specPdf) fd.append("spec_pdf", specPdf);
    if (claudeModel) fd.append("claude_model", claudeModel);
    return fd;
  }

  function rememberAndClear() {
    try {
      localStorage.removeItem(DRAFT_KEY);
      if (requestedBy.trim()) localStorage.setItem(MY_NAME_KEY, requestedBy.trim());
    } catch {}
  }

  // 선택 워커가 해당 플랫폼 지원하면 그 워커, 아니면 미지정(아무 워커나 claim)
  function workerForPlatform(plat: "web" | "app"): string {
    if (!selectedWorker) return "";
    const w = workers.find((x) => x.name === selectedWorker);
    const ok = plat === "app" ? w?.capabilities?.app : w?.capabilities?.web;
    return ok ? selectedWorker : "";
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (files.length === 0) { setError("TC 파일을 1개 이상 선택해 주세요"); return; }
    if (!domain) { setError("도메인을 선택해 주세요"); return; }
    if (!hideQaEnv && !qaEnv) { setError("QA 환경을 선택해 주세요"); return; }
    if (!requestedBy.trim()) {
      setError("실행자를 입력해 주세요 (jira-settings 에 등록한 본인 이름과 일치해야 본인 토큰 사용)");
      return;
    }
    if (pocMode && selectedPocs.length === 0) { setError("수행할 POC(시트분류)를 1개 이상 선택해 주세요"); return; }
    startSubmit(async () => {
      try {
        if (pocMode) {
          // POC별로 잡 1개씩 생성 (플랫폼은 서버가 POC로 자동 결정)
          const ids: string[] = [];
          for (const poc of selectedPocs) {
            const fd = buildCommonFd();
            fd.append("poc", poc);
            const plat = getPocById(poc)?.platform ?? "web";
            const w = workerForPlatform(plat);
            if (w) fd.append("worker_name", w);
            if (multiAvailable && multiAgentEnabled) fd.append("multi_agent", "1");  // 이 POC 행을 에이전트 N청크로 추가 분할
            const res = await fetch("/api/jobs", { method: "POST", body: fd });
            const json = await res.json();
            if (!res.ok || !json.ok) {
              setError(`${poc}: ${json.error || "작업 생성 실패"}${ids.length ? ` (앞선 ${ids.length}개는 생성됨)` : ""}`);
              if (ids.length === 0) return;
              break;
            }
            if (json.group_id) ids.push(...json.ids); else ids.push(json.id);   // 멀티면 청크 잡 N개
          }
          if (ids.length === 0) return;
          rememberAndClear();
          // 단일 결과·단일 POC(멀티 그룹)는 그 잡/첫 청크(그룹 배너)로, 그 외는 히스토리
          router.push(ids.length === 1 || selectedPocs.length === 1 ? `/jobs/${ids[0]}` : "/history");
        } else {
          const fd = buildCommonFd();
          fd.append("platform", platform);
          if (selectedWorker) fd.append("worker_name", selectedWorker);
          if (multiAvailable && multiAgentEnabled) fd.append("multi_agent", "1");
          const res = await fetch("/api/jobs", { method: "POST", body: fd });
          const json = await res.json();
          if (!res.ok || !json.ok) { setError(json.error || "작업 생성 실패"); return; }
          rememberAndClear();
          // 멀티 분할이면 그룹의 첫 청크 잡으로 이동(청크 그룹 합산 배너가 보임)
          router.push(json.group_id ? `/jobs/${json.ids[0]}` : `/jobs/${json.id}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // 추정 실행 시간 — REAL 은 도메인 실측 평균(없으면 45초 기본), MOCK 은 시뮬레이션.
  const realSecPerTc = (domain && domainAvgSec[domain]) || 45;
  const estimateFromHistory = mode === "real" && !!(domain && domainAvgSec[domain]);
  const estimatedSec = (() => {
    if (!analysis) return null;
    let n = analysis.totalRows;
    if (pocMode) {
      // 선택 POC 건수 합 (POC별 잡 분할 — 전체 합산 기준 추정)
      n = (analysis.pocCounts ?? []).filter((p) => selectedPocs.includes(p.poc)).reduce((s, p) => s + p.count, 0);
    } else {
      if (filterPriority === "P1") n = analysis.priorityCounts.P1;
      else if (filterPriority === "P1+P2") n = analysis.priorityCounts.P1 + analysis.priorityCounts.P2;
      if (filterRange.enabled) n = Math.min(n, Math.max(0, filterRange.end - filterRange.start + 1));
    }
    return mode === "real" ? n * realSecPerTc : n * 0.6;
  })();

  return (
    <form onSubmit={onSubmit} className="card mt-6 space-y-5 p-6">
      <WorkerStatusBanner />

      {loadedFromTcGen && (
        <div className="rounded-md border-l-4 border-l-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-700">
          🧬 <strong>생성된 TC를 불러왔습니다.</strong> 도메인이 자동 선택됐어요 — 플랫폼/환경/워커/모드만 고르고 실행하세요.
        </div>
      )}

      <div>
        <label className="label" htmlFor="tc_files">
          TC CSV 파일 <span className="text-rose-500">*</span>
          <span className="ml-2 text-xs font-normal text-neutral-500">(여러 개 선택 가능)</span>
        </label>
        <input
          id="tc_files"
          name="tc_files"
          type="file"
          accept=".csv"
          multiple
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : [];
            if (list.length > 0) handleFilesChange(list);
            // 같은 파일 재선택 가능하도록 input 초기화
            e.target.value = "";
          }}
          className="input file:mr-3 file:rounded file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-neutral-200"
        />
        {analyzing && <p className="mt-2 text-xs text-blue-600">📊 CSV 분석 중...</p>}
        {files.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-2 py-1">
                <span className="truncate text-neutral-700">📄 {f.name} <span className="text-neutral-400">({Math.round(f.size / 1024)} KB)</span></span>
                <button type="button" onClick={() => removeFile(i)} className="ml-2 text-rose-500 hover:text-rose-700">✕</button>
              </li>
            ))}
            <li className="text-neutral-500">총 {files.length}개 파일</li>
          </ul>
        )}
      </div>

      {analysis && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <div className="font-semibold text-neutral-700">자동 분석 결과</div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-700">
            <div>전체 케이스</div><div className="font-mono">{analysis.totalRows}</div>
            <div>추천 도메인</div><div className="font-mono">{analysis.recommendedDomain ?? "(불명확)"}</div>
            <div>추천 플랫폼</div><div className="font-mono">{analysis.recommendedPlatform ?? "(불명확)"}</div>
            <div>P1/P2/P3</div><div className="font-mono">{analysis.priorityCounts.P1} / {analysis.priorityCounts.P2} / {analysis.priorityCounts.P3}</div>
            <div>도메인 힌트</div><div className="font-mono text-[10px]">멤버스 {analysis.domainHints.멤버스} · 회원 {analysis.domainHints.회원} · 3P {analysis.domainHints["3P"]}</div>
          </div>
          {analysis.warnings.length > 0 && (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              ⚠ {analysis.warnings.join(" / ")}
            </div>
          )}
        </div>
      )}

      {pocMode && (
        <div className="rounded-md border border-kurly-300 bg-kurly-50/60 p-4">
          <div className="text-sm font-medium text-kurly-900">🧬 수행할 POC (시트분류)</div>
          <p className="mb-2 mt-0.5 text-xs text-kurly-700">
            선택한 POC별로 잡이 <strong>각각 분리 생성</strong>됩니다 (플랫폼 자동 · 시트분류 컬럼 기준 분할).
          </p>
          <PocSelector value={selectedPocs} onChange={setSelectedPocs} available={availablePocs} />
          {analysis?.pocCounts && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              {analysis.pocCounts.map((p) => (
                <span key={p.poc} className={selectedPocs.includes(p.poc) ? "text-kurly-700" : "text-neutral-400 line-through"}>
                  {p.poc} {p.count}건
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="label">도메인 *</label>
        <BuDomainSelect value={domain} onChange={setDomain} required />
      </div>

      <div className={`grid grid-cols-1 gap-4 ${hideQaEnv ? "" : "md:grid-cols-2"}`}>
        <div>
          <label className="label">플랫폼 {pocMode ? "(POC 자동)" : "*"}</label>
          {pocMode ? (
            <div className="input flex items-center bg-neutral-50 text-xs text-neutral-500">
              POC별 자동 — 앱→Mobile MCP, 웹→Playwright
            </div>
          ) : (
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as "web" | "mweb" | "app")}
              required
              className="input"
            >
              <option value="web">Web (데스크톱)</option>
              <option value="mweb">Mweb (모바일 웹)</option>
              <option value="app">App (네이티브)</option>
            </select>
          )}
        </div>
        {!hideQaEnv && (
          <div>
            <label className="label">테스트 환경 URL *</label>
            <input
              type="url"
              value={qaEnv}
              onChange={(e) => setQaEnv(e.target.value.trim())}
              required
              className="input font-mono"
              placeholder="https://stg.kurly.com"
            />
            <p className="mt-0.5 text-[11px] text-neutral-400">워커가 접근 가능한 베이스 URL 전체 입력 (https://...)</p>
          </div>
        )}
      </div>

      <div>
        <label className="label">과제명 (선택)</label>
        <input
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="예: 장바구니_멤버스_최대혜택가"
          className="input"
        />
      </div>

      {analysis && analysis.totalRows > 5 && !pocMode && (
        <div className="rounded-md border border-neutral-200 p-3">
          <div className="text-sm font-semibold">실행 범위 (선택)</div>
          <p className="mt-1 text-xs text-neutral-500">전체가 아닌 일부만 빠르게 검증할 때 사용</p>

          <div className="mt-3 space-y-2 text-sm">
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={filterPriority === "all"} onChange={() => setFilterPriority("all")} />
                전체 ({analysis.totalRows}개)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={filterPriority === "P1"} onChange={() => setFilterPriority("P1")} />
                P1만 ({analysis.priorityCounts.P1}개)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={filterPriority === "P1+P2"} onChange={() => setFilterPriority("P1+P2")} />
                P1+P2 ({analysis.priorityCounts.P1 + analysis.priorityCounts.P2}개)
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={filterRange.enabled}
                onChange={(e) => setFilterRange({ ...filterRange, enabled: e.target.checked })}
              />
              <span>범위 지정:</span>
              <input
                type="number"
                min={1}
                max={analysis.totalRows}
                value={filterRange.start}
                onChange={(e) => {
                  const start = Math.max(1, Math.min(Number(e.target.value) || 1, analysis.totalRows));
                  setFilterRange((p) => ({ ...p, start, end: Math.max(start, p.end) }));
                }}
                disabled={!filterRange.enabled}
                className="w-16 rounded border border-neutral-300 px-1 py-0.5"
              />
              <span>~</span>
              <input
                type="number"
                min={1}
                max={analysis.totalRows}
                value={filterRange.end}
                onChange={(e) => {
                  const end = Math.max(1, Math.min(Number(e.target.value) || 1, analysis.totalRows));
                  setFilterRange((p) => ({ ...p, end, start: Math.min(p.start, end) }));
                }}
                disabled={!filterRange.enabled}
                className="w-16 rounded border border-neutral-300 px-1 py-0.5"
              />
              <span>번 행</span>
            </label>
          </div>
        </div>
      )}

      <div>
        <label className="label">Jira 에픽 키 (선택)</label>
        <input
          type="text"
          value={epicKey}
          onChange={(e) => setEpicKey(e.target.value)}
          placeholder="예: KQA-31006"
          className="input"
        />
      </div>

      <div>
        <label className="label">실행자 *</label>
        <input
          type="text"
          value={requestedBy}
          onChange={(e) => setRequestedBy(e.target.value)}
          placeholder="예: 종관 (jira-settings 등록 이름과 동일하게)"
          className="input"
          required
        />
      </div>

      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-2 text-sm font-medium text-neutral-700">📎 기획 문서 (선택)</div>
        <p className="mb-3 text-xs text-neutral-700">
          기획서 URL이나 PDF를 첨부하면 Claude가 TC 실행 시 함께 참고합니다. (PDF는 텍스트 추출 후 앞 8,000자 사용)
        </p>
        <div className="mb-2">
          <ConfluenceTokenBanner />
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-neutral-700">기획 문서 URL <span className="text-neutral-500">(여러 개 — 한 줄당 1개)</span></label>
            <textarea
              value={specUrl}
              onChange={(e) => setSpecUrl(e.target.value)}
              placeholder={"예:\nhttps://kurly0521.atlassian.net/wiki/spaces/CMS/pages/.../\nhttps://figma.com/spec/xyz"}
              rows={3}
              className="input font-mono text-xs"
            />
            <SpecUrlValidator specUrl={specUrl} requestedBy={requestedBy} />
          </div>
          <div>
            <label className="text-xs text-neutral-700">기획 PDF 첨부</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setSpecPdf(e.target.files?.[0] ?? null)}
              className="input file:mr-3 file:rounded file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-neutral-200"
            />
            {specPdf && (
              <p className="mt-1 text-xs text-emerald-700">📄 {specPdf.name} ({Math.round(specPdf.size / 1024)} KB)</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between">
          <label className="label">📝 추가 지시사항 (선택)</label>
          {additionalInstructions && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-emerald-600">💾 자동 임시저장됨</span>
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: "추가 지시사항 지우기",
                    body: "작성한 추가 지시사항을 모두 지웁니다.",
                    okLabel: "지우기",
                    danger: true,
                  });
                  if (ok) {
                    setAdditionalInstructions("");
                    setDraftRestored(false);
                  }
                }}
                className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-200"
              >
                지우기
              </button>
            </div>
          )}
        </div>
        {draftRestored && (
          <div className="mb-1 rounded border-l-4 border-l-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700">
            🔁 이전에 작성하던 내용을 복원했습니다.
          </div>
        )}
        <textarea
          value={additionalInstructions}
          onChange={(e) => setAdditionalInstructions(e.target.value)}
          placeholder={`이번 작업에서 특별히 주의할 점, 알려진 함정, 우회 방법 등.\nClaude 에게 직접 전달됩니다 (인터랙티브 모드의 힌트와 동일한 효과).\n\n예) STG 환경에서 이미지 업로드는 timeout 60초 이상 필요.\n예) 파트너오피스 로그인 후 KC 카테고리 메뉴 진입 우선.\n예) TC 70~100 은 사전 데이터 셋업 필요 (test-data.json 참고).`}
          rows={6}
          className="input resize-y font-mono text-xs"
        />
        <div className="mt-1 text-xs text-neutral-500">
          여기 입력한 내용이 Claude 메시지의 최우선 지시사항으로 들어갑니다.
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-neutral-700">실행 워커</div>
            <div className="text-xs text-neutral-700">기본값은 로컬 내장 워커입니다. 특정 워커 지정은 필요할 때만 사용하세요.</div>
          </div>
          <a href="/workers" className="text-xs text-purple-700 hover:underline">워커 상태 →</a>
        </div>
        {workers.length === 0 ? (
          <div className="rounded border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600">
            등록된 워커 행이 없어도 내장 워커는 실행 가능합니다. 작업이 대기 상태로 남으면 <code>npm run worker</code> 또는 <code>npm run dev:all</code>을 확인하세요.
          </div>
        ) : (
          <select
            value={selectedWorker}
            onChange={(e) => setSelectedWorker(e.target.value)}
            className="input w-full text-sm"
          >
            <option value="">자동 (로컬 내장 워커)</option>
            {workers.map((w) => {
              const ok = w.status_label === "대기 중";
              // Mweb 도 결국 Playwright 라 web capability 사용. POC 모드는 잡마다 플랫폼이 달라
              // 여기서 막지 않고(서버가 POC별 분기), 미지원 POC 잡은 자동으로 미할당 처리됨.
              const platformOk = pocMode ? true : (platform === "app" ? w.capabilities?.app : w.capabilities?.web);
              const platformLabel = platform === "web" ? "Web" : platform === "mweb" ? "Mweb" : "App";
              // 다른 사람 워커 지정 실행 방지 — 본인 PC(is_self) 워커만 선택 가능.
              const selectable = w.version === "builtin" || (w.is_self && ok && platformOk);
              return (
                <option key={w.name} value={w.name} disabled={!selectable}>
                  {w.is_self ? "⭐ " : ""}{w.label || w.name} · {w.status_label}
                  {w.is_self ? " · 본인 PC" : " · 다른 PC (지정 불가)"}
                  {w.is_self && !pocMode && platformOk === false && ` (${platformLabel} 미지원)`}
                  {w.is_self && !ok && " (사용 불가)"}
                </option>
              );
            })}
          </select>
        )}
        <div className="mt-1.5 text-[11px] text-neutral-500">
          내장 워커만 쓰는 환경에서는 자동을 권장합니다. 자동으로 만들면 <code>worker_name</code> 없이 저장되어 내장 워커가 직접 가져갑니다.
        </div>
      </div>

      {multiAvailable && (
        <div className="rounded-md border border-kurly-300 bg-kurly-50/60 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={multiAgentEnabled}
              onChange={(e) => setMultiAgentEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium text-kurly-900">🎮 멀티 분할 수행 — {execAgents.length}개 에이전트 병렬</div>
              <div className="mt-0.5 text-xs text-kurly-700">
                TC를 {execAgents.length}청크로 연속 분할해 ({execAgents.map((a) => a.nickname).join(" · ")}) 각 에이전트가 병렬 수행 → 결과를 하나로 합칩니다.
                {execAgents.some((a) => a.instruction.trim()) && " 에이전트별 지시도 각 청크 프롬프트에 주입돼요."}
              </div>
              <div className="mt-0.5 text-[11px] text-kurly-600">
                에이전트·지시 변경은 <a href="/agents" className="underline">🎮 에이전트 오피스</a>에서.
              </div>
              {multiAgentEnabled && selectedWorkerSlots < execAgents.length && (
                <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  ⚠ 이 워커의 동시 슬롯이 {selectedWorkerSlots}개라 {execAgents.length}청크가 순차 실행됩니다. 진짜 병렬로 하려면 워커를 <code>WORKER_MAX_CONCURRENT={execAgents.length}</code> 로 재시작하세요.
                </div>
              )}
            </div>
          </label>
        </div>
      )}

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <label className={`flex items-start gap-2 text-sm ${selectedWorker && !selectedIsBuiltin ? "cursor-not-allowed opacity-40" : ""}`}>
          <input
            type="radio"
            checked={mode === "mock"}
            disabled={!!selectedWorker && !selectedIsBuiltin}
            onChange={() => setMode("mock")}
            className="mt-0.5"
          />
          <div>
            <div className="font-medium">시뮬레이션 모드 (MOCK)</div>
            <div className="text-xs text-neutral-600">
              {selectedWorker
                ? selectedIsBuiltin ? "내장 워커에서는 MOCK 가능" : "워커 직접 지정 시 사용 불가 — 자동(내장 워커)에서는 MOCK 가능"
                : "실제 Claude 호출 없이 진행률·결과 파일만 생성"}
            </div>
          </div>
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="radio" checked={mode === "real"} onChange={() => setMode("real")} className="mt-0.5" />
          <div>
            <div className="font-medium">실제 실행 모드 (REAL)</div>
            <div className="text-xs text-neutral-600">Claude Code + Playwright/Mobile MCP로 실제 TC 실행</div>
          </div>
        </label>

        {mode === "real" && (
          <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
            <label className="text-xs font-medium text-neutral-700">🤖 실행 모델</label>
            <select
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value as typeof claudeModel)}
              className="input mt-1 text-sm"
            >
              <option value="">자동 (워커 default — Sonnet 4.6, 빠름)</option>
              <option value="claude-sonnet-4-6">Sonnet 4.6 — 빠름 / 일반 잡 권장</option>
              <option value="claude-opus-4-8">Opus 4.8 — 느림 / 까다로운 케이스 (복합 결제·격려 모드 등)</option>
              <option value="codex">Codex — 로컬 Codex CLI로 실행</option>
            </select>
            <p className="mt-1 text-[11px] text-neutral-500">
              Codex 선택 시 워커 PC의 codex CLI 로그인/설정이 필요합니다. 미선택 시 워커 기본 Claude 모델을 사용합니다.
            </p>
          </div>
        )}
      </div>

      {estimatedSec !== null && estimatedSec > 0 && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
          ⏱ 예상 실행 시간: <strong>{formatEstimate(estimatedSec)}</strong>
          {mode === "real" && (estimateFromHistory
            ? ` (${domain} 실측 평균 ${realSecPerTc}초/건 기반)`
            : " (REAL 모드 / 케이스당 평균 45초 가정 — 실행 이력 쌓이면 자동 보정)")}
          {mode === "mock" && " (MOCK 모드 / 시뮬레이션)"}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-neutral-200 pt-5">
        <a href="/prompts" className="text-sm text-neutral-500 hover:text-kurly-500">↗ 프롬프트 미리보기</a>
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting || analyzing || files.length === 0 || (pocMode && selectedPocs.length === 0)}
        >
          {submitting
            ? "등록 중..."
            : pocMode
              ? (multiAvailable && multiAgentEnabled
                  ? `🎮 실행 시작 (POC ${selectedPocs.length}개 · 에이전트 ${execAgents.length} 병렬)`
                  : `실행 시작 (POC ${selectedPocs.length}개)`)
              : multiAvailable && multiAgentEnabled
                ? `🎮 멀티 분할 실행 (${execAgents.length}개)`
                : "실행 시작"}
        </button>
      </div>
    </form>
  );
}

// 예상 시간 전용 포맷 (올림 + "약" prefix). 실측 표시용 lib/format-date 의 formatDuration 과 구분.
function formatEstimate(sec: number): string {
  if (sec < 60) return `약 ${Math.ceil(sec)}초`;
  if (sec < 3600) return `약 ${Math.ceil(sec / 60)}분`;
  const h = Math.floor(sec / 3600);
  const m = Math.ceil((sec - h * 3600) / 60);
  return `약 ${h}시간 ${m}분`;
}
