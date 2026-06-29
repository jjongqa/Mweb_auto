"use client";

import { useState } from "react";
import OrderForm from "./form";
import KlsForm from "./kls-form";

type Tab = "1p" | "kls";

export default function OrderTabs() {
  const [tab, setTab] = useState<Tab>("1p");
  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5">
        {([["1p", "🛒 1P 컬리몰"], ["kls", "🏭 KLS (3PL)"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === t ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "1p" ? <OrderForm /> : <KlsForm />}
    </div>
  );
}
