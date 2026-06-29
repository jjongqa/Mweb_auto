"use client";

import { useEffect, useRef, useState } from "react";

const CMS_KEY = "kurly-qa:admin-token:cms-user";
const LACMS_EMAIL_KEY = "kurly-qa:lacms:email";

interface Step { msg: string; ok: boolean; }
interface PackResult {
  ok: boolean; id?: number | string | null; issued?: boolean; activated?: boolean;
  targetCount?: number | null; error?: string; stepError?: string;
}

export function CouponPackForm({
  seedIds = [],
  seedNonce = 0,
}: {
  seedIds?: (number | string)[];
  seedNonce?: number;
} = {}) {
  const [lacmsEmail, setLacmsEmail] = useState("");
  const [lacmsPassword, setLacmsPassword] = useState("");
  const [cmsUser, setCmsUser] = useState("");
  const [name, setName] = useState("QA쿠폰팩");
  const [couponPublishIds, setCouponPublishIds] = useState("");
  const [issueType, setIssueType] = useState<"ADMIN" | "DOWNLOAD">("ADMIN");
  const [validDays, setValidDays] = useState(7);
  const [bundleUse, setBundleUse] = useState(false);
  const [issueMemberNos, setIssueMemberNos] = useState("");

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<PackResult | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const e = localStorage.getItem(LACMS_EMAIL_KEY); if (e) setLacmsEmail(e);
      const c = localStorage.getItem(CMS_KEY); if (c) setCmsUser(c);
    } catch {}
  }, []);

  // "쿠폰팩으로 묶기" 버튼으로 넘어온 발행 ID 자동 입력 (nonce 증가 시에만 — 단순 마운트/탭전환은 미반영)
  useEffect(() => {
    if (seedNonce > 0 && seedIds.length > 0) setCouponPublishIds(seedIds.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce]);

  const parsedIds = couponPublishIds.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  const parsedMembers = issueMemberNos.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));

  async function submit() {
    setError("");
    if (!lacmsEmail.trim() || !lacmsPassword.trim()) { setError("lacms 이메일/패스워드를 입력하세요"); return; }
    if (parsedIds.length === 0) { setError("묶을 쿠폰 발행 ID를 1개 이상 입력하세요 (쿠폰 발행 결과의 coupon_publish_id)"); return; }
    if (!name.trim()) { setError("쿠폰팩 이름을 입력하세요"); return; }
    try { if (lacmsEmail.trim()) localStorage.setItem(LACMS_EMAIL_KEY, lacmsEmail.trim()); if (cmsUser.trim()) localStorage.setItem(CMS_KEY, cmsUser.trim()); } catch {}

    setRunning(true); setSteps([]); setResult(null);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch("/api/test-data/coupon-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lacmsEmail: lacmsEmail.trim(), lacmsPassword: lacmsPassword.trim(),
          cmsUser: cmsUser.trim() || undefined,
          name: name.trim(),
          couponPublishIds: parsedIds,
          issueType, validDays, bundleUse,
          issueMemberNos: issueType === "ADMIN" ? parsedMembers : undefined,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) { const t = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`); }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
          const ev = /event:\s*(\w+)/.exec(chunk)?.[1];
          const dm = /data:\s*(.+)/s.exec(chunk)?.[1];
          if (!ev || !dm) continue;
          let payload: any = {}; try { payload = JSON.parse(dm); } catch { continue; }
          if (ev === "progress") setSteps((p) => [...p, { msg: payload.msg, ok: payload.ok !== false }]);
          else if (ev === "done") setResult(payload.result);
          else if (ev === "error") setError(payload.message);
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false); abortRef.current = null;
    }
  }

  function cancel() { abortRef.current?.abort(); }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        🎁 <strong>쿠폰팩</strong> = 이미 만든 <strong>쿠폰 발행 ID들을 묶어</strong> 한 팩으로. "쿠폰 발행" 탭에서 쿠폰을 만들면 그 <code>coupon_publish_id</code>들을 <strong>자동으로 가져올 수 있습니다</strong> (발행 결과의 "쿠폰팩으로 묶기 →" 또는 아래 "불러오기" 버튼). · <code>POST /v3/admin/coupon-packs</code>
      </div>

      {/* 인증 */}
      <div className="card border-l-4 border-l-amber-400 p-5 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">📧 lacms 이메일</label>
            <input type="email" value={lacmsEmail} onChange={(e) => setLacmsEmail(e.target.value)} placeholder="jongkwan.ahn@kurlycorp.com" className="input font-mono text-xs" disabled={running} autoComplete="username" />
          </div>
          <div>
            <label className="label">🔒 패스워드</label>
            <input type="password" value={lacmsPassword} onChange={(e) => setLacmsPassword(e.target.value)} placeholder="••••••••" className="input font-mono text-xs" disabled={running} autoComplete="current-password" />
          </div>
        </div>
        <details className="rounded border border-neutral-200 bg-neutral-50/50 p-2">
          <summary className="cursor-pointer text-xs font-medium text-neutral-600">고급: X-KURLY-CMS-USER (401 시에만)</summary>
          <input value={cmsUser} onChange={(e) => setCmsUser(e.target.value)} placeholder="base64(mno:email:name)" className="input mt-2 font-mono text-xs" disabled={running} />
        </details>
      </div>

      {/* 쿠폰팩 설정 */}
      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">쿠폰팩 이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className="input" disabled={running} placeholder="QA쿠폰팩" />
          </div>
          <div>
            <label className="label">발급 유형 (issue_type)</label>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value as typeof issueType)} className="input" disabled={running}>
              <option value="ADMIN">ADMIN (운영자 발급 — 대상 회원 지정)</option>
              <option value="DOWNLOAD">DOWNLOAD (다운로드 — 활성화)</option>
            </select>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label">묶을 쿠폰 발행 ID (coupon_publish_ids) *</label>
            {seedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setCouponPublishIds(seedIds.join(", "))}
                disabled={running}
                className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                title="‘쿠폰 발행’ 탭에서 방금 만든 쿠폰들의 publish_id를 그대로 채워넣기"
              >
                📥 방금 발행한 쿠폰 {seedIds.length}개 불러오기
              </button>
            )}
          </div>
          <textarea value={couponPublishIds} onChange={(e) => setCouponPublishIds(e.target.value)} rows={3} className="input font-mono text-xs" disabled={running} placeholder="123, 124, 125 (쿠폰 발행 결과의 coupon_publish_id — 쉼표/공백/줄바꿈 구분)" />
          <p className="mt-1 text-[11px] text-neutral-500">{parsedIds.length > 0 ? <>인식된 쿠폰 <strong>{parsedIds.length}개</strong>: {parsedIds.slice(0, 8).join(", ")}{parsedIds.length > 8 ? " ..." : ""}</> : "‘쿠폰 발행’ 탭에서 만든 쿠폰들의 ID를 넣으세요 (탭 옆 ‘불러오기’ 또는 발행 결과의 ‘쿠폰팩으로 묶기’ 버튼)."}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">유효기간 (일)</label>
            <input type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(Math.max(1, Math.min(365, Number(e.target.value) || 7)))} className="input" disabled={running} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={bundleUse} onChange={(e) => setBundleUse(e.target.checked)} disabled={running} />
            묶음 사용 처리 (bundle_use)
          </label>
        </div>
        {issueType === "ADMIN" && (
          <div>
            <label className="label">발급 대상 회원번호 (선택)</label>
            <textarea value={issueMemberNos} onChange={(e) => setIssueMemberNos(e.target.value)} rows={2} className="input font-mono text-xs" disabled={running} placeholder="25339850, 25339851 (지정 시 생성 후 발급대상 저장 → 운영자 발급. 비우면 생성까지만)" />
            <p className="mt-1 text-[11px] text-neutral-500">{parsedMembers.length > 0 ? <>발급 대상 <strong>{parsedMembers.length}명</strong></> : "비우면 쿠폰팩 생성까지만 (발급 스킵)"}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={submit} disabled={running || parsedIds.length === 0} className="btn-primary">
          {running ? "처리 중..." : `🎁 쿠폰팩 생성${issueType === "ADMIN" && parsedMembers.length > 0 ? " + 발급" : issueType === "DOWNLOAD" ? " + 활성화" : ""}`}
        </button>
        {running && <button onClick={cancel} className="btn-secondary">⛔ 중단</button>}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {error}</div>}

      {steps.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold text-neutral-700">진행</div>
          <div className="space-y-1 font-mono text-xs">
            {steps.map((s, i) => <div key={i} className={s.ok ? "text-neutral-700" : "text-red-600"}>{s.ok ? "✅" : "❌"} {s.msg}</div>)}
          </div>
        </div>
      )}

      {result && (
        <div className="card p-4 text-sm">
          {result.ok ? (
            <span className="text-green-700 font-semibold">
              ✅ 쿠폰팩 생성 — id <span className="font-mono">{String(result.id)}</span>
              {result.issued ? ` · 발급 완료(${result.targetCount ?? "?"}명)` : result.activated ? " · 다운로드 활성화" : " · 생성까지"}
              {result.stepError ? <span className="ml-2 text-amber-600">⚠ {result.stepError}</span> : null}
            </span>
          ) : (
            <span className="text-red-600">⚠ 생성 실패: {result.error}</span>
          )}
        </div>
      )}
    </div>
  );
}
