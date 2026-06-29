import Link from "next/link";

export const dynamic = "force-dynamic";

const GUIDES = [
  {
    href: "/workers/install",
    emoji: "💻",
    title: "워커 설치 (처음이신가요?)",
    desc: "본인 Mac 에 자동화 워커를 설치하는 방법. 한 줄 명령으로 자동 설치.",
    color: "bg-amber-500 hover:bg-amber-600",
    border: "border-amber-200 bg-amber-50/30",
    time: "10~20분",
    target: "처음 시작하시는 분",
  },
  {
    href: "/guide/full-test",
    emoji: "📋",
    title: "기능 풀 테스트 사용법",
    desc: "TC CSV 를 업로드해서 정의된 케이스를 모두 자동 실행하는 방법.",
    color: "bg-kurly-500 hover:bg-kurly-600",
    border: "border-neutral-200",
    time: "5분",
    target: "TC 정의된 회귀 / 풀 테스트 돌릴 때",
  },
  {
    href: "/guide/adhoc-test",
    emoji: "🔍",
    title: "애드혹 테스트 사용법",
    desc: "기획서 + 자유 텍스트만으로 AI 가 시나리오 도출해서 탐색 검증.",
    color: "bg-indigo-500 hover:bg-indigo-600",
    border: "border-neutral-200 bg-neutral-50",
    time: "5분",
    target: "기획서만 있고 TC 없는 신기능 검증",
  },
  {
    href: "/guide/agents",
    emoji: "🎮",
    title: "에이전트 오피스 (멀티 분할·병렬)",
    desc: "워커별 에이전트로 한 작업을 여러 개로 나눠 병렬 처리 → 합본. 설계·작성·수행 모두 적용. 단일/멀티·이름·지시 설정.",
    color: "bg-kurly-500 hover:bg-kurly-600",
    border: "border-neutral-200 bg-neutral-50",
    time: "3~5분",
    target: "TC 많아 시간 줄이거나 영역별 분담 분석/작성 원하는 분",
  },
  {
    href: "/guide/jira",
    emoji: "🪲",
    title: "Jira + Confluence 자동화 사용법 ⭐",
    desc: "워커별 Atlassian 토큰 1회 등록 → Confluence 기획서 자동 추출 + FAIL 건 reporter=본인 으로 Jira 등록. 모든 워커 필수.",
    color: "bg-rose-500 hover:bg-rose-600",
    border: "border-rose-200 bg-rose-50/30",
    time: "최초 5분 · 테스트당 30초",
    target: "어드민으로 잡 만드는 모든 워커 (필수 세팅)",
  },
  {
    href: "/guide/test-data",
    emoji: "🧪",
    title: "테스트 데이터 생성 사용법",
    desc: "회원 / 멤버스 / VIP·VVIP / 쿠폰 / 상품(1P·3P) / 할인 / 주문·혼합주문 / 적립금 / 프로모션을 API·DB 직접 호출로 한 번에 N건.",
    color: "bg-violet-500 hover:bg-violet-600",
    border: "border-neutral-200 bg-neutral-50",
    time: "5분",
    target: "테스트 사전 데이터를 빠르게 만들고 싶은 분",
  },
  {
    href: "/guide/prompts",
    emoji: "📝",
    title: "프롬프트 / 날리지 (Drive 동기화) 사용법",
    desc: "TC 스킬·마스터정책·기능테스트 프롬프트가 팀 공유 Drive에서 자동 동기화되는 원리 + 방금 고친 걸 즉시 반영하는 법(갱신 버튼).",
    color: "bg-kurly-500 hover:bg-kurly-600",
    border: "border-neutral-200 bg-neutral-50",
    time: "3분",
    target: "스킬/정책/프롬프트를 수정·관리하는 분",
  },
  {
    href: "/guide/company-export",
    emoji: "📦",
    title: "회사 반영 Export 가이드",
    desc: "개인 PC 작업본을 회사 PC에 가져갈 때 필요한 압축 제외 목록, 변경 파일 확인, Claude 반영 프롬프트.",
    color: "bg-sky-500 hover:bg-sky-600",
    border: "border-neutral-200 bg-neutral-50",
    time: "3분",
    target: "개인 PC 작업을 회사 레포에 선별 반영할 때",
  },
  {
    href: "/workers/update",
    emoji: "🔄",
    title: "워커 업데이트 (재설치)",
    desc: "어드민에 새 패치가 반영되면 워커도 같이 업데이트. 한 줄 명령으로 백업+재설치.",
    color: "bg-emerald-500 hover:bg-emerald-600",
    border: "border-neutral-200 bg-neutral-50",
    time: "5분",
    target: "기존 워커 사용자 (이미 설치하신 분)",
  },
];

// 가이드 페이지는 별도로 없고 본문에 짧게 안내만 — 메뉴 위치/사용법 표시용
const QUICK_FEATURES = [
  {
    href: "/qa-design",
    emoji: "🔬",
    title: "QA 설계 (기획서 → 분석)",
    desc: "기획서를 QA 관점(리스크 등급·영역·엣지/모호점·중점 포인트)으로 먼저 분석. 피드백으로 다듬은 뒤 → TC 생성으로 보내면 그 분석이 TC 에 반영됨.",
  },
  {
    href: "/tc-gen",
    emoji: "🧬",
    title: "TC 생성 (기획서/설계 → CSV)",
    desc: "기획서 또는 QA 설계 결과를 도메인 마스터 정책 + TC 작성 스킬로 CSV 자동 생성. 다운로드해서 기능테스트에 그대로 업로드.",
  },
  {
    href: "/suites",
    emoji: "📁",
    title: "회귀 스위트 (저장 + 재실행)",
    desc: "자주 돌리는 잡 설정(파일·도메인·환경·모델·필터)을 이름으로 저장 → 한 번에 재실행. 잡 상세 → 📁 스위트로 저장.",
  },
  {
    href: "/compare",
    emoji: "📊",
    title: "결과 비교 (다중 잡)",
    desc: "여러 실행의 TC별 결과를 나란히 비교. fix 전후 등. 결과가 바뀐 TC는 주황 강조.",
  },
];

export default function GuideHub() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📖 가이드</h1>
        <p className="mt-2 text-sm text-neutral-600">
          처음 사용하시거나 특정 기능 사용법이 궁금할 때 보세요. 모든 가이드는 단계별 + 화면 미리보기 + FAQ 포함.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {GUIDES.map((g) => (
          <Link
            key={g.href}
            href={g.href}
            className="group card p-6 transition hover:border-kurly-200 hover:shadow-md"
          >
            <div className="flex items-start gap-3">
              <span className="text-3xl">{g.emoji}</span>
              <div className="flex-1">
                <h2 className="text-base font-semibold group-hover:text-kurly-500">{g.title}</h2>
                <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed">{g.desc}</p>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-neutral-500">
                  <span>⏱ {g.time}</span>
                  <span>·</span>
                  <span>👤 {g.target}</span>
                </div>
              </div>
            </div>
            <div className="mt-5 inline-block rounded-[8px] bg-kurly-500 px-3 py-1.5 text-xs font-medium text-white">
              가이드 보기 →
            </div>
          </Link>
        ))}
      </div>

      {/* 상단 메뉴 구조 안내 — "🤖 AI 테스트" 드롭다운으로 4개가 묶여있음 */}
      <div className="card border-l-4 border-l-kurly-400 p-4">
        <h2 className="text-sm font-semibold text-neutral-800">🧭 상단 메뉴 구조</h2>
        <p className="mt-1 text-xs text-neutral-600 leading-relaxed">
          AI 테스트 흐름은 헤더의 <strong>🤖 AI 테스트</strong> 드롭다운 안에 4단계로 묶여 있어요:
          <strong className="ml-1.5">🔬 QA설계 → 🧬 TC생성 → 📋 기능테스트 → 🔍 애드혹</strong>.
          기능테스트/애드혹은 잡을 만들어 실행하는 단계고, 그 앞 2개는 입력 데이터를 만드는 단계.
        </p>
      </div>

      {/* 가이드 페이지 별도로 안 만들고 본문에 짧게 안내 — 메뉴 위치 + 한 줄 설명 */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold">⚡ 빠른 기능 (별도 가이드 없음 — 메뉴 위치만)</h2>
        <p className="mt-1 text-xs text-neutral-500">아래 기능들은 잡 상세에서 자연스럽게 발견되거나 메뉴 한 번 누르면 끝이라 별도 가이드 안 만들었어요.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {QUICK_FEATURES.map((f) => (
            <Link key={f.href} href={f.href} className="rounded border border-neutral-200 p-3 transition hover:border-kurly-300 hover:bg-kurly-50/30">
              <div className="flex items-start gap-2">
                <span className="text-xl">{f.emoji}</span>
                <div>
                  <div className="text-sm font-medium text-neutral-800">{f.title}</div>
                  <div className="mt-0.5 text-[11px] text-neutral-600 leading-relaxed">{f.desc}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="card p-5 text-sm">
        <h2 className="font-semibold">❓ 어떤 가이드부터 봐야 하나요?</h2>
        <ol className="mt-2 ml-5 list-decimal space-y-1.5 text-neutral-700">
          <li>처음이면 → <Link href="/workers/install" className="text-kurly-500 underline">워커 설치</Link> (한 번만)</li>
          <li>
            <strong className="text-rose-700">★ 어드민으로 잡 만들 거면 반드시</strong> → <Link href="/guide/jira" className="text-kurly-500 underline">Jira + Confluence 토큰 등록</Link> (워커마다 1회)
            <ul className="ml-5 mt-1 list-disc space-y-0.5 text-neutral-600">
              <li>안 하면: Confluence 기획서 본문 못 가져옴 + Jira 이슈가 다른 사람 명의로 등록됨</li>
            </ul>
          </li>
          <li>본인이 할 테스트 종류 선택 (AI 테스트 흐름 4단계 — 헤더 <strong>🤖 AI 테스트</strong> 드롭다운):
            <ul className="ml-5 mt-1 list-disc space-y-0.5 text-neutral-600">
              <li>TC CSV 가 이미 있다 → <Link href="/guide/full-test" className="text-kurly-500 underline">📋 기능 풀 테스트</Link></li>
              <li>기획서 분석부터 → <Link href="/qa-design" className="text-kurly-500 underline">🔬 QA 설계</Link> (리스크/엣지/모호점) → <Link href="/tc-gen" className="text-kurly-500 underline">🧬 TC 생성</Link> → 기능 풀 테스트</li>
              <li>기획서만 있고 TC CSV 바로 만들기 → <Link href="/tc-gen" className="text-kurly-500 underline">🧬 TC 생성</Link></li>
              <li>기획서만 있고 자유 탐색 검증 → <Link href="/guide/adhoc-test" className="text-kurly-500 underline">🔍 애드혹</Link></li>
            </ul>
          </li>
          <li>테스트 전에 사전 데이터(회원/멤버스/VIP/쿠폰/상품/할인/주문·혼합주문/적립금/프로모션) 필요하면 → <Link href="/guide/test-data" className="text-kurly-500 underline">테스트 데이터 생성</Link></li>
          <li>자주 돌리는 잡 세트는 → <Link href="/suites" className="text-kurly-500 underline">📁 스위트</Link> 에 저장 / 결과 비교는 → <Link href="/compare" className="text-kurly-500 underline">📊 결과 비교</Link></li>
        </ol>
      </div>
    </div>
  );
}
