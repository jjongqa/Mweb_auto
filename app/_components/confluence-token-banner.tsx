"use client";

import { useEffect, useState } from "react";

type State = "loading" | "missing" | "active";

const MY_NAME_KEY = "kurly-qa:jira-settings:my-name";

/**
 * Confluence 토큰 등록 상태를 보여주는 배너.
 * - 미등록 → 빨간 강조 박스 + 발급/등록 버튼
 * - 등록 됨 → 등록 워커 수 표시 + 내 토큰 마킹 여부 안내 (이름은 비노출)
 *
 * 기획 문서 입력란 바로 위에 둬서, 워커가 URL 만 넣고 토큰 없이 잡 만드는 실수 방지.
 */
export function ConfluenceTokenBanner() {
  const [state, setState] = useState<State>("loading");
  const [count, setCount] = useState(0);
  const [myMarked, setMyMarked] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/jira/settings")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const all = Array.isArray(j?.all) ? j.all : [];
        setCount(all.length);
        setState(all.length > 0 ? "active" : "missing");
        try {
          const my = localStorage.getItem(MY_NAME_KEY);
          setMyMarked(my != null && all.some((s: { name: string }) => s.name === my));
        } catch { setMyMarked(null); }
      })
      .catch(() => alive && setState("missing"));
    return () => { alive = false; };
  }, []);

  if (state === "loading") return null;

  if (state === "missing") {
    return (
      <div className="rounded-lg border-2 border-red-400 bg-red-50 p-3 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="flex-1">
            <div className="text-sm font-bold text-red-900">
              Confluence 토큰 미등록 — 기획서 본문 자동 추출 불가
            </div>
            <p className="mt-1.5 text-xs text-red-800 leading-relaxed">
              Confluence URL(<code className="rounded bg-white/70 px-1">*.atlassian.net/wiki/...</code>)만 넣고 잡을 만들면
              <strong> 어드민이 본문을 못 가져옴</strong> → Claude 는 기획서를 못 보고 추측만으로 테스트 진행.
              <br />
              <strong>한 번만 등록</strong>하면 그 뒤 모든 워커가 자동으로 본문 추출.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener"
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-700"
              >
                ① Atlassian 토큰 발급 (1분) →
              </a>
              <a
                href="/jira-settings"
                target="_blank"
                className="rounded border border-red-400 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                ② 어드민에 등록 →
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (myMarked === false) {
    // 다른 워커는 등록돼 있지만 본인 토큰이 마킹 안 됨 → 노란 안내
    return (
      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>⚠️ 본인 토큰 미마킹</strong> · 등록된 워커 토큰 {count}개. 잡의 <code className="rounded bg-white/70 px-1">실행자</code> 가 등록 이름과 매칭 안 되면 default 토큰(다른 사람)으로 fetch / 이슈 등록 → reporter 가 본인 아닌 다른 사람으로 박힘.
        <br />
        <a href="/jira-settings" target="_blank" className="font-semibold underline">/jira-settings 에서 본인 행에 [내 토큰] 클릭하거나 새로 등록 →</a>
      </div>
    );
  }

  return (
    <div className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800">
      ✅ Confluence 본문 자동 추출 활성 · 등록 워커 {count}명
      {myMarked === true && <span className="ml-2 rounded bg-emerald-200 px-1.5 py-0.5 text-[10px]">내 토큰 OK</span>}
    </div>
  );
}
