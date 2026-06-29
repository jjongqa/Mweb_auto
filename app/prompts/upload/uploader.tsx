"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { DOMAINS } from "@/lib/domains";
import { confirmDialog } from "@/app/_components/confirm-dialog";

const FOLDERS = [
  { value: "prompts", label: "prompts/ — 도메인/시나리오 프롬프트" },
  { value: "prompts/베이스", label: "prompts/베이스/ — 공통 베이스" },
  ...DOMAINS.map((d) => ({
    value: `knowledge/${d.knowledgeFolder}`,
    label: `knowledge/${d.knowledgeFolder}/ — ${d.label} 날리지`,
  })),
];

interface PendingFile {
  file: File;
  status: "checking" | "ready" | "conflict" | "uploading" | "done" | "error";
  exists: boolean;
  message?: string;
}

export function PromptUploader() {
  const router = useRouter();
  const [folder, setFolder] = useState("prompts");
  const [uploadedBy, setUploadedBy] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(async (incoming: File[]) => {
    const valid = incoming.filter((f) => f.name.toLowerCase().endsWith(".md"));
    if (valid.length === 0) {
      alert(".md 파일만 업로드 가능합니다");
      return;
    }
    const newPending: PendingFile[] = valid.map((f) => ({ file: f, status: "checking", exists: false }));
    setFiles((prev) => [...prev, ...newPending]);

    // 각 파일 충돌 체크
    for (let i = 0; i < newPending.length; i++) {
      const pf = newPending[i];
      try {
        const url = `/api/prompts/upload?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(pf.file.name)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) {
          updateFile(pf.file, { status: "error", message: json.error });
          continue;
        }
        if (json.exists) {
          updateFile(pf.file, { status: "conflict", exists: true });
        } else {
          updateFile(pf.file, { status: "ready", exists: false });
        }
      } catch (err) {
        updateFile(pf.file, { status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }
  }, [folder]);

  function updateFile(target: File, patch: Partial<PendingFile>) {
    setFiles((prev) => prev.map((p) => (p.file === target ? { ...p, ...patch } : p)));
  }

  function removeFile(target: File) {
    setFiles((prev) => prev.filter((p) => p.file !== target));
  }

  async function uploadOne(pf: PendingFile, allowOverwrite: boolean) {
    updateFile(pf.file, { status: "uploading", message: undefined });
    try {
      const fd = new FormData();
      fd.append("folder", folder);
      fd.append("file", pf.file);
      fd.append("allow_overwrite", allowOverwrite ? "1" : "0");
      if (uploadedBy) fd.append("uploaded_by", uploadedBy);
      const res = await fetch("/api/prompts/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        updateFile(pf.file, { status: "error", message: json.error || "업로드 실패" });
        return;
      }
      updateFile(pf.file, { status: "done", message: allowOverwrite ? "덮어쓰기 완료 (백업됨)" : "신규 업로드 완료" });
    } catch (err) {
      updateFile(pf.file, { status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function uploadAllReady() {
    const ready = files.filter((f) => f.status === "ready");
    for (const f of ready) await uploadOne(f, false);
    router.refresh();
  }

  async function confirmOverwrite(pf: PendingFile) {
    const ok = await confirmDialog({
      title: "기존 파일 덮어쓰기",
      body: `${folder}/${pf.file.name}\n\n기존 파일은 _backup/ 폴더로 자동 백업된 뒤 새 파일이 덮어씁니다.`,
      okLabel: "덮어쓰기",
      danger: true,
    });
    if (!ok) return;
    await uploadOne(pf, true);
    router.refresh();
  }

  return (
    <div className="card p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">대상 폴더</label>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} className="input">
            {FOLDERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">업로더 (선택)</label>
          <input
            type="text"
            value={uploadedBy}
            onChange={(e) => setUploadedBy(e.target.value)}
            placeholder="예: 종관"
            className="input"
          />
        </div>
      </div>

      <div
        className={`mt-5 cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragOver ? "border-kurly-500 bg-kurly-50" : "border-neutral-300 bg-neutral-50 hover:border-neutral-400"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer.files);
          onDrop(dropped);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".md"
          multiple
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            onDrop(list);
            e.target.value = "";
          }}
        />
        <div className="text-3xl">📁</div>
        <div className="mt-2 text-sm font-medium text-neutral-700">
          .md 파일을 여기에 드래그하거나 클릭해서 선택
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          여러 파일 동시 업로드 가능 · 5MB 이하
        </div>
      </div>

      {files.length > 0 && (
        <div className="mt-5 space-y-2">
          {files.map((pf) => (
            <FileRow
              key={pf.file.name + pf.file.size}
              pending={pf}
              folder={folder}
              onUpload={() => uploadOne(pf, false)}
              onConfirmOverwrite={() => confirmOverwrite(pf)}
              onRemove={() => removeFile(pf.file)}
            />
          ))}

          {files.some((f) => f.status === "ready") && (
            <button
              onClick={uploadAllReady}
              className="mt-2 btn-primary w-full"
            >
              신규 파일 모두 업로드 ({files.filter((f) => f.status === "ready").length}개)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({
  pending,
  folder,
  onUpload,
  onConfirmOverwrite,
  onRemove,
}: {
  pending: PendingFile;
  folder: string;
  onUpload: () => void;
  onConfirmOverwrite: () => void;
  onRemove: () => void;
}) {
  const { file, status, message } = pending;
  return (
    <div className="flex items-center gap-3 rounded-md border border-neutral-200 p-3 text-sm">
      <div className="flex-1 min-w-0">
        <div className="truncate font-mono">{file.name}</div>
        <div className="text-xs text-neutral-500">
          {folder}/ · {(file.size / 1024).toFixed(1)} KB
          {message && <span className={`ml-2 ${status === "error" ? "text-rose-600" : "text-neutral-700"}`}>· {message}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {status === "checking" && <span className="text-xs text-blue-600">확인 중...</span>}
        {status === "ready" && (
          <>
            <span className="badge bg-emerald-100 text-emerald-700">신규</span>
            <button onClick={onUpload} className="btn-primary !px-3 !py-1 text-xs">업로드</button>
          </>
        )}
        {status === "conflict" && (
          <>
            <span className="badge bg-amber-100 text-amber-700">충돌</span>
            <button onClick={onConfirmOverwrite} className="rounded bg-amber-500 px-3 py-1 text-xs text-white hover:bg-amber-600">
              덮어쓰기 (자동 백업)
            </button>
          </>
        )}
        {status === "uploading" && <span className="text-xs text-blue-600">업로드 중...</span>}
        {status === "done" && <span className="badge bg-emerald-100 text-emerald-700">✓ 완료</span>}
        {status === "error" && <span className="badge bg-rose-100 text-rose-700">에러</span>}
        <button onClick={onRemove} className="text-neutral-400 hover:text-rose-500" title="목록에서 제거">
          ✕
        </button>
      </div>
    </div>
  );
}
