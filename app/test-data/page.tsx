import Link from "next/link";
import { BuProvider, BuTabs, BuGate } from "@/app/_components/bu-domain-select";

export const dynamic = "force-dynamic";

interface Card {
  href: string;
  emoji: string;
  title: string;
  desc: string;
  color: string;
  border: string;
  ready: boolean;
}

interface Group {
  domain: string;
  emoji: string;
  cards: Card[];
}

const GROUPS: Group[] = [
  {
    domain: "회원 (멤버스)",
    emoji: "👤",
    cards: [
      {
        href: "/test-data/account",
        emoji: "👤",
        title: "회원 계정 생성",
        desc: "stg 환경에 테스트 회원 계정을 한 번에 N건 자동 생성. API 직접 호출이라 100건도 30~60초.",
        color: "bg-blue-500 hover:bg-blue-600",
        border: "border-blue-200 bg-blue-50/30",
        ready: true,
      },
      {
        href: "/test-data/membership",
        emoji: "🎫",
        title: "멤버스 강제 구독 / 해지",
        desc: "기존 회원에게 멤버스 구독 또는 해지 처리. 탭 전환. 여러 회원 동시 처리.",
        color: "bg-fuchsia-500 hover:bg-fuchsia-600",
        border: "border-fuchsia-200 bg-fuchsia-50/30",
        ready: true,
      },
      {
        href: "/test-data/membership-ticket",
        emoji: "🎟️",
        title: "멤버스 이용권 등록",
        desc: "기존 회원에게 멤버스 무료이용권 직접 등록 (ticketMetaId + 등록기간). 여러 회원 동시. 강제구독과 다른 엔드포인트.",
        color: "bg-fuchsia-500 hover:bg-fuchsia-600",
        border: "border-fuchsia-200 bg-fuchsia-50/30",
        ready: true,
      },
      {
        href: "/test-data/vip",
        emoji: "👑",
        title: "VIP / VVIP 세팅",
        desc: "회원에게 VIP/VVIP 등급을 DB 직접 적용으로 강제 부여. mk_member_vip UPSERT, 유효기간 지정. 여러 회원 동시.",
        color: "bg-yellow-500 hover:bg-yellow-600",
        border: "border-yellow-200 bg-yellow-50/30",
        ready: true,
      },
      {
        href: "/test-data/membership-cancel-reserve",
        emoji: "🚪",
        title: "멤버스 해지예약 전환",
        desc: "구독 중인 회원을 해지 예약(구독 종료일 해지) 상태로 전환 / 예약 취소. 회원번호만 입력. 여러 회원 동시.",
        color: "bg-fuchsia-500 hover:bg-fuchsia-600",
        border: "border-fuchsia-200 bg-fuchsia-50/30",
        ready: true,
      },
    ],
  },
  {
    domain: "주문",
    emoji: "🛒",
    cards: [
      {
        href: "/test-data/order",
        emoji: "🛒",
        title: "주문 생성",
        desc: "회원번호 + dealProductNo 입력 → 적립금 결제로 N건 주문 자동 생성.",
        color: "bg-rose-500 hover:bg-rose-600",
        border: "border-rose-200 bg-rose-50/30",
        ready: true,
      },
      {
        href: "/test-data/mixed-order",
        emoji: "🧩",
        title: "혼합 주문 (1P+3P 유형 자유)",
        desc: "1P + 3P 유형별(일반택배·컬리배송·설치·미식·퀵 등) 상품을 자동 생성해 한 주문에 묶음. 배송그룹 자동 분리.",
        color: "bg-rose-500 hover:bg-rose-600",
        border: "border-rose-200 bg-rose-50/30",
        ready: true,
      },
      {
        href: "/test-data/delivery-1p",
        emoji: "🚚",
        title: "1P 배송완료 처리",
        desc: "컬리배송(1P·FBK) 주문을 대표주문번호만 입력해 배송완료/배송중으로 전환. Kafka 발행 (DB조회·발송처리 불필요). 여러 건 동시.",
        color: "bg-rose-500 hover:bg-rose-600",
        border: "border-rose-200 bg-rose-50/30",
        ready: true,
      },
      {
        href: "/test-data/review",
        emoji: "⭐",
        title: "상품 후기 작성",
        desc: "배송완료된 주문에 상품 후기 자동 작성. 회원번호만 입력 → 작성 가능 후기 조회 → 일괄 작성. 배송완료 건만 대상.",
        color: "bg-amber-500 hover:bg-amber-600",
        border: "border-amber-200 bg-amber-50/30",
        ready: true,
      },
      {
        href: "/test-data/point",
        emoji: "💰",
        title: "적립금 지급",
        desc: "회원에게 적립금 강제 지급 N건 일괄. 주문 자동화의 적립금 부족 해결용.",
        color: "bg-emerald-500 hover:bg-emerald-600",
        border: "border-emerald-200 bg-emerald-50/30",
        ready: true,
      },
    ],
  },
  {
    domain: "상품",
    emoji: "📦",
    cards: [
      {
        href: "/test-data/product",
        emoji: "📦",
        title: "상품 등록",
        desc: "1P (Kurly 직매입) / 3P (파트너) 테스트 상품 N건 자동 등록 + 승인 + 전시/재고 셋업까지.",
        color: "bg-violet-500 hover:bg-violet-600",
        border: "border-violet-200 bg-violet-50/30",
        ready: true,
      },
      {
        href: "/test-data/discount",
        emoji: "🏷️",
        title: "상품 할인 적용",
        desc: "생성한 딜상품에 정률/정액 할인을 일괄 등록 — 조건수량·기간·센터별. lacms 토큰 필요(쿠폰과 동일).",
        color: "bg-amber-500 hover:bg-amber-600",
        border: "border-amber-200 bg-amber-50/30",
        ready: true,
      },
    ],
  },
  {
    domain: "프로모션",
    emoji: "🎯",
    cards: [
      {
        href: "/test-data/coupon",
        emoji: "🎟️",
        title: "쿠폰 생성 (발행 / 쿠폰팩)",
        desc: "쿠폰 발행 N건 (정률/정액·장바구니/상품/배송비) + 발행 쿠폰들을 묶는 쿠폰팩 생성·발급. lacms 계정.",
        color: "bg-amber-500 hover:bg-amber-600",
        border: "border-amber-200 bg-amber-50/30",
        ready: true,
      },
      {
        href: "/test-data/promotion",
        emoji: "🎯",
        title: "프로모션 확정",
        desc: "이미 등록된 프로모션 코드를 lacms 진입 없이 API로 일괄 확정. 코드별 promotionId 자동 검색 + PUT confirm.",
        color: "bg-cyan-500 hover:bg-cyan-600",
        border: "border-cyan-200 bg-cyan-50/30",
        ready: true,
      },
    ],
  },
  {
    domain: "3P 파트너 API",
    emoji: "🔌",
    cards: [
      {
        href: "/test-data/3p-console",
        emoji: "🔌",
        title: "3P OpenAPI 콘솔",
        desc: "3P 파트너오피스 OpenAPI 56개를 어드민에서 직접 호출(상품·주문·배송·취소·반품·픽업 조회/처리). 토큰은 서버 주입, 조회는 원클릭·변경은 확인 후. Postman 대용.",
        color: "bg-violet-500 hover:bg-violet-600",
        border: "border-violet-200 bg-violet-50/30",
        ready: true,
      },
    ],
  },
];

// 물류 BU — 주문 / 발주 / 컬리로 3개 영역. (현재 UI 골격만, 백엔드 연동 준비 중)
const LOGISTICS_GROUPS: Group[] = [
  {
    domain: "주문",
    emoji: "📦",
    cards: [
      {
        href: "/test-data/logistics/order",
        emoji: "📦",
        title: "물류 주문 생성 (1P / KLS)",
        desc: "1P 컬리몰(로그인→적립금결제→TMS 운송장) 또는 KLS 3PL(이행계획→주문등록→출고번호)을 온도대·센터·권역별로 자동 생성. STG 내부망 필요.",
        color: "bg-sky-500 hover:bg-sky-600",
        border: "border-sky-200 bg-sky-50/30",
        ready: true,
      },
    ],
  },
  {
    domain: "발주",
    emoji: "📋",
    cards: [
      {
        href: "/test-data/logistics/po",
        emoji: "📋",
        title: "발주 생성",
        desc: "Kurly Partner Portal(STG) 발주그룹 등록 → 발주서 생성 → 공급사 발주확정까지 자동. 임직원/공급사 계정 + STG 내부망 필요.",
        color: "bg-teal-500 hover:bg-teal-600",
        border: "border-teal-200 bg-teal-50/30",
        ready: true,
      },
    ],
  },
  {
    domain: "컬리로",
    emoji: "🚛",
    cards: [
      {
        href: "/test-data/logistics/curlyro",
        emoji: "🚛",
        title: "Kurlyro API (작업자)",
        desc: "연속 실행(상용직/아르바이트) + 기본 API·아르바이트·관리·특수건강검진 단건 API. 컬리로 QA 내부망 필요.",
        color: "bg-indigo-500 hover:bg-indigo-600",
        border: "border-indigo-200 bg-indigo-50/30",
        ready: true,
      },
      {
        href: "/test-data/logistics/work-verify",
        emoji: "📊",
        title: "근무관리 검증",
        desc: "근무관리 대시보드 통계 ↔ 리스트 집계 ↔ 필터 조회를 교차 비교해 정합성 검증(데이터 생성 아님). 어드민 로그인 + QA 내부망.",
        color: "bg-indigo-500 hover:bg-indigo-600",
        border: "border-indigo-200 bg-indigo-50/30",
        ready: true,
      },
      {
        href: "/test-data/logistics/work-type-test",
        emoji: "🧪",
        title: "근무유형별 테스트",
        desc: "근무유형 마스터(48종)별 프리셋 계정 생성 + 근무계획 + 출퇴근 일괄. 근무인정 22개만 출퇴근. 어드민 로그인 + QA 내부망.",
        color: "bg-indigo-500 hover:bg-indigo-600",
        border: "border-indigo-200 bg-indigo-50/30",
        ready: true,
      },
      {
        href: "/test-data/logistics/kurlyworks-setup",
        emoji: "⚙️",
        title: "Kurlyworks 작업자 세팅",
        desc: "컬리웍스(근무조·계약서·문서) + 컬리로(근무시간대) 마스터를 브라우저 자동화로 세팅. 🧪 실험적(Playwright, 미검증) · chromium·어드민 계정 필요.",
        color: "bg-amber-500 hover:bg-amber-600",
        border: "border-amber-200 bg-amber-50/30",
        ready: true,
      },
    ],
  },
];

// KPDS/컬리 톤: 흰 카드 + 회색 테두리 + 퍼플 포인트(통일). 카드별 색 구분은 이모지로(color/border 필드는 미사용).
function CardItem({ c }: { c: Card }) {
  const Inner = (
    <>
      <div className="flex items-start gap-3">
        <span className="text-3xl">{c.emoji}</span>
        <div className="flex-1">
          <h3 className={`text-base font-semibold ${c.ready ? "text-neutral-900 group-hover:text-kurly-500" : "text-neutral-400"}`}>{c.title}</h3>
          <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed">{c.desc}</p>
        </div>
      </div>
      <div className={`mt-5 inline-block rounded-[8px] px-3 py-1.5 text-xs font-medium ${c.ready ? "bg-kurly-500 text-white" : "bg-neutral-100 text-neutral-400"}`}>
        {c.ready ? "시작 →" : "준비 중"}
      </div>
    </>
  );
  return c.ready ? (
    <Link href={c.href} className="group card p-6 transition hover:border-kurly-200 hover:shadow-md">{Inner}</Link>
  ) : (
    <div className="card p-6 opacity-70 cursor-not-allowed">{Inner}</div>
  );
}

function GroupSections({ groups }: { groups: Group[] }) {
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.domain} className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-700">
            <span className="text-lg">{g.emoji}</span>
            {g.domain}
            <span className="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">{g.cards.length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {g.cards.map((c) => (
              <CardItem key={c.href + c.title} c={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function TestDataHub() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">🧪 테스트 데이터 생성</h1>
        <p className="mt-2 text-sm text-neutral-600">
          UI 자동화 안 거치고 <strong>API 직접 호출</strong>로 사전 데이터를 빠르게 생성합니다. (UI 대비 30~100배 빠름)
        </p>
      </div>

      <BuProvider>
        <BuTabs />
        <BuGate show="커머스">
          <GroupSections groups={GROUPS} />
        </BuGate>
        <BuGate show="물류">
          <GroupSections groups={LOGISTICS_GROUPS} />
        </BuGate>
      </BuProvider>
    </div>
  );
}
