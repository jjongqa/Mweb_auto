"use client";

// 생성 중(pending/running)이면 주기적으로 server refresh — 완료되면 자동 정지.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PollUntilDone({ status, intervalMs = 3000 }: { status: string; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "pending" && status !== "running") return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [status, intervalMs, router]);
  return null;
}
