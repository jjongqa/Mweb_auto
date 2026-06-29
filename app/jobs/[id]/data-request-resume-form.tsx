"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DataRequestResumeForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [lacmsEmail, setLacmsEmail] = useState("");
  const [lacmsPassword, setLacmsPassword] = useState("");
  const [memberNo, setMemberNo] = useState("");
  const [dealProductNo, setDealProductNo] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");

    const payload = {
      lacmsEmail: lacmsEmail.trim(),
      lacmsPassword,
      memberNo: memberNo.trim(),
      dealProductNo: dealProductNo.trim(),
    };

    if (!payload.lacmsEmail && !payload.lacmsPassword && !payload.memberNo && !payload.dealProductNo) {
      setError("LACMS 계정 또는 주문 생성에 필요한 값을 입력해 주세요.");
      return;
    }

    startTransition(async () => {
      const res = await fetch(`/api/data-requests/${encodeURIComponent(requestId)}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json.error || "재시도 등록 실패");
        return;
      }
      setOk("입력값 반영 완료. 워커가 다시 처리합니다.");
      setLacmsPassword("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="text-xs font-semibold text-amber-900">LACMS/주문 데이터 입력 후 자동 재시도</div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <input
          value={lacmsEmail}
          onChange={(e) => setLacmsEmail(e.target.value)}
          className="input bg-white text-xs"
          placeholder="LACMS 이메일"
          autoComplete="username"
        />
        <input
          value={lacmsPassword}
          onChange={(e) => setLacmsPassword(e.target.value)}
          className="input bg-white text-xs"
          placeholder="LACMS 비밀번호"
          type="password"
          autoComplete="current-password"
        />
        <input
          value={memberNo}
          onChange={(e) => setMemberNo(e.target.value)}
          className="input bg-white text-xs"
          placeholder="회원번호 memberNo (선택)"
        />
        <input
          value={dealProductNo}
          onChange={(e) => setDealProductNo(e.target.value)}
          className="input bg-white text-xs"
          placeholder="주문 가능 dealProductNo (선택)"
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-amber-800">
          입력값은 같은 데이터 요청에 반영되고, 큐에 다시 올라가 워커가 자동 처리합니다.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "재시도 등록 중..." : "저장 후 재시도"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-rose-600">{error}</div>}
      {ok && <div className="mt-2 text-xs text-emerald-700">{ok}</div>}
    </form>
  );
}
