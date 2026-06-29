/**
 * 테스트 데이터 — VIP / VVIP 강제 세팅 (DB 직접 적용)
 *
 * 위키 "VIP/VVIP 세팅" > kurlydotcom.mk_member_vip 테이블에 행을 넣어 등급 강제 부여.
 *   - name: "VIP" | "VVIP", started_at/expired_at: 등급 유효기간.
 *   - updated_at/created_at 은 임의값 OK → NOW() 사용.
 *
 * 재실행 동작: member_no 기준 UPSERT (있으면 UPDATE, 없으면 INSERT) — 트랜잭션 내 SELECT 후 분기.
 *   (member_no 에 unique 제약 유무와 무관하게 동작하도록 ON DUPLICATE KEY 대신 명시 분기 사용.)
 *
 * 인증 없음(사내망 한정). STG/사내 creds 노출 정책상 서버 단일 소스로 둠. (PARTNER3P 와 동일 정책)
 */

import mysql from "mysql2/promise";

// kurlydotcom DB (commerce-cms) — 위키 접속정보. STG 한정, 서버 단일 소스.
const DB_CONFIG = {
  host: "stg-commerce-cms.cluster-c9cx6a2jazb5.ap-northeast-2.rds.amazonaws.com",
  port: 3306,
  user: "kurly_user",
  password: "s5^Ne(48NC8Y", // kurly_user (위키 member stg mysql 접속정보)
  database: "kurlydotcom",
  connectTimeout: 8000,
};

const TABLE = "mk_member_vip";

export type VipTier = "VIP" | "VVIP";

export interface VipSetInput {
  memberNos: (number | string)[];   // 회원번호들 (여러 명 동시)
  tier: VipTier;                     // mk_member_vip.name
  startedAt: string;                 // "YYYY-MM-DD HH:mm:ss" (started_at)
  expiredAt: string;                 // "YYYY-MM-DD HH:mm:ss" (expired_at)
}

export interface VipSetResult {
  index: number;
  memberNo: number | string;
  ok: boolean;
  action?: "inserted" | "updated";   // UPSERT 분기 결과
  id?: number | null;                // 영향 행 id
  error?: string;
}

export interface VipProgressEvent {
  type: "member";
  index: number;
  ok: boolean;
  message: string;
}

/** "YYYY-MM-DD" → "YYYY-MM-DD HH:mm:ss" 보정 (이미 시각 포함이면 그대로). */
export function normalizeDateTime(s: string, endOfDay = false): string {
  const t = s.trim();
  if (!t) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} ${endOfDay ? "23:59:59" : "00:00:00"}`;
  // "YYYY-MM-DDTHH:mm" (datetime-local) → 공백 + 초 보정
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) return `${t.replace("T", " ")}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t)) return t.replace("T", " ");
  return t;
}

/**
 * 회원번호별로 mk_member_vip UPSERT. 단일 커넥션 재사용, 행마다 트랜잭션.
 */
export async function setVipBatch(
  input: VipSetInput,
  onProgress?: (e: VipProgressEvent) => void
): Promise<VipSetResult[]> {
  const emit = (e: VipProgressEvent) => onProgress?.(e);
  const startedAt = normalizeDateTime(input.startedAt, false);
  const expiredAt = normalizeDateTime(input.expiredAt, true);
  const tier = input.tier;

  const results: VipSetResult[] = [];
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
  } catch (e) {
    // 연결 실패 → 전건 실패 처리
    const msg = e instanceof Error ? e.message : String(e);
    for (let i = 0; i < input.memberNos.length; i++) {
      const idx = i + 1;
      results.push({ index: idx, memberNo: input.memberNos[i], ok: false, error: `DB 연결 실패: ${msg}` });
      emit({ type: "member", index: idx, ok: false, message: `[#${idx}] ${input.memberNos[i]}: DB 연결 실패: ${msg}` });
    }
    return results;
  }

  try {
    for (let i = 0; i < input.memberNos.length; i++) {
      const idx = i + 1;
      const raw = input.memberNos[i];
      const memberNo = Number(raw);
      if (!memberNo || isNaN(memberNo)) {
        results.push({ index: idx, memberNo: raw, ok: false, error: "유효하지 않은 회원번호" });
        emit({ type: "member", index: idx, ok: false, message: `[#${idx}] ${raw}: 유효하지 않은 회원번호` });
        continue;
      }
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
          `SELECT id FROM ${TABLE} WHERE member_no = ? ORDER BY id DESC LIMIT 1`,
          [memberNo]
        );
        const existing = (rows as any[])[0];
        let action: "inserted" | "updated";
        let id: number | null;
        if (existing) {
          await conn.query(
            `UPDATE ${TABLE} SET name = ?, started_at = ?, expired_at = ?, updated_at = NOW() WHERE id = ?`,
            [tier, startedAt, expiredAt, existing.id]
          );
          action = "updated";
          id = existing.id;
        } else {
          const [ins] = await conn.query(
            `INSERT INTO ${TABLE} (member_no, name, started_at, expired_at, updated_at, created_at)
             VALUES (?, ?, ?, ?, NOW(), NOW())`,
            [memberNo, tier, startedAt, expiredAt]
          );
          action = "inserted";
          id = (ins as any).insertId ?? null;
        }
        await conn.commit();
        results.push({ index: idx, memberNo, ok: true, action, id });
        emit({ type: "member", index: idx, ok: true, message: `[#${idx}] ${memberNo}: ${tier} ${action === "updated" ? "갱신" : "추가"} (id=${id})` });
      } catch (e) {
        try { await conn.rollback(); } catch {}
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ index: idx, memberNo, ok: false, error: msg });
        emit({ type: "member", index: idx, ok: false, message: `[#${idx}] ${memberNo}: ${msg}` });
      }
    }
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
  return results;
}
