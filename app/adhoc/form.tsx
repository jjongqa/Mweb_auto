"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BuDomainSelect } from "@/app/_components/bu-domain-select";
import { WorkerStatusBanner } from "@/app/_components/worker-status-banner";
import { ConfluenceTokenBanner } from "@/app/_components/confluence-token-banner";
import { confirmDialog } from "@/app/_components/confirm-dialog";
import { SpecUrlValidator } from "@/app/_components/spec-url-validator";

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

export function AdhocForm() {
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState("");

  const [domain, setDomain] = useState("");
  const [platform, setPlatform] = useState<"web" | "mweb" | "app">("web");
  const [qaEnv, setQaEnv] = useState("");
  const [taskName, setTaskName] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [specUrl, setSpecUrl] = useState("");
  const [specPdf, setSpecPdf] = useState<File | null>(null);
  const [adhocFocus, setAdhocFocus] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);

  const DRAFT_KEY = "kurly-qa:draft:adhoc:additional_instructions";
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        setAdditionalInstructions(saved);
        setDraftRestored(true);
      }
      // 실행자 자동 채움 — jira-settings 등록 이름 재사용 (토큰 라우팅 일치 + 타이핑 0)
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
  const [mode, setMode] = useState<"mock" | "real">("mock");
  const [claudeModel, setClaudeModel] = useState<"" | "claude-sonnet-4-6" | "claude-opus-4-8" | "codex">("");

  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string>("");
  const [builtinWorker, setBuiltinWorker] = useState<string>("");

  useEffect(() => {
    let cancel = false;
    const load = async () => {
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
    };
    load();
    const t = setInterval(load, 10000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  // 특정 워커 직접 지정 시 MOCK 자동 비활성 → REAL 강제. 자동은 내장 워커(worker_name 미지정).
  useEffect(() => {
    const selected = workers.find((w) => w.name === selectedWorker);
    const isBuiltin = !!selectedWorker && (selectedWorker === builtinWorker || selected?.version === "builtin");
    if (selectedWorker && !isBuiltin && mode === "mock") setMode("real");
  }, [selectedWorker, mode, workers, builtinWorker]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!domain) { setError("도메인을 선택해 주세요"); return; }
    if (!requestedBy.trim()) {
      setError("실행자를 입력해 주세요 (jira-settings 에 등록한 본인 이름과 일치해야 본인 토큰 사용)");
      return;
    }
    if (!specUrl && !specPdf && !adhocFocus.trim()) {
      setError("기획서(URL 또는 PDF) 또는 포커스 텍스트 중 최소 하나는 입력해 주세요");
      return;
    }

    startSubmit(async () => {
      const fd = new FormData();
      fd.append("domain", domain);
      fd.append("platform", platform);
      fd.append("qa_env", qaEnv);
      if (taskName) fd.append("task_name", taskName);
      if (requestedBy) fd.append("requested_by", requestedBy);
      if (specUrl) fd.append("spec_url", specUrl);
      if (specPdf) fd.append("spec_pdf", specPdf);
      if (adhocFocus) fd.append("adhoc_focus", adhocFocus);
      if (additionalInstructions) fd.append("additional_instructions", additionalInstructions);
      fd.append("mode", mode);
      if (selectedWorker) fd.append("worker_name", selectedWorker);
      if (claudeModel) fd.append("claude_model", claudeModel);

      const res = await fetch("/api/adhoc/jobs", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "테스트 생성 실패");
        return;
      }
      try {
        localStorage.removeItem(DRAFT_KEY);
        if (requestedBy.trim()) localStorage.setItem(MY_NAME_KEY, requestedBy.trim());
      } catch {}
      router.push(`/jobs/${json.id}`);
    });
  }

  const selectedWorkerMeta = workers.find((w) => w.name === selectedWorker);
  const selectedIsBuiltin = !!selectedWorker && (selectedWorker === builtinWorker || selectedWorkerMeta?.version === "builtin");

  return (
    <form onSubmit={submit} className="space-y-5">
      <WorkerStatusBanner />

      {error && (
        <div className="rounded border-l-4 border-rose-400 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* 도메인 / 플랫폼 / 환경 */}
      <Field label="도메인 *">
        <BuDomainSelect value={domain} onChange={setDomain} required />
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="플랫폼 *">
          <select value={platform} onChange={(e) => setPlatform(e.target.value as "web" | "mweb" | "app")} className="input">
            <option value="web">Web (데스크톱)</option>
            <option value="mweb">Mweb (모바일 웹)</option>
            <option value="app">App (네이티브)</option>
          </select>
        </Field>
        <Field label="테스트 환경 URL *">
          <input
            type="url"
            value={qaEnv}
            onChange={(e) => setQaEnv(e.target.value.trim())}
            required
            className="input font-mono"
            placeholder="https://stg.kurly.com"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="과제명 (선택)" hint="결과 폴더명에 사용됨">
          <input
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="예: 신규 회원가입 흐름 탐색"
            className="input"
          />
        </Field>
        <Field label="실행자 *">
          <input
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="예: 종관 (jira-settings 등록 이름과 동일하게)"
            className="input"
            required
          />
        </Field>
      </div>

      {/* 기획 문서 */}
      <Field
        label="📎 기획 문서"
        hint="URL 입력(여러 개는 한 줄당 1개) 또는 PDF 첨부. 둘 다 비워도 되지만, 그러면 아래 포커스 텍스트만으로 진행됨."
      >
        <div className="mb-2">
          <ConfluenceTokenBanner />
        </div>
        <textarea
          value={specUrl}
          onChange={(e) => setSpecUrl(e.target.value)}
          placeholder={"예:\nhttps://kurly0521.atlassian.net/wiki/spaces/CMS/pages/.../\nhttps://figma.com/..."}
          rows={3}
          className="input font-mono text-xs"
        />
        <SpecUrlValidator specUrl={specUrl} requestedBy={requestedBy} />
        <div className="mt-2 flex items-center gap-2">
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setSpecPdf(e.target.files?.[0] ?? null)}
            className="text-xs"
          />
          {specPdf && (
            <span className="text-xs text-neutral-500">
              {specPdf.name} ({(specPdf.size / 1024).toFixed(1)} KB)
            </span>
          )}
        </div>
      </Field>

      {/* 포커스 영역 */}
      <Field
        label="🎯 포커스 영역 (집중 검증 원하는 부분)"
        hint="구체적일수록 결과 품질이 좋아져요. 비워두면 AI 가 기획서 전체를 자유 탐색."
      >
        <textarea
          value={adhocFocus}
          onChange={(e) => setAdhocFocus(e.target.value)}
          rows={4}
          placeholder={"예: 회원가입 시 만 14세 이하 차단, 통신사 인증 실패 케이스 처리, 동일 이메일 중복 가입 방지\n— 위 3가지 위주로 집중 검증해줘"}
          className="input font-sans"
        />
      </Field>

      {/* 추가 지시 */}
      <Field
        label={
          <span className="flex items-center justify-between">
            <span>📝 추가 지시사항 (선택)</span>
            {additionalInstructions && (
              <span className="flex items-center gap-2 text-[11px] font-normal">
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
              </span>
            )}
          </span>
        }
        hint="AI 에게 전달할 일반 지침"
      >
        {draftRestored && (
          <div className="mb-1 rounded border-l-4 border-l-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700">
            🔁 이전에 작성하던 내용을 복원했습니다.
          </div>
        )}
        <textarea
          value={additionalInstructions}
          onChange={(e) => setAdditionalInstructions(e.target.value)}
          rows={2}
          placeholder="예: 모바일 환경 우선 확인, 다국어 케이스는 영문만 검증"
          className="input font-sans"
        />
      </Field>

      {/* 실행 모드 / 워커 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="실행 모드">
          <div className="flex gap-3">
            <label className={`flex items-center gap-2 text-sm ${selectedWorker && !selectedIsBuiltin ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>
              <input
                type="radio"
                checked={mode === "mock"}
                disabled={!!selectedWorker && !selectedIsBuiltin}
                onChange={() => setMode("mock")}
              />
              <span>
                <strong>MOCK</strong>
                <span className="ml-1 text-xs text-neutral-500">
                  {selectedWorker && !selectedIsBuiltin ? "(워커 직접 지정 시 사용 불가)" : "(AI 안 부르고 시뮬)"}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === "real"}
                onChange={() => setMode("real")}
              />
              <span>
                <strong>REAL</strong>
                <span className="ml-1 text-xs text-neutral-500">(실제 claude 호출)</span>
              </span>
            </label>
          </div>
        </Field>
        {mode === "real" && (
          <Field label="🤖 실행 모델" hint="Codex 선택 시 워커 PC의 codex CLI 로그인/설정이 필요합니다">
            <select
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value as typeof claudeModel)}
              className="input"
            >
              <option value="">자동 (Sonnet 4.6 — 빠름)</option>
              <option value="claude-sonnet-4-6">Sonnet 4.6 — 빠름</option>
              <option value="claude-opus-4-8">Opus 4.8 — 느림 / 정확</option>
              <option value="codex">Codex — 로컬 Codex CLI로 실행</option>
            </select>
          </Field>
        )}
        <Field label="실행 워커 (선택)" hint="비워두면 로컬 내장 워커가 가져갑니다">
          <select value={selectedWorker} onChange={(e) => setSelectedWorker(e.target.value)} className="input">
            <option value="">미지정</option>
            {workers.map((w) => (
              <option key={w.name} value={w.name}>
                {w.is_self ? "⭐ " : ""}{w.label || w.name} — {w.status_label}
                {w.capabilities?.app ? " · App" : " · Web"}
                {w.is_self ? " · 본인 PC" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-kurly-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-kurly-600 disabled:opacity-50"
        >
          {submitting ? "생성 중..." : "🚀 애드혹 테스트 시작"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">{label}</label>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
