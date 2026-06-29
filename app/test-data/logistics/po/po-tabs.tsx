"use client";

import { useState } from "react";
import PoForm from "./form";       // 발주 V1 (기존)
import PoV2Form from "./v2-form";  // 발주 V2 (신규)
import CapaForm from "./capa-form"; // CAPA 관리 (신규)

const ENVS = ["STG", "DEV01", "DEV02", "DEV03", "DEV04", "DEV05"];
type Tab = "capa" | "v2" | "v1";

export default function PoTabs() {
  const [env, setEnv] = useState("STG");
  const [tab, setTab] = useState<Tab>("v2");
  return (
    <div className="space-y-4">
      {/* 환경 선택 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-neutral-500">환경</span>
        {ENVS.map((e) => (
          <button key={e} type="button" onClick={() => setEnv(e)}
            className={`rounded-full border px-3 py-1 font-mono text-xs transition ${env === e ? "border-kurly-500 bg-kurly-50 text-kurly-700" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300"}`}>{e}</button>
        ))}
      </div>

      {/* 탭 */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-200">
        {([["capa", "📦 CAPA 관리"], ["v2", "🏭 발주 V2"], ["v1", "📋 발주 V1"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition ${tab === t ? "border-b-2 border-kurly-500 text-kurly-700" : "text-neutral-500 hover:text-neutral-700"}`}>{label}</button>
        ))}
      </div>

      {tab === "capa" && <CapaForm envName={env} />}
      {tab === "v2" && <PoV2Form envName={env} />}
      {tab === "v1" && <PoForm envName={env} />}
    </div>
  );
}
