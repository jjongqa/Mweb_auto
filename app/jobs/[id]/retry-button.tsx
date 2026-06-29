"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RetryFailButton({ jobId, failCount }: { jobId: string; failCount: number }) {
  return (
    <RetryButton
      jobId={jobId}
      count={failCount}
      resultType="FAIL"
      apiPath="retry"
      colorTheme="rose"
      title="FAIL 케이스 재실행"
      description="이 Job 에서 FAIL 처리된 케이스만 추출해서 새 Job 으로 재실행합니다. 환경 일시 이슈로 인한 FAIL 일 때 유용해요."
      buttonIcon="🔁"
    />
  );
}

export function RetryBlockedButton({ jobId, blockedCount }: { jobId: string; blockedCount: number }) {
  return (
    <RetryButton
      jobId={jobId}
      count={blockedCount}
      resultType="BLOCKED"
      apiPath="retry-blocked"
      colorTheme="amber"
      title="BLOCKED 케이스 재실행 (격려 메시지 포함)"
      description={`이 Job 에서 BLOCKED 처리된 케이스만 추출해서 재실행합니다. 새 Job 의 프롬프트에 "미리 한계 선언하지 말고 우회 방법을 모두 시도해보라" 는 격려 메시지가 자동으로 추가됩니다.`}
      buttonIcon="💪"
    />
  );
}

interface RetryButtonProps {
  jobId: string;
  count: number;
  resultType: "FAIL" | "BLOCKED";
  apiPath: "retry" | "retry-blocked";
  colorTheme: "rose" | "amber";
  title: string;
  description: string;
  buttonIcon: string;
}

function RetryButton(props: RetryButtonProps) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  // F3 오버라이드: 모델 / 우선순위 필터
  const [model, setModel] = useState<"" | "claude-sonnet-4-6" | "claude-opus-4-8" | "codex">("");
  const [priority, setPriority] = useState<"" | "P1" | "P1+P2">("");

  const colors = props.colorTheme === "rose"
    ? { card: "border-rose-200 bg-rose-50", title: "text-rose-900", body: "text-rose-700", btn: "bg-rose-600 hover:bg-rose-700", err: "text-rose-700", ring: "focus:ring-rose-500" }
    : { card: "border-amber-200 bg-amber-50", title: "text-amber-900", body: "text-amber-700", btn: "bg-amber-600 hover:bg-amber-700", err: "text-amber-700", ring: "focus:ring-amber-500" };

  function onConfirm() {
    setShowModal(false);
    const payload: Record<string, string> = {};
    if (additionalInstructions.trim()) payload.additional_instructions = additionalInstructions.trim();
    if (model) payload.claude_model = model;
    if (priority) payload.priority = priority;

    startBusy(async () => {
      setError("");
      const res = await fetch(`/api/jobs/${props.jobId}/${props.apiPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "재실행 실패");
        return;
      }
      router.push(`/jobs/${json.newJobId}`);
    });
  }

  return (
    <>
      <div className={`card ${colors.card} p-4`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className={`text-sm font-semibold ${colors.title}`}>{props.title}</div>
            <div className={`mt-0.5 text-xs ${colors.body}`}>{props.description}</div>
            {error && <div className={`mt-2 text-xs ${colors.err}`}>⚠ {error}</div>}
          </div>
          <button
            onClick={() => { setError(""); setAdditionalInstructions(""); setModel(""); setPriority(""); setShowModal(true); }}
            disabled={busy}
            className={`whitespace-nowrap rounded-md ${colors.btn} px-4 py-2 text-sm font-medium text-white disabled:opacity-50`}
          >
            {busy ? "준비 중..." : `${props.buttonIcon} ${props.resultType} ${props.count}건 재실행`}
          </button>
        </div>
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-base font-semibold text-neutral-900">
              {props.buttonIcon} {props.resultType} {props.count}건 재실행
            </div>
            <div className="mb-4 text-xs text-neutral-600">
              {props.resultType === "BLOCKED"
                ? `${props.count}건을 격려 메시지와 함께 재실행합니다. 새 Job 의 프롬프트에 "포기하지 말고 우회 방법 모두 시도하라" 는 지시가 자동 추가됩니다.`
                : `${props.count}건을 추출해서 새 Job 으로 재실행합니다.`}
            </div>

            <label className="block">
              <div className="mb-1 text-sm font-medium text-neutral-800">
                📝 추가 지시사항 (선택, 이번 재실행 한정)
              </div>
              <textarea
                value={additionalInstructions}
                onChange={(e) => setAdditionalInstructions(e.target.value)}
                placeholder={
                  props.resultType === "BLOCKED"
                    ? `지난번에 막혔던 부분에 대한 힌트, 새로 알게 된 우회 방법 등.\n\n예) TC 70~100 은 이미지 업로드 후 "완료" 버튼 대기 시간 늘려야 함.\n예) 모달 안 닫히면 ESC 누르고 다시 진행.\n예) "상품 등록" 메뉴 진입 전 파트너 권한 확인 필요.`
                    : `이번 FAIL 재실행에서 특별히 주의할 점.\n\n예) 환경 일시 이슈였을 가능성 — 같은 방법으로 재시도.\n예) 데이터 변경됐을 수 있음 — 새로 조회 후 검증.`
                }
                rows={6}
                className={`w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 ${colors.ring}`}
              />
              <div className="mt-1 text-xs text-neutral-500">
                여기 입력한 내용이 Claude 메시지의 최우선 지시사항으로 들어갑니다.
              </div>
            </label>

            {/* F3 고급 옵션 — 부모 설정 대신 이번 재실행만 다르게 */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <div className="mb-1 text-xs font-medium text-neutral-700">모델</div>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as typeof model)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
                >
                  <option value="">부모와 동일</option>
                  <option value="claude-sonnet-4-6">Sonnet (빠름/저렴)</option>
                  <option value="claude-opus-4-8">Opus (어려운 케이스)</option>
                  <option value="codex">Codex (로컬 Codex CLI)</option>
                </select>
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-medium text-neutral-700">우선순위 필터</div>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
                >
                  <option value="">전체 ({props.count}건)</option>
                  <option value="P1">P1만</option>
                  <option value="P1+P2">P1 + P2</option>
                </select>
              </label>
            </div>
            <div className="mt-1 text-[11px] text-neutral-400">
              예: flaky 한 건 Opus 로, 또는 P1 실패만 먼저 재시도.
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                취소
              </button>
              <button
                onClick={onConfirm}
                className={`rounded-md ${colors.btn} px-4 py-2 text-sm font-medium text-white`}
              >
                {props.buttonIcon} 재실행 시작
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
