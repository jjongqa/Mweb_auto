"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DOMAINS } from "@/lib/domains";

type BU = "커머스" | "물류";

// 폼의 도메인 토글과 같은 페이지의 이력 리스트가 BU 선택을 공유하기 위한 컨텍스트.
// Provider 가 없으면 BuDomainSelect 는 내부 state 로 단독 동작한다(upload/adhoc).
const BuContext = createContext<{ bu: BU; setBu: (b: BU) => void } | null>(null);

export function BuProvider({ children, initial = "커머스" }: { children: ReactNode; initial?: BU }) {
  const [bu, setBu] = useState<BU>(initial);
  return <BuContext.Provider value={{ bu, setBu }}>{children}</BuContext.Provider>;
}

// 현재 BU 만 읽는 소비자용 훅(이력 리스트 등). Provider 없으면 "커머스".
export function useBu(): BU {
  return useContext(BuContext)?.bu ?? "커머스";
}

// 도메인 셀렉트 없이 토글만 필요한 페이지용(test-data/history/suites). BuProvider 안에서 사용.
export function BuTabs() {
  const ctx = useContext(BuContext);
  if (!ctx) return null;
  const { bu, setBu } = ctx;
  return (
    <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5">
      {(["커머스", "물류"] as const).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => setBu(b)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            bu === b ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          {b === "커머스" ? "🛒 커머스" : "🚚 물류"}
        </button>
      ))}
    </div>
  );
}

// 현재 BU 가 show 와 같을 때만 children 렌더(블록 show/hide 용).
export function BuGate({ show, children }: { show: BU; children: ReactNode }) {
  return useBu() === show ? <>{children}</> : null;
}

// BU(커머스/물류) 토글 + 해당 BU 도메인만 노출하는 셀렉트.
// 토글을 바꾸면 도메인 선택은 초기화되고, 외부에서 value 를 다른 BU 도메인으로
// 프로그램 설정하면(예: TC생성 핸드오프·분석 추천) 토글이 자동으로 그 BU 로 따라간다.
export function BuDomainSelect({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const ctx = useContext(BuContext);
  const initialBu = DOMAINS.find((d) => d.id === value)?.bu ?? "커머스";
  const [localBu, setLocalBu] = useState<BU>(initialBu);
  const bu = ctx ? ctx.bu : localBu;
  const setBu = ctx ? ctx.setBu : setLocalBu;

  // value 가 현재 토글과 다른 BU 도메인으로 바뀌면 토글을 맞춰준다(옵션이 안 보이는 문제 방지).
  useEffect(() => {
    const vbu = DOMAINS.find((d) => d.id === value)?.bu;
    if (vbu && vbu !== bu) setBu(vbu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <>
      <div className="mb-2 inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5">
        {(["커머스", "물류"] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => { setBu(b); onChange(""); }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              bu === b ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {b === "커머스" ? "🛒 커머스" : "🚚 물류"}
          </button>
        ))}
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input" required={required}>
        <option value="">선택...</option>
        {DOMAINS.filter((d) => d.bu === bu).map((d) => (
          <option key={d.id} value={d.id}>{d.label}</option>
        ))}
      </select>
    </>
  );
}
