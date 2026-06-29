"use client";

import { useEffect, useState } from "react";
import { CouponCreateForm } from "./form";
import { CouponPackForm } from "./pack-form";

const LAST_IDS_KEY = "kurly-qa:coupon:last-publish-ids";

export function CouponTabs() {
  const [tab, setTab] = useState<"coupon" | "pack">("coupon");
  // 발행 탭에서 성공한 coupon_publish_id 들 — 쿠폰팩 탭으로 전달
  const [lastIds, setLastIds] = useState<(number | string)[]>([]);
  const [seedNonce, setSeedNonce] = useState(0); // "묶기" 버튼 누를 때만 증가 → 강제 자동입력 트리거

  // 새로고침 후에도 직전 발행 ID 유지
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_IDS_KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) setLastIds(arr); }
    } catch {}
  }, []);

  function persist(ids: (number | string)[]) {
    setLastIds(ids);
    try { localStorage.setItem(LAST_IDS_KEY, JSON.stringify(ids)); } catch {}
  }
  // 발행 완료 시 자동 호출 — 쿠폰팩 탭 "불러오기" 버튼에 반영
  function handlePublished(ids: (number | string)[]) { if (ids.length) persist(ids); }
  // 발행 결과 "쿠폰팩으로 묶기 →" 버튼 — ID 채우고 탭 전환
  function sendToPack(ids: (number | string)[]) { persist(ids); setSeedNonce((n) => n + 1); setTab("pack"); }

  const btn = (active: boolean) =>
    `flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${active ? "bg-amber-500 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`;
  return (
    <div className="space-y-4">
      <div className="card flex gap-2 p-2">
        <button type="button" onClick={() => setTab("coupon")} className={btn(tab === "coupon")}>🎟️ 쿠폰 발행</button>
        <button type="button" onClick={() => setTab("pack")} className={btn(tab === "pack")}>
          🎁 쿠폰팩 생성{lastIds.length > 0 ? <span className="ml-1 rounded-full bg-black/10 px-1.5 text-[10px]">발행 {lastIds.length}</span> : null}
        </button>
      </div>
      {/* 둘 다 마운트 유지 (탭 전환 시 입력값 보존) — hidden 으로만 토글 */}
      <div className={tab === "coupon" ? "" : "hidden"}>
        <CouponCreateForm onPublished={handlePublished} onSendToPack={sendToPack} />
      </div>
      <div className={tab === "pack" ? "" : "hidden"}>
        <CouponPackForm seedIds={lastIds} seedNonce={seedNonce} />
      </div>
    </div>
  );
}
