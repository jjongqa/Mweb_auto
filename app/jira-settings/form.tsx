"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/app/_components/confirm-dialog";
import { formatDateTimeKR } from "@/lib/format-date";

type PublicSettings = {
  id: number;
  name: string;
  host: string;
  email: string;
  api_token_masked: string;
  default_project_key: string;
  default_issue_type: string;
  labels: string | null;
  note: string | null;
  last_used_at: string | null;
  claimed_at: string | null;
};

interface FormState {
  id: number | null;       // null = 신규
  name: string;
  host: string;
  email: string;
  apiToken: string;        // 빈 값이면 update 시 기존 토큰 유지
  projectKey: string;
  issueType: string;
  labels: string;
  note: string;
}

const BLANK: FormState = {
  id: null,
  name: "",
  host: "kurly0521.atlassian.net",
  email: "",
  apiToken: "",
  projectKey: "KQA",
  issueType: "Bug",
  labels: "",
  note: "",
};

const MY_NAME_KEY = "kurly-qa:jira-settings:my-name";
// 집 단독 환경 — 모든 토큰 행을 '내 것'으로 취급해 관리 잠금을 해제한다. (회사엔 안 올림. 끄려면 false)
const HOME_UNLOCK = true;

export function JiraSettingsList({ initial }: { initial: PublicSettings[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [form, setForm] = useState<FormState>(BLANK);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [myName, setMyName] = useState<string | null>(null);
  // 저장된 행 연결 테스트 (마스킹돼서 재입력 없이 stored 토큰으로)
  const [testingRowId, setTestingRowId] = useState<number | null>(null);
  const [rowTest, setRowTest] = useState<{ id: number; ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    try { setMyName(localStorage.getItem(MY_NAME_KEY)); } catch {}
  }, []);

  function startEdit(s: PublicSettings) {
    setError(""); setInfo("");
    setForm({
      id: s.id,
      name: s.name,
      host: s.host,
      email: s.email,
      apiToken: "",
      projectKey: s.default_project_key,
      issueType: s.default_issue_type ?? "Bug",
      labels: s.labels ?? "",
      note: s.note ?? "",
    });
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  function resetForm() {
    setForm(BLANK); setError(""); setInfo("");
  }

  async function deleteRow(id: number, name: string) {
    const ok = await confirmDialog({
      title: "토큰 삭제",
      body: `'${name}' 토큰 행을 삭제합니다.`,
      okLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    setError(""); setInfo("");
    const res = await fetch(`/api/jira/settings?id=${id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      setError(j.error || "삭제 실패"); return;
    }
    setInfo(`'${name}' 삭제됨`);
    if (form.id === id) resetForm();
    startTransition(() => router.refresh());
  }

  async function testConn() {
    setError(""); setInfo("");
    if (!form.host || !form.email || !form.apiToken) {
      setError("연결 테스트는 host/email/토큰 모두 필요. (저장된 토큰은 마스킹돼서 안 보이니까 다시 입력)");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/jira/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: form.host, email: form.email, api_token: form.apiToken }),
      });
      const json = await res.json();
      if (json.ok) setInfo(`✓ 연결 성공 — ${json.account}`);
      else setError(`연결 실패: ${json.error}`);
    } finally {
      setTesting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setInfo("");
    if (!form.name || !form.host || !form.email || !form.projectKey) {
      setError("이름/host/email/프로젝트 키 필수"); return;
    }
    if (form.id == null && !form.apiToken) {
      setError("새 등록은 API 토큰 필수"); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/jira/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id ?? undefined,
          name: form.name,
          host: form.host,
          email: form.email,
          api_token: form.apiToken || "__KEEP__",
          default_project_key: form.projectKey,
          default_issue_type: form.issueType,
          labels: form.labels || null,
          note: form.note || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "저장 실패"); return;
      }
      // 신규 등록이면 글로벌 claim 자동 (본인이 만든 행이니까)
      if (form.id == null && json.settings?.id) {
        try {
          await fetch(`/api/jira/settings/claim?id=${json.settings.id}`, { method: "POST" });
          localStorage.setItem(MY_NAME_KEY, form.name);
          setMyName(form.name);
        } catch {}
        setInfo("✓ 신규 등록 + 내 토큰으로 자동 claim 완료");
      } else {
        setInfo("✓ 갱신 완료");
      }
      resetForm();
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  /** 글로벌 claim: 서버에 claimed_at 마킹 + 로컬 myName 도 설정 */
  async function markAsMyToken(s: PublicSettings) {
    setError(""); setInfo("");
    const res = await fetch(`/api/jira/settings/claim?id=${s.id}`, { method: "POST" });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      setError(j.error || "claim 실패"); return;
    }
    try { localStorage.setItem(MY_NAME_KEY, s.name); setMyName(s.name); } catch {}
    setInfo(`✓ "${s.name}" 행을 내 토큰으로 잡았습니다. 다른 워커 화면에서 [내 토큰] 버튼이 숨겨집니다.`);
    startTransition(() => router.refresh());
  }

  /** 글로벌 unclaim: 서버에서도 풀고 로컬도 풀기 */
  async function unmarkMyToken(s: PublicSettings) {
    setError(""); setInfo("");
    const ok = await confirmDialog({
      title: "[내 토큰] 마킹 해제",
      body: `"${s.name}" 행의 [내 토큰] 마킹을 해제합니다.\n\n다른 워커가 다시 claim 할 수 있게 됩니다.`,
      okLabel: "해제",
    });
    if (!ok) return;
    const res = await fetch(`/api/jira/settings/claim?id=${s.id}&unclaim=1`, { method: "POST" });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      setError(j.error || "unclaim 실패"); return;
    }
    try { localStorage.removeItem(MY_NAME_KEY); setMyName(null); } catch {}
    setInfo(`✓ "${s.name}" claim 해제됨`);
    startTransition(() => router.refresh());
  }

  // 저장된 행을 stored 토큰으로 연결 테스트
  async function testRow(s: PublicSettings) {
    setTestingRowId(s.id);
    setRowTest(null);
    try {
      const res = await fetch("/api/jira/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id }),
      });
      const j = await res.json();
      setRowTest({ id: s.id, ok: !!j.ok, msg: j.ok ? `연결 OK — ${j.account}` : (j.error || "실패") });
    } catch (e) {
      setRowTest({ id: s.id, ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTestingRowId(null);
    }
  }

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      {/* 등록된 워커 리스트 */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">
          등록된 토큰 ({initial.length}개)
        </h2>
        {initial.length === 0 ? (
          <div className="rounded border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 text-center text-sm text-neutral-500">
            아직 등록된 토큰이 없습니다. 아래 폼에서 첫 번째 토큰을 등록하세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="p-2 text-left">이름 (실행자 매칭)</th>
                  <th className="p-2 text-left">이메일</th>
                  <th className="p-2 text-left">토큰</th>
                  <th className="p-2 text-left">프로젝트</th>
                  <th className="p-2 text-left">마지막 사용</th>
                  <th className="p-2 text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {initial.map((s) => {
                  const isMine = HOME_UNLOCK || (myName != null && myName === s.name);
                  const isClaimed = s.claimed_at != null;
                  // 표시 분기:
                  //  - 본인 행 (isMine): "내 토큰" 배지 + [해제] 버튼
                  //  - 다른 사람이 claim 한 행 (isClaimed && !isMine): "다른 사람이 잡음" 배지 + [내 토큰] 버튼 안 보임
                  //  - 미claim 행 (!isClaimed): 본인 마킹 없으면 [내 토큰] 버튼 보임
                  return (
                    <tr key={s.id} className={`border-t border-neutral-100 ${isMine ? "bg-emerald-50/40" : isClaimed ? "bg-neutral-50/50" : ""}`}>
                      <td className="p-2 font-semibold">
                        {s.name}
                        {isMine && <span className="ml-1.5 inline-block rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] text-emerald-900">내 토큰</span>}
                        {isClaimed && !isMine && <span className="ml-1.5 inline-block rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-700" title={`${formatDateTimeKR(s.claimed_at)} 에 claim 됨`}>주인 있음</span>}
                        {rowTest?.id === s.id && (
                          <div className={`mt-0.5 text-[10px] ${rowTest.ok ? "text-emerald-600" : "text-rose-600"}`}>
                            {rowTest.ok ? "✓" : "✗"} {rowTest.msg}
                          </div>
                        )}
                      </td>
                      <td className="p-2 font-mono text-[11px]">{s.email}</td>
                      <td className="p-2 font-mono text-[10px] text-neutral-500">{s.api_token_masked}</td>
                      <td className="p-2 font-mono">{s.default_project_key}</td>
                      <td className="p-2 text-[11px] text-neutral-500">{s.last_used_at ? formatDateTimeKR(s.last_used_at) : "미사용"}</td>
                      <td className="p-2 text-right">
                        {/* 관리(테스트/수정/해제/삭제)는 '내 토큰'으로 잡은 본인 행에서만. 남의 행은 잠금 표시(편의 기반 — 인증 아님). */}
                        {isMine ? (
                          <>
                            <button type="button" onClick={() => testRow(s)} disabled={testingRowId === s.id} className="mr-1 rounded border border-blue-300 bg-white px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50 disabled:opacity-50" title="저장된 토큰으로 Jira 연결 테스트">{testingRowId === s.id ? "..." : "테스트"}</button>
                            <button type="button" onClick={() => startEdit(s)} className="mr-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] hover:bg-neutral-50">수정</button>
                            <button type="button" onClick={() => unmarkMyToken(s)} className="mr-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50" title="claim 해제 — 다른 워커가 다시 잡을 수 있게 됨">해제</button>
                            <button type="button" onClick={() => deleteRow(s.id, s.name)} className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50">삭제</button>
                          </>
                        ) : !myName && !isClaimed ? (
                          /* 본인 마킹 없고 미claim 행 → 내 토큰으로 잡기(claim)만 가능 */
                          <button type="button" onClick={() => markAsMyToken(s)} className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50" title="이 행을 내 토큰으로 잡으면 관리 버튼이 열립니다">내 토큰</button>
                        ) : (
                          /* 남의 행 → 관리 잠금 */
                          <span className="text-[11px] text-neutral-400" title="본인 워커(내 토큰으로 잡은 행)만 관리할 수 있습니다">🔒 본인 워커만</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 추가/수정 폼 */}
      <form onSubmit={submit} className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">
            {form.id ? `수정 (id=${form.id})` : "+ 새 워커 토큰 등록"}
          </h2>
          {form.id != null && (
            <button type="button" onClick={resetForm} className="text-xs text-neutral-500 underline">신규 등록 모드로 전환</button>
          )}
        </div>

        {error && <div className="rounded border-l-4 border-rose-400 bg-rose-50 p-2 text-sm text-rose-800">{error}</div>}
        {info && <div className="rounded border-l-4 border-emerald-400 bg-emerald-50 p-2 text-sm text-emerald-800">{info}</div>}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">이름 (워커 식별자) *</label>
            <input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="예 : 종관" className="input mt-1" />
            <p className="mt-1 text-[11px] text-neutral-500">잡 만들 때 "실행자" 입력값과 매칭됩니다 (정확/부분 일치)</p>
          </div>
          <div>
            <label className="block text-sm font-medium">Host *</label>
            <input value={form.host} onChange={(e) => update("host", e.target.value)} placeholder="kurly0521.atlassian.net" className="input mt-1 font-mono text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">이메일 *</label>
            <input value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="jongkwan.ahn@kurlycorp.com" className="input mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium">API 토큰 {form.id ? "(비워두면 기존 유지)" : "*"}</label>
            <input
              type="password"
              value={form.apiToken}
              onChange={(e) => update("apiToken", e.target.value)}
              placeholder={form.id ? "(비워두면 기존 토큰 유지)" : "ATATT..."}
              className="input mt-1 font-mono"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium">기본 프로젝트 키 *</label>
            <input value={form.projectKey} onChange={(e) => update("projectKey", e.target.value)} placeholder="KQA" className="input mt-1 font-mono" />
          </div>
          <div>
            <label className="block text-sm font-medium">기본 이슈 타입</label>
            <input value={form.issueType} onChange={(e) => update("issueType", e.target.value)} placeholder="Bug" className="input mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium">기본 라벨 (쉼표)</label>
            <input value={form.labels} onChange={(e) => update("labels", e.target.value)} placeholder="qa-automated,auto-bug" className="input mt-1" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">메모</label>
          <input value={form.note} onChange={(e) => update("note", e.target.value)} placeholder="예: STG QA 자동화 전용 계정" className="input mt-1" />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={testConn} disabled={testing} className="btn-ghost text-sm">
            {testing ? "테스트 중..." : "🔗 연결 테스트"}
          </button>
          <button type="submit" disabled={submitting} className="rounded-md bg-kurly-500 px-4 py-2 text-sm font-medium text-white hover:bg-kurly-600 disabled:opacity-50">
            {submitting ? "저장 중..." : form.id ? "갱신" : "등록"}
          </button>
        </div>
      </form>
    </div>
  );
}
