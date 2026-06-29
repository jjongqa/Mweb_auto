"use client";

// Drive 자산(기능테스트 프롬프트 + TC 스킬 + 마스터정책)을 읽기 전용으로 표시.
// 그룹별 접기/펼침 + 전체 검색. 편집은 파일명 클릭 → Drive 열기.

import { useEffect, useState } from "react";

interface Entry { name: string; rel: string; isDir: boolean; size: number; modifiedTime?: string; webViewLink?: string; }
interface Group { key: string; label: string; icon: string; folderUrl: string; fileCount: number; entries: Entry[]; }
interface Assets { ok: boolean; groups: Group[]; claudeMd: Entry | null; error?: string; }

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
function ago(iso?: string) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function DrivePromptBrowser() {
  const [data, setData] = useState<Assets | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch("/api/drive-prompts");
        const j = await r.json();
        if (!cancel) setData(j);
      } catch (e) {
        if (!cancel) setData({ ok: false, groups: [], claudeMd: null, error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  if (loading) {
    return <div className="card p-6 text-center text-sm text-neutral-500">☁️ Drive에서 목록 불러오는 중… (프롬프트 + TC 스킬 + 마스터정책)</div>;
  }
  if (!data || !data.ok) {
    return (
      <div className="card border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
        Drive 목록을 불러오지 못했습니다: {data?.error ?? "알 수 없는 오류"}
        <p className="mt-1 text-xs text-rose-600">로컬에 동기화된 사본은 잡 실행에 그대로 사용됩니다(Drive 일시 장애와 무관).</p>
      </div>
    );
  }

  const query = q.trim().toLowerCase();
  const allFiles = data.groups.flatMap((g) => g.entries.filter((e) => !e.isDir).map((e) => ({ ...e, group: g.label })));
  const matches = query ? allFiles.filter((e) => `${e.group}/${e.rel}`.toLowerCase().includes(query)) : [];

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Drive 파일 검색 (전체 ${allFiles.length}개)`}
        className="input"
      />

      {data.claudeMd && !query && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-neutral-500">CLAUDE.md (전역 규칙)</h2>
          <div className="mt-3"><FileRow e={data.claudeMd} /></div>
        </section>
      )}

      {query ? (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-neutral-500">검색 결과 ({matches.length}개)</h2>
          {matches.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">매칭되는 파일이 없습니다.</p>
          ) : (
            <ul className="mt-3 space-y-1 font-mono text-xs">
              {matches.map((e) => (
                <li key={`${e.group}/${e.rel}`} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] text-neutral-400">{e.group} / {e.rel.includes("/") ? e.rel.slice(0, e.rel.lastIndexOf("/")) + "/" : ""}</span>
                    <FileLink e={e} />
                  </div>
                  <span className="shrink-0 text-[10px] text-neutral-400">{kb(e.size)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        data.groups.map((g, i) => (
          <Collapsible key={g.key} icon={g.icon} label={g.label} count={g.fileCount} folderUrl={g.folderUrl} defaultOpen={i === 0}>
            <DirTree entries={g.entries} />
          </Collapsible>
        ))
      )}
    </div>
  );
}

function Collapsible({ icon, label, count, folderUrl, defaultOpen, children }: {
  icon: string; label: string; count: number; folderUrl: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="card overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 p-5 text-left hover:bg-neutral-50">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
          <span className={`inline-block text-[10px] text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span>{icon} {label}</span>
          <span className="font-normal text-neutral-400">({count}개 파일)</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-neutral-100 px-5 pb-5 pt-3">
          <div className="mb-2 text-right">
            <a href={folderUrl} target="_blank" rel="noreferrer" className="text-xs text-kurly-500 hover:underline">Drive에서 열기 ↗</a>
          </div>
          {children}
        </div>
      )}
    </section>
  );
}

function FileLink({ e }: { e: Entry }) {
  return e.webViewLink ? (
    <a href={e.webViewLink} target="_blank" rel="noreferrer" className="text-kurly-500 hover:underline">📄 {e.name}</a>
  ) : (
    <span className="text-neutral-700">📄 {e.name}</span>
  );
}

function FileRow({ e }: { e: Entry }) {
  return (
    <div className="flex items-center justify-between font-mono text-xs">
      <FileLink e={e} />
      <span className="text-[10px] text-neutral-400">{kb(e.size)}{e.modifiedTime ? ` · ${ago(e.modifiedTime)}` : ""}</span>
    </div>
  );
}

function DirTree({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return <p className="text-sm text-neutral-500">파일 없음</p>;
  return (
    <ul className="space-y-1 font-mono text-xs">
      {entries.map((e) => {
        const depth = e.rel.split("/").length - 1;
        if (e.isDir) {
          return (
            <li key={e.rel} style={{ paddingLeft: depth * 12 }} className="font-semibold text-neutral-700">
              📁 {e.name}/
            </li>
          );
        }
        return (
          <li key={e.rel} style={{ paddingLeft: depth * 12 + 14 }} className="flex items-center justify-between">
            <div className="min-w-0 flex-1"><FileLink e={e} /></div>
            <span className="ml-2 shrink-0 text-[10px] text-neutral-400">{kb(e.size)}{e.modifiedTime ? ` · ${ago(e.modifiedTime)}` : ""}</span>
          </li>
        );
      })}
    </ul>
  );
}
