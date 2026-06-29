"use client";

import { useState } from "react";

interface Item {
  no: string;
  priority: string;
  title: string;
  testStep: string;
  expected: string;
  actual: string;
  failReason: string;
  notes: string;
  screenshot: string;
}

export function FailBlockedListCard({ jobId, failItems, blockedItems }: { jobId: string; failItems: Item[]; blockedItems: Item[] }) {
  const [tab, setTab] = useState<"fail" | "blocked">(failItems.length > 0 ? "fail" : "blocked");
  const items = tab === "fail" ? failItems : blockedItems;

  if (failItems.length === 0 && blockedItems.length === 0) return null;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-neutral-700">⚠️ 실패 / 블록 케이스 목록</h2>
      </div>

      <div className="mb-3 flex gap-1 border-b border-neutral-200">
        <button
          type="button"
          onClick={() => setTab("fail")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${tab === "fail" ? "border-rose-500 text-rose-700" : "border-transparent text-neutral-500 hover:text-neutral-700"}`}
          disabled={failItems.length === 0}
        >
          FAIL ({failItems.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("blocked")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition ${tab === "blocked" ? "border-amber-500 text-amber-700" : "border-transparent text-neutral-500 hover:text-neutral-700"}`}
          disabled={blockedItems.length === 0}
        >
          BLOCKED ({blockedItems.length})
        </button>
      </div>

      {items.length === 0 ? (
        <p className="py-4 text-sm text-neutral-400">{tab === "fail" ? "FAIL" : "BLOCKED"} 케이스 없음</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-left text-[10px] uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-2 w-12">No</th>
                <th className="px-2 py-2 w-14">우선순위</th>
                <th className="px-2 py-2">제목</th>
                <th className="px-2 py-2">{tab === "fail" ? "실패 사유" : "블록 사유"}</th>
                <th className="px-2 py-2">기대 결과</th>
                <th className="px-2 py-2">실제 결과</th>
                <th className="px-2 py-2 w-16">스크린샷</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((it, i) => (
                <tr key={`${it.no}-${i}`} className={tab === "fail" ? "hover:bg-rose-50/30" : "hover:bg-amber-50/30"}>
                  <td className="px-2 py-2 font-mono text-neutral-700">{it.no}</td>
                  <td className="px-2 py-2">
                    {it.priority && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        it.priority === "P1" ? "bg-rose-100 text-rose-700" :
                        it.priority === "P2" ? "bg-amber-100 text-amber-700" :
                        "bg-neutral-100 text-neutral-700"
                      }`}>{it.priority}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-neutral-700 align-top">
                    <div className="whitespace-pre-wrap break-words">{it.title}</div>
                  </td>
                  <td className={`px-2 py-2 align-top text-[11px] ${tab === "fail" ? "text-rose-700" : "text-amber-700"}`}>
                    <div className="whitespace-pre-wrap break-words">{it.failReason || it.notes || "-"}</div>
                  </td>
                  <td className="px-2 py-2 align-top text-[11px] text-neutral-600">
                    <div className="whitespace-pre-wrap break-words">{it.expected || "-"}</div>
                  </td>
                  <td className="px-2 py-2 align-top text-[11px] text-neutral-600">
                    <div className="whitespace-pre-wrap break-words">{it.actual || "-"}</div>
                  </td>
                  <td className="px-2 py-2">
                    {it.screenshot ? (
                      <a
                        href={`/api/jobs/${jobId}/file?name=${encodeURIComponent(it.screenshot)}&inline=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-kurly-500 underline text-[11px]"
                      >
                        보기
                      </a>
                    ) : (
                      <span className="text-neutral-400 text-[11px]">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
