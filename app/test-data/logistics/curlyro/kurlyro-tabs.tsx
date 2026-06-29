"use client";

import { useState } from "react";
import KurlyroForm from "./form";
import ActionPanel, { type Category } from "./action-panel";

type Top = "run" | "basic" | "arbeit" | "manage" | "smedical";
const TABS: [Top, string][] = [
  ["run", "🚀 연속 실행"], ["basic", "📋 기본 API"], ["arbeit", "🔧 아르바이트"], ["manage", "⚙️ 관리"], ["smedical", "🏥 특수건강검진"],
];

export default function KurlyroTabs() {
  const [tab, setTab] = useState<Top>("run");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 border-b border-neutral-200">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium transition ${tab === t ? "border-b-2 border-kurly-500 text-kurly-700" : "text-neutral-500 hover:text-neutral-700"}`}>{label}</button>
        ))}
      </div>
      {tab === "run" && <KurlyroForm />}
      {tab !== "run" && <ActionPanel category={tab as Category} />}
    </div>
  );
}
