import Link from "next/link";

export const dynamic = "force-dynamic";

const VARIANTS = [
  {
    href: "/test-data/product/3p",
    emoji: "🤝",
    title: "3P 상품 (파트너)",
    desc: "third-party-external-api → 상품 등록 → 어드민 승인 → La-CMS 전시/재고. 12단계 자동 체인.",
    color: "bg-violet-500 hover:bg-violet-600",
    border: "border-violet-200 bg-violet-50/30",
    ready: true,
    time: "1건당 15~20초",
  },
  {
    href: "/test-data/product/1p",
    emoji: "🏬",
    title: "1P 상품 (Kurly 직매입)",
    desc: "PMS 마스터 → 콘텐츠 → 재고 세팅. lacms 이메일/패스워드만 입력하면 끝.",
    color: "bg-emerald-500 hover:bg-emerald-600",
    border: "border-emerald-200 bg-emerald-50/30",
    ready: true,
    time: "1건당 2~3초",
  },
];

export default function ProductHub() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📦 테스트 상품 등록</h1>
        <p className="mt-2 text-sm text-neutral-600">
          stg 환경에 테스트용 상품 N건 자동 등록. 1P / 3P 가 별도 API 흐름 — 아래에서 선택.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {VARIANTS.map((v) => {
          const Inner = (
            <>
              <div className="flex items-start gap-3">
                <span className="text-3xl">{v.emoji}</span>
                <div className="flex-1">
                  <h2 className={`text-base font-semibold ${v.ready ? "group-hover:text-kurly-500" : "text-neutral-500"}`}>{v.title}</h2>
                  <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed">{v.desc}</p>
                  <div className="mt-2 text-[11px] text-neutral-500">⏱ {v.time}</div>
                </div>
              </div>
              <div className={`mt-5 inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white ${v.color}`}>
                {v.ready ? "시작 →" : "준비 중"}
              </div>
            </>
          );
          return v.ready
            ? <Link key={v.href + v.title} href={v.href} className={`group card border-2 p-6 transition hover:shadow-md ${v.border}`}>{Inner}</Link>
            : <div key={v.href + v.title} className={`card border-2 p-6 ${v.border} cursor-not-allowed`}>{Inner}</div>;
        })}
      </div>

      <div className="card p-4 text-xs text-neutral-500">
        <Link href="/test-data" className="text-kurly-500 underline">← 테스트 데이터 메뉴</Link>
      </div>
    </div>
  );
}
