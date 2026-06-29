"use client";

// prompts/ + knowledge/ 파일 브라우저 + 검색. 45개+ 파일을 트리 스크롤 없이 찾기 위함.
// 검색 없을 때: 폴더 트리. 검색 중: 매칭 파일 플랫 목록(폴더 경로 표시).

import Link from "next/link";
import { useState } from "react";
import { DeleteButton } from "./delete-button";

export interface PromptEntry {
  name: string;
  rel: string;
  isDir: boolean;
  size: number;
  folderRel: string;
}

function viewHref(rel: string) {
  return `/prompts/view?path=${encodeURIComponent(rel)}`;
}
function kb(size: number) {
  return `${(size / 1024).toFixed(1)} KB`;
}

export function PromptBrowser({
  prompts,
  knowledge,
  allowedFolders,
}: {
  prompts: PromptEntry[];
  knowledge: PromptEntry[];
  allowedFolders: string[];
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const allFiles = [...prompts, ...knowledge].filter((e) => !e.isDir);
  const matches = query
    ? allFiles.filter((e) => `${e.folderRel}/${e.name}`.toLowerCase().includes(query))
    : [];

  const promptFileCount = prompts.filter((e) => !e.isDir).length;
  const knowledgeFileCount = knowledge.filter((e) => !e.isDir).length;

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`파일 검색 (prompts + knowledge ${allFiles.length}개)`}
        className="input"
      />

      {query ? (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-neutral-500">검색 결과 ({matches.length}개)</h2>
          {matches.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">매칭되는 파일이 없습니다.</p>
          ) : (
            <ul className="mt-3 space-y-1 font-mono text-xs">
              {matches.map((e) => (
                <li key={e.rel} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] text-neutral-400">{e.folderRel}/</span>
                    <Link href={viewHref(e.rel)} className="text-kurly-500 hover:underline">📄 {e.name}</Link>
                    <span className="ml-2 text-[10px] text-neutral-400">({kb(e.size)})</span>
                  </div>
                  {allowedFolders.includes(e.folderRel) && <DeleteButton folder={e.folderRel} filename={e.name} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <Section title={`prompts/ (${promptFileCount}개 파일)`}>
            <DirTree entries={prompts} allowedFolders={allowedFolders} />
          </Section>
          <Section title={`knowledge/ (${knowledgeFileCount}개 파일)`}>
            <DirTree entries={knowledge} allowedFolders={allowedFolders} />
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-neutral-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DirTree({ entries, allowedFolders }: { entries: PromptEntry[]; allowedFolders: string[] }) {
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
            <div className="min-w-0 flex-1">
              <Link href={viewHref(e.rel)} className="text-kurly-500 hover:underline">📄 {e.name}</Link>
              <span className="ml-2 text-[10px] text-neutral-400">({kb(e.size)})</span>
            </div>
            {allowedFolders.includes(e.folderRel) && <DeleteButton folder={e.folderRel} filename={e.name} />}
          </li>
        );
      })}
    </ul>
  );
}
