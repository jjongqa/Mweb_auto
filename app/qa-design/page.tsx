import { listTcGenJobs } from "@/lib/tc-gen";
import { getDomainById } from "@/lib/domains";
import { formatDateTimeKR } from "@/lib/format-date";
import { QaDesignForm } from "./form";
import { BuProvider } from "@/app/_components/bu-domain-select";
import { BuHistoryList, type BuHistoryItem } from "@/app/_components/bu-history-list";

export const dynamic = "force-dynamic";

const STATUS_KR: Record<string, { label: string; cls: string }> = {
  pending: { label: "대기", cls: "bg-neutral-100 text-neutral-600" },
  running: { label: "설계 중", cls: "bg-blue-100 text-blue-700" },
  succeeded: { label: "완료", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "실패", cls: "bg-rose-100 text-rose-700" },
};

export default function QaDesignPage() {
  // 그룹(오케스트레이터) 멤버가 윈도 경계에서 잘리지 않도록 넉넉히 받고, 리스트가 그룹화 후 N개로 자른다.
  const recent = listTcGenJobs(30, "design");
  const items: BuHistoryItem[] = recent.map((j) => {
    const label = getDomainById(j.domain)?.label ?? j.domain;
    return {
      id: j.id,
      href: `/qa-design/${j.id}`,
      title: j.task_name || `${label} QA 설계`,
      meta: `${label} · ${formatDateTimeKR(j.created_at)}`,
      tcCount: null,
      bu: getDomainById(j.domain)?.bu ?? "커머스",
      status: STATUS_KR[j.status] ?? STATUS_KR.pending,
      state: j.status,
      groupId: j.agent_group_id,
      agentLabel: j.agent_nickname,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">🔬 QA 설계</h1>
        <p className="mt-1 text-sm text-neutral-600">
          기획서를 <strong>QA 관점으로 분석</strong>(리스크 등급·영역·엣지/모호점·중점 포인트)합니다.
          결과를 피드백으로 다듬은 뒤 <strong>TC생성으로 보내기</strong>하면 그 분석이 TC에 반영돼요.
        </p>
      </div>

      <BuProvider>
        <QaDesignForm />
        <BuHistoryList heading="최근 설계" items={items} emptyAll="아직 설계 이력이 없습니다." />
      </BuProvider>
    </div>
  );
}
