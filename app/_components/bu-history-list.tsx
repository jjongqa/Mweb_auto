"use client";

import Link from "next/link";
import { useBu } from "./bu-domain-select";

export type BuHistoryItem = {
  id: string;
  href: string;
  title: string;
  meta: string;                 // "회원 · 2026. 06. 19. 08:18:49"
  tcCount: number | null;       // 생성 완료 건만 숫자, 그 외 null
  bu: "커머스" | "물류";
  status: { label: string; cls: string };
  state?: string;               // 원시 상태 pending|running|succeeded|failed (그룹 집계용)
  groupId?: string | null;      // 작성/설계 멀티(오케스트레이터) 그룹 id
  agentLabel?: string | null;   // 이 잡을 맡은 에이전트 닉네임
};

// 그룹(오케스트레이터) 전체 상태 배지 — 멤버 상태 집계.
function latestAgentMembers(members: BuHistoryItem[]): BuHistoryItem[] {
  const byAgent = new Map<string, BuHistoryItem>();
  for (const m of members) {
    const key = m.agentLabel || m.id;
    if (!byAgent.has(key)) byAgent.set(key, m);
  }
  return [...byAgent.values()];
}

function groupBadge(members: BuHistoryItem[]): { label: string; cls: string } {
  const agents = latestAgentMembers(members);
  const total = agents.length;
  const succeeded = agents.filter((m) => m.state === "succeeded").length;
  const active = agents.some((m) => m.state === "running" || m.state === "pending");
  if (active) return { label: `진행 중 ${succeeded}/${total}`, cls: "bg-blue-100 text-blue-700" };
  if (succeeded === total) return { label: "완료", cls: "bg-emerald-100 text-emerald-700" };
  return { label: `${succeeded}/${total} 완료`, cls: "bg-amber-100 text-amber-700" };
}

// 멤버 title 에서 끝의 "[닉네임]" 꼬리를 떼어 그룹(오케스트레이터) 제목을 만든다.
function groupTitle(members: BuHistoryItem[]): string {
  let t = members[0]?.title ?? "";
  const lbl = members[0]?.agentLabel;
  t = t.replace(/\s*\(개선\s*\d+\)\s*$/, "").trim();
  if (lbl && t.endsWith(`[${lbl}]`)) return t.slice(0, -`[${lbl}]`.length).trim() || t;
  while (/\s*\[[^\]]+\]\s*$/.test(t)) t = t.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  return t || members[0]?.title || "";
}

function agentRowTitle(it: BuHistoryItem): string {
  const refine = it.title.match(/\(개선\s*\d+\)/)?.[0];
  return `${it.agentLabel || "에이전트"}${refine ? ` ${refine}` : ""}`;
}

function FlatRow({ it }: { it: BuHistoryItem }) {
  return (
    <Link href={it.href} className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{it.title}</div>
        <div className="text-xs text-neutral-500">
          {it.meta}
          {it.tcCount != null && <span className="ml-1.5 text-emerald-600">TC {it.tcCount}건</span>}
        </div>
      </div>
      <span className={`badge ${it.status.cls}`}>{it.status.label}</span>
    </Link>
  );
}

// 오케스트레이터(그룹) — 대메뉴 목록에선 헤더 1줄로 요약(에이전트별 행 미표기). 상세는 클릭→그룹 배너에서.
function GroupBlock({ groupId, members }: { groupId: string; members: BuHistoryItem[] }) {
  const head = members[0];
  const agents = latestAgentMembers(members);
  const tcSum = agents.reduce((s, m) => s + (m.tcCount ?? 0), 0);
  const badge = groupBadge(members);
  const href = head.href.startsWith("/tc-gen/") ? `/tc-gen/group/${groupId}` : head.href;
  return (
    <div>
      <Link href={href} className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">🎼 {groupTitle(members)}</div>
          <div className="text-xs text-neutral-500">
            {head.meta}
            <span className="ml-1.5 text-neutral-400">· 종합 메인</span>
            <span className="ml-1.5 text-neutral-400">· 🤖 {agents.length}개 에이전트</span>
            {tcSum > 0 && <span className="ml-1.5 text-emerald-600">· 합본 TC {tcSum}건</span>}
          </div>
        </div>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </Link>
      <div className="border-t border-neutral-100 bg-neutral-50/50">
        {agents.map((it) => (
          <Link key={it.id} href={it.href} className="flex items-center justify-between py-2.5 pl-10 pr-5 hover:bg-white">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-neutral-700">ㄴ {agentRowTitle(it)}</div>
              <div className="text-[11px] text-neutral-500">
                에이전트 결과
                {it.tcCount != null && <span className="ml-1.5 text-emerald-600">TC {it.tcCount}건</span>}
              </div>
            </div>
            <span className={`badge ${it.status.cls}`}>{it.status.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// 현재 BU(공유 토글) 에 맞게 이력을 분기 + 멀티 그룹(오케스트레이터)을 계층으로 보여준다.
export function BuHistoryList({
  heading,
  items,
  emptyAll,
  maxUnits = 10,
}: {
  heading: string;
  items: BuHistoryItem[];
  emptyAll: string;
  maxUnits?: number;
}) {
  const bu = useBu();
  const filtered = items.filter((it) => it.bu === bu);

  // 같은 groupId 끼리 오케스트레이터 1개로 묶고(첫 등장 순서 유지), 그룹/단일 합쳐 maxUnits 개만 노출.
  type Unit = { kind: "single"; item: BuHistoryItem } | { kind: "group"; groupId: string; members: BuHistoryItem[] };
  const seen = new Set<string>();
  const units: Unit[] = [];
  for (const it of filtered) {
    if (it.groupId) {
      if (seen.has(it.groupId)) continue;
      seen.add(it.groupId);
      units.push({ kind: "group", groupId: it.groupId, members: filtered.filter((x) => x.groupId === it.groupId) });
    } else {
      units.push({ kind: "single", item: it });
    }
  }
  const shown = units.slice(0, maxUnits);

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-neutral-500">
        {heading} <span className="font-normal text-neutral-400">· {bu === "커머스" ? "🛒 커머스" : "🚚 물류"}</span>
      </h2>
      {items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">{emptyAll}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">
          {bu === "커머스" ? "🛒 커머스" : "🚚 물류"} 분류에 해당하는 이력이 없습니다.
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100">
          {shown.map((u) =>
            u.kind === "single" ? <FlatRow key={u.item.id} it={u.item} /> : <GroupBlock key={u.groupId} groupId={u.groupId} members={u.members} />
          )}
        </div>
      )}
    </section>
  );
}
