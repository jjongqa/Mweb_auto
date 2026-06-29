/**
 * Kurly QA 도메인 정의 (단일 진실의 원천)
 *
 * 각 도메인마다:
 * - id: 코드/DB에서 사용 (영문)
 * - label: UI 표시 (한글)
 * - hasBasePrompt: 도메인 전용 베이스 프롬프트(.md) 보유 여부
 *   - true 면 prompts/base-prompt-{label}.md (또는 -app.md) 사용
 *   - false 면 fallback (공통 base-prompt-Web.md / -app.md 만 사용)
 * - knowledgeFolder: knowledge/ 하위 폴더명 (없으면 자동 생성될 수 있음)
 */

export type BusinessUnit = "커머스" | "물류";

export interface DomainConfig {
  id: string;
  label: string;
  hasBasePrompt: boolean;
  knowledgeFolder: string;
  // TC 생성용 — QA-Cowork/{tc-skills,policies}/{tcFolder}. 그룹 폴더라 여러 도메인이 공유.
  tcFolder: string;
  // 비즈니스 유닛 (UI optgroup 그룹핑 + 물류 키워드 매칭 분기)
  bu: BusinessUnit;
  // 물류 전용 — 스킬: _logistics 밑에서 이 키워드가 "포함된" 번들 폴더를 읽음(스킬은 여러 도메인 묶음).
  match?: string[];
  // 물류 전용 — 정책: _logistics 밑에서 이 폴더명과 "정확히" 일치하는 폴더만 읽음(정책은 1:1).
  //   정확매칭이라 '배송'이 '배송대행'을 잘못 잡지 않음. 값=동기화 후 정규화된 폴더명.
  policyFolders?: string[];
}

export const DOMAINS: DomainConfig[] = [
  // ===== 커머스 (폴더명 정확매칭) =====
  { id: "회원", label: "회원", hasBasePrompt: true, knowledgeFolder: "회원", tcFolder: "회원멤버스", bu: "커머스" },
  { id: "멤버스", label: "멤버스", hasBasePrompt: true, knowledgeFolder: "멤버스", tcFolder: "회원멤버스", bu: "커머스" },
  { id: "3P", label: "3P", hasBasePrompt: true, knowledgeFolder: "3P", tcFolder: "3P", bu: "커머스" },
  { id: "상품", label: "상품", hasBasePrompt: false, knowledgeFolder: "상품", tcFolder: "상품", bu: "커머스" },
  { id: "홈전시추천", label: "홈/전시/추천", hasBasePrompt: false, knowledgeFolder: "홈전시추천", tcFolder: "홈전시추천", bu: "커머스" },
  { id: "검색광고", label: "검색/광고", hasBasePrompt: false, knowledgeFolder: "검색광고", tcFolder: "검색광고", bu: "커머스" },
  { id: "주문", label: "주문", hasBasePrompt: false, knowledgeFolder: "주문", tcFolder: "주문결제클레임", bu: "커머스" },
  { id: "결제", label: "결제", hasBasePrompt: false, knowledgeFolder: "결제", tcFolder: "주문결제클레임", bu: "커머스" },
  { id: "클레임", label: "클레임", hasBasePrompt: false, knowledgeFolder: "클레임", tcFolder: "주문결제클레임", bu: "커머스" },
  { id: "프로모션", label: "프로모션", hasBasePrompt: false, knowledgeFolder: "프로모션", tcFolder: "프로모션", bu: "커머스" },
  // ===== 물류 (확정 17개. 스킬=번들 부분일치(match), 정책=1:1 정확매칭(policyFolders). 순서=마스터정책 01~17) =====
  { id: "물류발주프로모션", label: "발주/프로모션", hasBasePrompt: false, knowledgeFolder: "물류발주프로모션", tcFolder: "_logistics/발주프로모션", bu: "물류", match: ["발주"], policyFolders: ["발주프로모션"] },
  { id: "물류정산화주사", label: "정산/화주사", hasBasePrompt: false, knowledgeFolder: "물류정산화주사", tcFolder: "_logistics/정산화주사", bu: "물류", match: ["정산"], policyFolders: ["정산화주사"] },
  { id: "물류입고", label: "입고", hasBasePrompt: false, knowledgeFolder: "물류입고", tcFolder: "_logistics/입고", bu: "물류", match: ["입고"], policyFolders: ["입고"] },
  { id: "물류상품", label: "상품", hasBasePrompt: false, knowledgeFolder: "물류상품", tcFolder: "_logistics/상품", bu: "물류", match: ["상품"], policyFolders: ["상품"] },
  { id: "물류재고", label: "재고", hasBasePrompt: false, knowledgeFolder: "물류재고", tcFolder: "_logistics/재고", bu: "물류", match: ["재고"], policyFolders: ["재고"] },
  { id: "물류센터관리", label: "센터관리", hasBasePrompt: false, knowledgeFolder: "물류센터관리", tcFolder: "_logistics/센터관리", bu: "물류", match: ["센터관리"], policyFolders: ["센터관리"] },
  { id: "물류출고관리", label: "출고관리", hasBasePrompt: false, knowledgeFolder: "물류출고관리", tcFolder: "_logistics/출고관리", bu: "물류", match: ["출고"], policyFolders: ["출고관리"] },
  { id: "물류피킹", label: "피킹", hasBasePrompt: false, knowledgeFolder: "물류피킹", tcFolder: "_logistics/피킹", bu: "물류", match: ["피킹"], policyFolders: ["피킹"] },
  { id: "물류패킹", label: "패킹", hasBasePrompt: false, knowledgeFolder: "물류패킹", tcFolder: "_logistics/패킹", bu: "물류", match: ["패킹"], policyFolders: ["패킹"] },
  { id: "물류주문이행", label: "주문이행", hasBasePrompt: false, knowledgeFolder: "물류주문이행", tcFolder: "_logistics/주문이행", bu: "물류", match: ["주문이행"], policyFolders: ["주문이행"] },
  { id: "물류컬리로", label: "컬리로", hasBasePrompt: false, knowledgeFolder: "물류컬리로", tcFolder: "_logistics/컬리로", bu: "물류", match: ["컬리로"], policyFolders: ["컬리로"] },
  { id: "물류배송", label: "배송", hasBasePrompt: false, knowledgeFolder: "물류배송", tcFolder: "_logistics/배송", bu: "물류", match: ["배송"], policyFolders: ["배송"] },
  { id: "물류권역", label: "권역", hasBasePrompt: false, knowledgeFolder: "물류권역", tcFolder: "_logistics/권역", bu: "물류", match: ["권역"], policyFolders: ["권역"] },
  { id: "물류관제", label: "관제", hasBasePrompt: false, knowledgeFolder: "물류관제", tcFolder: "_logistics/관제", bu: "물류", match: ["관제"], policyFolders: ["관제"] },
  { id: "물류자원", label: "자원", hasBasePrompt: false, knowledgeFolder: "물류자원", tcFolder: "_logistics/자원", bu: "물류", match: ["자원"], policyFolders: ["자원"] },
  { id: "물류간선", label: "간선", hasBasePrompt: false, knowledgeFolder: "물류간선", tcFolder: "_logistics/간선", bu: "물류", match: ["간선"], policyFolders: ["간선"] },
  { id: "물류배송대행", label: "배송대행", hasBasePrompt: false, knowledgeFolder: "물류배송대행", tcFolder: "_logistics/배송대행", bu: "물류", match: ["배송대행"], policyFolders: ["배송대행"] },
];

export const DOMAIN_IDS = DOMAINS.map((d) => d.id);

export function getDomainById(id: string): DomainConfig | null {
  return DOMAINS.find((d) => d.id === id) ?? null;
}

/**
 * 도메인의 knowledge 폴더 경로 (화이트리스트용).
 */
export function getDomainKnowledgeFolders(): string[] {
  return DOMAINS.map((d) => `knowledge/${d.knowledgeFolder}`);
}
