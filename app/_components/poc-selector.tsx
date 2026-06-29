"use client";

import { POCS, type Bu } from "@/lib/pocs";

// POC(시트분류) 다중선택 칩. value=선택된 POC id 배열.
// available 지정 시 그 목록만 노출(업로드 CSV에 존재하는 POC만 — BU 무관, CSV가 기준).
// available 없으면 bu(커머스/물류)로 노출 분기(기본 커머스).
export function PocSelector({
  value,
  onChange,
  available,
  disabled,
  bu,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  available?: string[];
  disabled?: boolean;
  bu?: Bu;
}) {
  const list = POCS.filter((p) => (available ? available.includes(p.id) : p.bu === (bu ?? "커머스")));
  if (list.length === 0) return null;

  const toggle = (id: string) => {
    if (disabled) return;
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const allOn = list.every((p) => value.includes(p.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {list.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              disabled={disabled}
              className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                on
                  ? "border-kurly-500 bg-kurly-50 font-medium text-kurly-700"
                  : "border-neutral-300 bg-white text-neutral-500 hover:border-neutral-400"
              }`}
            >
              {on ? "✓ " : ""}
              {p.label}
              <span className="ml-1 text-[10px] text-neutral-400">{p.platform === "app" ? "앱" : "웹"}</span>
            </button>
          );
        })}
      </div>
      {!disabled && list.length > 1 && (
        <button
          type="button"
          onClick={() => onChange(allOn ? [] : list.map((p) => p.id))}
          className="text-[11px] text-neutral-400 hover:text-neutral-600 hover:underline"
        >
          {allOn ? "전체 해제" : "전체 선택"}
        </button>
      )}
    </div>
  );
}
