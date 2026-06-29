// AES-256-GCM 비밀값 저장/복호화.
//
// 저장 포맷: "enc:v1:<iv_b64>:<ciphertext_b64>:<authTag_b64>"
// 키 위치  : ~/.config/kurly-qa/master.key (32 bytes raw, 0600 권한)
//
// 첫 실행 시 키 자동 생성. 키 파일이 사라지면 기존 암호화된 값은 복호화 불가 →
// 노트북 분실/재설치 시 jira 토큰 재입력 필요 (의도된 trade-off).
//
// 평문(legacy) 값은 isEncrypted() === false 로 식별 → 호출부에서 lazy 마이그레이션.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // GCM 권장
const PREFIX = "enc:v1:";

const KEY_PATH = process.env.KURLY_QA_KEY_PATH
  || path.join(os.homedir(), ".config", "kurly-qa", "master.key");

let cachedKey: Buffer | null = null;

function loadOrCreateKey(): Buffer {
  if (cachedKey) return cachedKey;
  try {
    const buf = fs.readFileSync(KEY_PATH);
    if (buf.length !== KEY_BYTES) {
      throw new Error(`master.key 길이 비정상 (${buf.length} != ${KEY_BYTES})`);
    }
    cachedKey = buf;
    return buf;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
    // 첫 실행 — 키 생성
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true, mode: 0o700 });
    const buf = crypto.randomBytes(KEY_BYTES);
    fs.writeFileSync(KEY_PATH, buf, { mode: 0o600 });
    console.log(`[secret-store] master.key 생성: ${KEY_PATH}`);
    cachedKey = buf;
    return buf;
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encrypt(plain: string): string {
  if (plain === "") return ""; // 빈 문자열은 그대로
  const key = loadOrCreateKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decrypt(stored: string): string {
  if (!isEncrypted(stored)) return stored; // 평문 (legacy)
  const body = stored.slice(PREFIX.length);
  const [ivB64, ctB64, tagB64] = body.split(":");
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error("암호문 형식 오류");
  }
  const key = loadOrCreateKey();
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf-8");
}
