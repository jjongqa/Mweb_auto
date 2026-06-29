"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DOMAINS, getDomainById } from "@/lib/domains";
import { ConfluenceTokenBanner } from "@/app/_components/confluence-token-banner";
import { SpecUrlValidator } from "@/app/_components/spec-url-validator";
import { PocSelector } from "@/app/_components/poc-selector";
import { getPocById } from "@/lib/pocs";
import { WorkerPicker } from "@/app/_components/worker-picker";
import { BuDomainSelect } from "@/app/_components/bu-domain-select";
import { AgentMultiToggle } from "@/app/_components/agent-multi-toggle";

const MY_NAME_KEY = "kurly-qa:jira-settings:my-name";

export function TcGenForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [taskName, setTaskName] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [pocs, setPocs] = useState<string[]>([]);
  const [specUrl, setSpecUrl] = useState("");
  const [specPdf, setSpecPdf] = useState<File | null>(null);
  const [focus, setFocus] = useState("");
  // TC 생성은 깊은 분해가 중요 → Opus 4.8 기본
  const [model, setModel] = useState<"claude-sonnet-4-6" | "claude-opus-4-8" | "codex">("claude-opus-4-8");
  // 집 환경: 하네스 미사용 → 기존 도메인 스킬로 고정 (생성 엔진 선택 UI 제거).
  const [engine] = useState<"harness" | "legacy">("legacy");
  const [worker, setWorker] = useState("");
  const [multiAgent, setMultiAgent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try { const n = localStorage.getItem(MY_NAME_KEY); if (n) setRequestedBy(n); } catch {}
  }, []);

  // 도메인(=BU)이 바뀌면 현재 BU에 안 맞는 POC 선택은 정리(커머스↔물류 전환 시 잔류 방지).
  useEffect(() => {
    const dbu = getDomainById(domain)?.bu;
    if (!dbu) return;
    setPocs((prev) => prev.filter((id) => getPocById(id)?.bu === dbu));
  }, [domain]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!domain) { setError("도메인을 선택해 주세요"); return; }
    if (pocs.length === 0) { setError("대상 POC(시트분류)를 1개 이상 선택해 주세요"); return; }
    if (!specUrl.trim() && !specPdf && !focus.trim()) {
      setError("기획서(URL/PDF) 또는 포커스 중 최소 하나는 입력해 주세요"); return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("domain", domain);
      fd.append("pocs", JSON.stringify(pocs));
      if (taskName) fd.append("task_name", taskName);
      if (requestedBy) fd.append("requested_by", requestedBy);
      if (specUrl.trim()) fd.append("spec_url", specUrl.trim());
      if (specPdf) fd.append("spec_pdf", specPdf);
      if (focus.trim()) fd.append("focus", focus.trim());
      if (model) fd.append("claude_model", model);
      fd.append("engine", engine);
      if (worker) fd.append("worker_name", worker);
      if (multiAgent) fd.append("multi_agent", "1");
      const res = await fetch("/api/tc-gen", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error || "생성 시작 실패"); return; }
      try { if (requestedBy.trim()) localStorage.setItem(MY_NAME_KEY, requestedBy.trim()); } catch {}
      router.push(`/tc-gen/${json.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  const tcFolder = DOMAINS.find((d) => d.id === domain)?.tcFolder;

  return (
    <form onSubmit={submit} className="card space-y-5 p-6">
      {error && <div className="rounded border-l-4 border-rose-400 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <div>
        <label className="label">도메인 *</label>
        <BuDomainSelect value={domain} onChange={setDomain} required />
        {tcFolder && <p className="mt-0.5 text-[11px] text-neutral-400">정책·스킬 폴더: {tcFolder}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="label">실행자 *</label>
          <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="예: 종관" className="input" required />
        </div>
        <div>
          <label className="label">과제명 (선택)</label>
          <input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="예: 멤버스 무배 리전 개편" className="input" />
          <p className="mt-0.5 text-[11px] text-neutral-400">생성 CSV 파일명에 사용됨</p>
        </div>
      </div>

      <div className="rounded-md border border-kurly-200 bg-kurly-50/40 p-3">
        <label className="label">대상 POC (시트분류) *</label>
        <p className="mb-2 text-[11px] text-neutral-500">선택한 시스템/화면의 TC만 생성하고, 각 TC에 시트분류를 태깅합니다. (구글시트 탭과 동일)</p>
        <PocSelector value={pocs} onChange={setPocs} bu={getDomainById(domain)?.bu} />
      </div>

      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-2 text-sm font-medium text-neutral-700">📎 기획 문서</div>
        <div className="mb-2"><ConfluenceTokenBanner /></div>
        <label className="text-xs text-neutral-700">기획 문서 URL (여러 개 — 한 줄당 1개)</label>
        <textarea
          value={specUrl}
          onChange={(e) => setSpecUrl(e.target.value)}
          placeholder={"예:\nhttps://kurly0521.atlassian.net/wiki/spaces/CMS/pages/.../"}
          rows={3}
          className="input font-mono text-xs"
        />
        <SpecUrlValidator specUrl={specUrl} requestedBy={requestedBy} />
        <div className="mt-2">
          <label className="text-xs text-neutral-700">기획 PDF 첨부</label>
          <input type="file" accept="application/pdf" onChange={(e) => setSpecPdf(e.target.files?.[0] ?? null)} className="input file:mr-3 file:rounded file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm" />
          {specPdf && <p className="mt-1 text-xs text-emerald-700">📄 {specPdf.name} ({Math.round(specPdf.size / 1024)} KB)</p>}
        </div>
      </div>

      <div>
        <label className="label">🎯 포커스 (선택)</label>
        <textarea
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          rows={3}
          placeholder={"집중 검증 원하는 부분. 예: 무배 리전 경계값, 멤버스/비멤버스 혜택가 분기 위주로"}
          className="input"
        />
      </div>

      <div>
        <label className="label">🤖 실행 모델</label>
        <select value={model} onChange={(e) => setModel(e.target.value as typeof model)} className="input">
          <option value="claude-opus-4-8">Opus 4.8 — 깊은 분해 (TC 생성 기본 권장)</option>
          <option value="claude-sonnet-4-6">Sonnet 4.6 — 빠름 / 저렴</option>
          <option value="codex">Codex — 로컬 Codex CLI로 실행</option>
        </select>
      </div>

      <WorkerPicker value={worker} onChange={setWorker} />

      <AgentMultiToggle worker={worker} group="write" enabled={multiAgent} setEnabled={setMultiAgent} />

      <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
        💡 QA 관점 리스크 분석을 먼저 거치고 싶으면 <a href="/qa-design" className="font-medium underline">QA 설계</a>에서 시작 → 분석을 다듬은 뒤 "TC생성으로 보내기"하면 그 분석이 TC에 반영돼요. 여기서 바로 생성하면 분석 없이 TC만 만듭니다.
      </p>

      <div className="flex justify-end">
        <button type="submit" disabled={submitting} className="rounded-md bg-kurly-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-kurly-600 disabled:opacity-50">
          {submitting ? "시작 중..." : "🧬 TC 생성 시작"}
        </button>
      </div>
    </form>
  );
}
