// POC(Point of Contact) — TC가 실행되는 "시스템/화면"(surface).
// 기능 도메인(회원/주문…)과 직교하는 축. 구글시트의 "시트 분류" 탭과 1:1 대응.
//   id == label == CSV `시트분류` 컬럼 값 (사람이 읽는 그대로 — 필터/그룹 키로도 사용).
//   platform: 실행 엔진 결정 — "app"=Mobile MCP, "web"=Playwright(데스크톱).
// node 의존 없음(클라이언트 컴포넌트에서도 import 가능).

export type Bu = "커머스" | "물류";

export interface PocConfig {
  id: string;                 // CSV 시트분류 값 / 폼 value
  label: string;              // UI 표시 (플랫폼 접미사 제외 — 배지로 별도 표기)
  platform: "web" | "app";    // 실행 플랫폼 (jobs.platform 으로 직결)
  short: string;              // 짧은 칩/배지용
  bu: Bu;                     // 커머스/물류 — 폼 토글에 따라 노출 분기
}

export const POCS: PocConfig[] = [
  // ── 커머스 ──
  { id: "컬리몰(웹)", label: "컬리몰(웹)", platform: "web", short: "몰웹", bu: "커머스" },
  { id: "컬리몰(앱)", label: "컬리몰(앱)", platform: "app", short: "몰앱", bu: "커머스" },
  { id: "La-CMS", label: "La-CMS", platform: "web", short: "CMS", bu: "커머스" },
  { id: "파트너오피스", label: "파트너오피스", platform: "web", short: "오피스", bu: "커머스" },
  { id: "파트너어드민", label: "파트너어드민", platform: "web", short: "어드민", bu: "커머스" },
  // ── 물류 (id = 구글시트 시트분류 값, label = 플랫폼 접미사 뺀 이름) ──
  { id: "WCS (웹)", label: "WCS", platform: "web", short: "WCS", bu: "물류" },
  { id: "분배시스템 (웹)", label: "분배시스템", platform: "web", short: "분배", bu: "물류" },
  { id: "TF-WMS (웹)", label: "TF-WMS", platform: "web", short: "TFWMS", bu: "물류" },
  { id: "WMS (웹)", label: "WMS", platform: "web", short: "WMS", bu: "물류" },
  { id: "QOS (웹)", label: "QOS", platform: "web", short: "QOS", bu: "물류" },
  { id: "피킹Admin (웹)", label: "피킹Admin", platform: "web", short: "피킹A", bu: "물류" },
  { id: "피킹PDA (웹)", label: "피킹PDA", platform: "web", short: "피킹P", bu: "물류" },
  { id: "패킹 (웹)", label: "패킹", platform: "web", short: "패킹", bu: "물류" },
  { id: "OMS (웹)", label: "OMS", platform: "web", short: "OMS", bu: "물류" },
  { id: "컬리로 어드민 (웹)", label: "컬리로 어드민", platform: "web", short: "컬리로A", bu: "물류" },
  { id: "컬리로 모바일 (앱)", label: "컬리로 모바일", platform: "app", short: "컬리로M", bu: "물류" },
  { id: "파트너포털 (웹)", label: "파트너포털", platform: "web", short: "포털", bu: "물류" },
  { id: "RMS WEB (웹)", label: "RMS WEB", platform: "web", short: "RMS-W", bu: "물류" },
  { id: "RMS PDA (웹)", label: "RMS PDA", platform: "web", short: "RMS-P", bu: "물류" },
  { id: "IMS (웹)", label: "IMS", platform: "web", short: "IMS", bu: "물류" },
  { id: "LIP (웹)", label: "LIP", platform: "web", short: "LIP", bu: "물류" },
  { id: "KLS (웹)", label: "KLS", platform: "web", short: "KLS", bu: "물류" },
  { id: "컬리옵스 (웹)", label: "컬리옵스", platform: "web", short: "옵스", bu: "물류" },
  { id: "컬리옵스_IAM (웹)", label: "컬리옵스_IAM", platform: "web", short: "옵스IAM", bu: "물류" },
  { id: "DOS (웹)", label: "DOS", platform: "web", short: "DOS", bu: "물류" },
  { id: "컬리버드 (앱)", label: "컬리버드", platform: "app", short: "버드", bu: "물류" },
  { id: "컬리소터 (앱)", label: "컬리소터", platform: "app", short: "소터", bu: "물류" },
  { id: "컬리간선 (앱)", label: "컬리간선", platform: "app", short: "간선", bu: "물류" },
  { id: "TOMS(어드민) (웹)", label: "TOMS(어드민)", platform: "web", short: "TOMS관", bu: "물류" },
  { id: "TOMS(거래처) (웹)", label: "TOMS(거래처)", platform: "web", short: "TOMS거", bu: "물류" },
];

export const POC_IDS = POCS.map((p) => p.id);

// BU 별 POC 목록 (폼 칩 노출용)
export function pocsForBu(bu: Bu): PocConfig[] {
  return POCS.filter((p) => p.bu === bu);
}

export function getPocById(id: string): PocConfig | null {
  return POCS.find((p) => p.id === id) ?? null;
}

// POC → jobs.platform. 못 찾으면 web 기본.
export function platformForPoc(id: string): "web" | "app" {
  return getPocById(id)?.platform ?? "web";
}

// AI/CSV가 살짝 다르게 쓴 값(공백·괄호·하이픈 변형, 별칭)을 표준 id 로 매핑. 못 찾으면 null.
export function normalizePoc(raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (POC_IDS.includes(v)) return v;
  const squash = (s: string) => s.toLowerCase().replace(/[\s()\-_.]/g, "");
  const t = squash(v);
  const hit = POCS.find((p) => squash(p.id) === t);
  if (hit) return hit.id;
  // 별칭/표기 변형
  if (/lacms|라씨엠에스|라cms/.test(t)) return "La-CMS";
  if (/파트너.*오피스|partneroffice|po$/.test(t)) return "파트너오피스";
  if (/파트너.*(어드민|admin)|partneradmin/.test(t)) return "파트너어드민";
  if (/(컬리몰|kurlymall|mall).*(앱|app)/.test(t) || t === "앱" || t === "app") return "컬리몰(앱)";
  if (/(컬리몰|kurlymall|mall).*(웹|web)/.test(t) || t === "웹" || t === "web") return "컬리몰(웹)";
  return null;
}

// 선택된 POC 목록을 표준화 + 정렬(POCS 정의 순) + 중복 제거. 유효한 것만.
export function sanitizePocs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const x of input) {
    const id = typeof x === "string" ? normalizePoc(x) : null;
    if (id) set.add(id);
  }
  return POC_IDS.filter((id) => set.has(id));
}
