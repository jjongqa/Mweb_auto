import Link from "next/link";
import { listJobs, countByStatus } from "@/lib/jobs";
import { formatDateTimeKR } from "@/lib/format-date";
import { listWorkers, markStaleWorkersOffline, workerStatusLabel } from "@/lib/workers";
import { ShareUrlBanner } from "./share-banner";

export const dynamic = "force-dynamic";

function workerCap(capJson: string | null): { web: boolean; app: boolean } {
  try { const c = JSON.parse(capJson || "{}"); return { web: !!c.web, app: !!c.app }; }
  catch { return { web: false, app: false }; }
}

export default function Home() {
  const jobs = listJobs(5);
  const counts = countByStatus();
  const queueSize = counts.pending + counts.running;

  // F9 워커 플릿 헬스 한 줄
  markStaleWorkersOffline();
  const allWorkers = listWorkers();
  const online = allWorkers.filter((w) => workerStatusLabel(w) !== "꺼짐");
  const busyCount = online.filter((w) => workerStatusLabel(w) === "실행 중").length;
  const webCount = online.filter((w) => workerCap(w.capabilities).web).length;
  const appCount = online.filter((w) => workerCap(w.capabilities).app).length;

  return (
    <div className="space-y-8">
      <ShareUrlBanner />

      <Link href="/qa-design" className="group flex items-center gap-3 card p-5 transition hover:border-kurly-200 hover:shadow-kpds3">
        <span className="text-2xl">🔬</span>
        <div className="flex-1">
          <div className="font-semibold group-hover:text-kurly-500">QA 설계</div>
          <div className="text-sm text-neutral-600"><strong>TC 작성 전.</strong> 기획서를 QA 관점으로 분석(리스크 등급·영역·엣지/모호점·중점 포인트) → 다듬어서 <strong>TC 생성으로 보내기</strong>하면 그 분석이 TC에 반영.</div>
        </div>
        <span className="text-kurly-500">→</span>
      </Link>

      <Link href="/tc-gen" className="group flex items-center gap-3 card p-5 transition hover:border-kurly-200 hover:shadow-kpds3">
        <span className="text-2xl">🧬</span>
        <div className="flex-1">
          <div className="font-semibold group-hover:text-kurly-500">TC 생성</div>
          <div className="text-sm text-neutral-600"><strong>TC가 아직 없을 때.</strong> 기획서 → 도메인 정책+스킬 적용 → TC CSV 자동 생성. 만든 CSV를 아래 풀 테스트로 바로 실행.</div>
        </div>
        <span className="text-kurly-500">→</span>
      </Link>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card p-7">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h2 className="text-lg font-semibold">기능 풀 테스트</h2>
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            <strong>TC CSV 가 있을 때.</strong> 정의된 케이스 전부 자동 실행 + 스크린샷.
          </p>
          <Link href="/upload" className="mt-5 inline-block rounded-[8px] bg-kurly-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(95,0,128,0.18)] hover:bg-kurly-600">
            기능테스트 시작 →
          </Link>
        </section>

        <section className="card p-7">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔍</span>
            <h2 className="text-lg font-semibold">애드혹 테스트</h2>
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            <strong>기획서만 있을 때.</strong> AI 가 시나리오 도출해서 UI 탐색 검증 → <code>report.md</code>.
          </p>
          <Link href="/adhoc" className="mt-5 inline-block rounded-[8px] bg-kurly-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(95,0,128,0.18)] hover:bg-kurly-600">
            애드혹 시작 →
          </Link>
        </section>
      </div>

      {/* 하단 서브메뉴 제거 — 상단 헤더 네비와 중복 (히스토리·스위트·프롬프트·워커는 상단에 있음) */}

      {/* F9 워커 플릿 헬스 한 줄 */}
      <Link
        href="/workers"
        className="flex items-center gap-2 rounded-[12px] border border-neutral-200 bg-white px-4 py-2.5 text-sm shadow-kpds1 hover:bg-neutral-50"
      >
        <span className={`inline-block h-2 w-2 rounded-full ${online.length > 0 ? "bg-emerald-500" : "bg-neutral-300"}`} />
        {allWorkers.length === 0 ? (
          <span className="text-neutral-500">내장 워커 모드 — 대기 잡이 쌓이면 터미널에서 <code>npm run worker</code> 상태를 확인하세요</span>
        ) : (
          <span className="text-neutral-700">
            워커 <strong>{online.length}/{allWorkers.length}</strong> 온라인
            <span className="mx-1.5 text-neutral-300">·</span>
            <span className="text-neutral-500">web {webCount} · app {appCount}</span>
            <span className="mx-1.5 text-neutral-300">·</span>
            {busyCount > 0
              ? <span className="text-blue-600">{busyCount}대 실행 중</span>
              : <span className="text-neutral-500">전부 대기</span>}
          </span>
        )}
      </Link>

      {queueSize > 0 && (
        <section className="card border-blue-200 bg-blue-50 p-4 text-sm">
          <div className="flex items-center justify-between">
            <div className="text-blue-900">
              <strong>큐 상태:</strong> 실행 중 <span className="font-mono">{counts.running}</span> · 대기 <span className="font-mono">{counts.pending}</span>
              {counts.pending > 0 && (
                <span className="ml-2 text-xs text-blue-700">
                  (워커는 동시 1개씩 처리. 새 작업은 앞 작업 종료 후 시작됨)
                </span>
              )}
            </div>
            <Link href="/history" className="text-xs text-blue-600 hover:underline">상세 →</Link>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">최근 실행</h2>
        {jobs.length === 0 ? (
          <div className="card p-8 text-center text-sm text-neutral-500">
            아직 실행 기록이 없어요.
          </div>
        ) : (
          <div className="card divide-y divide-neutral-200">
            {jobs.map((j) => (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {(j.job_type === "adhoc" ? "[애드혹]_" : "") + (j.task_name || j.tc_filename)}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {j.domain} · {j.platform === "app" ? "App" : j.platform === "mweb" ? "Mweb" : "Web"} · {j.qa_env} · {formatDateTimeKR(j.created_at)}
                    {j.requested_by && (
                      <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">{j.requested_by}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${j.mode === "real" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {j.mode === "real" ? "REAL" : "MOCK"}
                  </span>
                  <StatusBadge status={j.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-neutral-100 text-neutral-700",
    running: "bg-blue-100 text-blue-700",
    succeeded: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
    canceled: "bg-neutral-100 text-neutral-500",
  };
  const labels: Record<string, string> = {
    pending: "대기", running: "실행 중", succeeded: "성공", failed: "실패", canceled: "취소",
  };
  return <span className={`badge ${styles[status] ?? ""}`}>{labels[status] ?? status}</span>;
}
