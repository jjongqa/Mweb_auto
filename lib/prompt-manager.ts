// 프롬프트 파일 관리 — 모든 안전장치를 한 곳에 모음
//
// v0.4b: 화이트리스트가 도메인 설정에 따라 동적으로 생성됨
//
// 핵심 안전 원칙:
// 1. 절대 QA-Cowork 폴더 외부에 쓰지 않음 (path traversal 방지)
// 2. .md 확장자만 허용
// 3. 파일명 sanitize
// 4. 덮어쓰기 시 자동 백업
// 5. 삭제 = 백업으로 이동
// 6. 화이트리스트 기반 폴더만 허용

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { db } from "./db";
import type { PromptUploadAction, PromptUpload } from "./db";
import { DOMAINS } from "./domains";

export function getQaCoworkHome(): string {
  if (process.env.KURLY_QA_HOME) return process.env.KURLY_QA_HOME;
  return path.join(os.homedir(), "Documents", "QA-Cowork", "AI_Test");
}

/**
 * 업로드 가능한 폴더 화이트리스트 (도메인 설정에서 동적 생성).
 */
export function getAllowedFolders(): string[] {
  const baseFolders = ["prompts", "prompts/베이스"];
  const knowledgeFolders = DOMAINS.map((d) => `knowledge/${d.knowledgeFolder}`);
  return [...baseFolders, ...knowledgeFolders];
}

export type AllowedFolder = string;

const BACKUP_DIR_NAME = "_backup";

// ============== 검증 ==============

export function isAllowedFolder(folder: string): folder is AllowedFolder {
  return getAllowedFolders().includes(folder);
}

export function sanitizeFilename(name: string): { ok: true; safe: string } | { ok: false; error: string } {
  if (!name || typeof name !== "string") return { ok: false, error: "파일명이 비어있습니다" };
  if (name.includes("/") || name.includes("\\")) {
    return { ok: false, error: "파일명에 경로 구분자(/, \\)를 포함할 수 없습니다" };
  }
  if (name.includes("..")) return { ok: false, error: "파일명에 '..'을 포함할 수 없습니다" };
  if (name.startsWith(".")) return { ok: false, error: "숨김 파일은 업로드할 수 없습니다" };
  if (name.length > 200) return { ok: false, error: "파일명이 너무 깁니다 (최대 200자)" };
  if (!name.toLowerCase().endsWith(".md")) return { ok: false, error: ".md 확장자만 업로드 가능합니다" };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return { ok: false, error: "파일명에 제어 문자가 포함되어 있습니다" };
  return { ok: true, safe: name };
}

export function ensureWithinHome(targetAbs: string, home: string): void {
  // 심볼릭 링크로 외부 경로를 가리키는 경우까지 차단하려면 realpath 필요.
  // 타겟이 아직 없을 수 있으니 (새 파일 쓰기) 부모 디렉터리 기준으로 해소.
  const homeReal = (() => {
    try { return fs.realpathSync(path.resolve(home)); } catch { return path.resolve(home); }
  })();
  let targetReal: string;
  try {
    targetReal = fs.realpathSync(path.resolve(targetAbs));
  } catch {
    const parent = path.dirname(path.resolve(targetAbs));
    try {
      targetReal = path.join(fs.realpathSync(parent), path.basename(targetAbs));
    } catch {
      targetReal = path.resolve(targetAbs);
    }
  }
  if (targetReal !== homeReal && !targetReal.startsWith(homeReal + path.sep)) {
    throw new Error("경로가 QA-Cowork 홈 외부를 가리킵니다");
  }
}

// ============== 조회 ==============

export interface FolderEntry {
  name: string;
  size: number;
  modified: string;
}

export function listFolder(folder: string): FolderEntry[] {
  if (!isAllowedFolder(folder)) throw new Error(`허용되지 않은 폴더: ${folder}`);
  const home = getQaCoworkHome();
  const dirAbs = path.join(home, folder);
  ensureWithinHome(dirAbs, home);
  if (!fs.existsSync(dirAbs)) return [];
  return fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("."))
    .map((e) => {
      const stat = fs.statSync(path.join(dirAbs, e.name));
      return { name: e.name, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fileExists(folder: AllowedFolder, filename: string): boolean {
  const home = getQaCoworkHome();
  const targetAbs = path.join(home, folder, filename);
  ensureWithinHome(targetAbs, home);
  return fs.existsSync(targetAbs);
}

// ============== 업로드 ==============

export interface UploadResult {
  action: PromptUploadAction;
  targetPath: string;
  backupPath: string | null;
  size: number;
}

export function uploadPrompt(input: {
  folder: AllowedFolder;
  filename: string;
  content: Buffer;
  uploadedBy?: string | null;
  allowOverwrite?: boolean;
}): UploadResult {
  const { folder, filename, content, uploadedBy = null, allowOverwrite = false } = input;
  const home = getQaCoworkHome();
  if (!fs.existsSync(home)) throw new Error(`QA-Cowork 홈 없음: ${home}`);

  if (!isAllowedFolder(folder)) throw new Error(`허용되지 않은 폴더: ${folder}`);
  const checked = sanitizeFilename(filename);
  if (!checked.ok) throw new Error(checked.error);
  if (content.length > 5 * 1024 * 1024) throw new Error("파일 크기가 5MB를 초과합니다");

  try {
    const text = content.toString("utf-8");
    if (text.length === 0) throw new Error("빈 파일입니다");
    if (text.includes("\u0000")) throw new Error("바이너리 파일로 보임 (null 바이트 포함)");
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("파일 검증 실패");
  }

  const dirAbs = path.join(home, folder);
  fs.mkdirSync(dirAbs, { recursive: true });
  const targetAbs = path.join(dirAbs, checked.safe);
  ensureWithinHome(targetAbs, home);

  const exists = fs.existsSync(targetAbs);
  let backupPath: string | null = null;

  if (exists) {
    if (!allowOverwrite) {
      throw new Error(`이미 같은 이름의 파일이 존재합니다: ${folder}/${checked.safe}`);
    }
    backupPath = backupFile(home, folder, checked.safe);
  }

  fs.writeFileSync(targetAbs, content);

  recordUpload({
    action: exists ? "overwrite" : "upload",
    target_folder: folder,
    filename: checked.safe,
    size_bytes: content.length,
    backup_path: backupPath,
    uploaded_by: uploadedBy,
    note: null,
  });

  return {
    action: exists ? "overwrite" : "upload",
    targetPath: targetAbs,
    backupPath,
    size: content.length,
  };
}

export function deletePrompt(input: {
  folder: AllowedFolder;
  filename: string;
  uploadedBy?: string | null;
}): { backupPath: string } {
  const { folder, filename, uploadedBy = null } = input;
  const home = getQaCoworkHome();

  if (!isAllowedFolder(folder)) throw new Error(`허용되지 않은 폴더: ${folder}`);
  const checked = sanitizeFilename(filename);
  if (!checked.ok) throw new Error(checked.error);

  const targetAbs = path.join(home, folder, checked.safe);
  ensureWithinHome(targetAbs, home);
  if (!fs.existsSync(targetAbs)) throw new Error(`파일 없음: ${folder}/${checked.safe}`);

  const backupPath = backupFile(home, folder, checked.safe);
  fs.unlinkSync(targetAbs);

  recordUpload({
    action: "delete",
    target_folder: folder,
    filename: checked.safe,
    size_bytes: null,
    backup_path: backupPath,
    uploaded_by: uploadedBy,
    note: "휴지통(_backup)으로 이동",
  });

  return { backupPath };
}

function backupFile(home: string, folder: string, filename: string): string {
  const sourceAbs = path.join(home, folder, filename);
  const backupRoot = path.join(home, BACKUP_DIR_NAME, folder);
  fs.mkdirSync(backupRoot, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `${ts}_${filename}`;
  const backupAbs = path.join(backupRoot, backupName);
  fs.copyFileSync(sourceAbs, backupAbs);
  return backupAbs;
}

function recordUpload(input: {
  action: PromptUploadAction;
  target_folder: string;
  filename: string;
  size_bytes: number | null;
  backup_path: string | null;
  uploaded_by: string | null;
  note: string | null;
}) {
  db.prepare(
    `INSERT INTO prompt_uploads (action, target_folder, filename, size_bytes, backup_path, uploaded_by, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.action,
    input.target_folder,
    input.filename,
    input.size_bytes,
    input.backup_path,
    input.uploaded_by,
    input.note
  );
}

export function listUploads(limit = 50): PromptUpload[] {
  return db
    .prepare(`SELECT * FROM prompt_uploads ORDER BY id DESC LIMIT ?`)
    .all(limit) as PromptUpload[];
}
