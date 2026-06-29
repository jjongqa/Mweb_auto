import Link from "next/link";
import { getTcGenEffectiveGroupId, listTcGenJobs } from "@/lib/tc-gen";
import { getDomainById } from "@/lib/domains";
import { formatDateTimeKR } from "@/lib/format-date";
import { TcGenForm } from "./form";
import { BuProvider } from "@/app/_components/bu-domain-select";
import { BuHistoryList, type BuHistoryItem } from "@/app/_components/bu-history-list";

export const dynamic = "force-dynamic";

const STATUS_KR: Record<string, { label: string; cls: string }> = {
  pending: { label: "대기", cls: "bg-neutral-100 text-neutral-600" },
  running: { label: "생성 중", cls: "bg-blue-100 text-blue-700" },
  succeeded: { label: "완료", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "실패", cls: "bg-rose-100 text-rose-700" },
};

export default function TcGenPage() {
  // 그룹(오케스트레이터) 멤버가 윈도 경계에서 잘리지 않도록 넉넉히 받고, 리스트가 그룹화 후 N개로 자른다.
  const recent = listTcGenJobs(80, "tc");
  const items: BuHistoryItem[] = recent.map((j) => {
    const label = getDomainById(j.domain)?.label ?? j.domain;
    return {
      id: j.id,
      href: `/tc-gen/${j.id}`,
      title: j.task_name || `${label} TC`,
      meta: `${label} · ${formatDateTimeKR(j.created_at)}`,
      tcCount: j.status === "succeeded" ? j.tc_count : null,
      bu: getDomainById(j.domain)?.bu ?? "커머스",
      status: STATUS_KR[j.status] ?? STATUS_KR.pending,
      state: j.status,
      groupId: getTcGenEffectiveGroupId(j),
      agentLabel: j.agent_nickname,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">🧬 TC 생성</h1>
        <p className="mt-1 text-sm text-neutral-600">
          기획서를 분석해 도메인 <strong>마스터 정책 + TC 작성 스킬</strong>을 적용한 테스트 케이스를 CSV로 생성합니다.
          생성된 CSV는 다운로드해서 <Link href="/upload" className="text-kurly-500 underline">기능테스트</Link>에 올리면 바로 테스트할 수 있어요.
        </p>
      </div>

      <BuProvider>
        <TcGenForm />
        <BuHistoryList heading="최근 생성" items={items} emptyAll="아직 생성 이력이 없습니다." />
      </BuProvider>
    </div>
  );
}
