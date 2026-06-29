import Link from "next/link";
import { GuideShell, StepCard, Howto, Code, Preview, Faq, Note, Card } from "../_components";

export const dynamic = "force-dynamic";

export default function PromptsGuide() {
  return (
    <GuideShell
      title="📝 프롬프트 / 날리지 (Drive 동기화) 사용법"
      subtitle="TC 스킬·마스터정책·기능테스트 프롬프트가 팀 공유 Drive에서 어떻게 자동 동기화되는지, 방금 고친 걸 즉시 반영하는 법."
      meta={
        <>
          <strong>⏱ 예상 소요시간:</strong> 3분 (읽기만 하면 됨)
          <br />
          <strong>📍 위치:</strong> 상단 메뉴 <strong>📝 프롬프트</strong> → <Link href="/prompts" className="underline">/prompts</Link>
          <br />
          <strong>🎯 누가 쓰나:</strong> 스킬/정책/프롬프트를 수정·관리하거나, "최신본이 자동화에 반영됐나?"가 궁금한 분
        </>
      }
    >
      <Note variant="info" title="🧭 한 줄 요약">
        이 페이지는 자동화에 쓰이는 <strong>스킬·정책·프롬프트의 정본(팀 공유 Google Drive)을 그대로 비춰주는 "보기 전용" 화면</strong>입니다.
        여기서 파일을 고치는 게 아니라, <strong>Drive에서 고치고 → 어드민이 자동(또는 갱신 버튼)으로 가져옵니다.</strong>
      </Note>

      <StepCard num={1} title="이 페이지가 보여주는 것">
        <p className="text-sm text-neutral-700">
          Drive의 <Code>00. 프로덕트 SQE</Code> 하위 정본 폴더를 그대로 미러링해서 그룹별로 보여줍니다.
        </p>
        <Howto>
          <li><strong>🧪 기능테스트 프롬프트</strong> — 기능 풀 테스트·애드혹이 쓰는 <Code>prompts</Code>/<Code>knowledge</Code> 번들</li>
          <li><strong>🧬 TC 스킬 · 커머스 / 물류</strong> — TC 생성·QA 설계에 적용되는 TC 작성 스킬</li>
          <li><strong>📋 마스터정책 · 커머스 / 물류</strong> — 도메인별 정책 문서</li>
          <li><strong>📄 CLAUDE.md</strong> — 전역 규칙 (맨 위 단독 표시)</li>
        </Howto>
        <Preview label="페이지 구성 (요약)">
{`프롬프트 / 날리지
─────────────────────────────────────────
☁ Drive 동기화   [자동·하루 1회]        [↻ 갱신]
  마지막 갱신: 2026. 6. 19. 오후 4:18 · 누적 118개
─────────────────────────────────────────
🔎 Drive 파일 검색 (전체 113개)
─────────────────────────────────────────
📄 CLAUDE.md (전역 규칙)
▸ 🧪 기능테스트 프롬프트 (28개)        Drive에서 열기 ↗
▸ 🧬 TC 스킬 · 커머스                  Drive에서 열기 ↗
▸ 🧬 TC 스킬 · 물류                    Drive에서 열기 ↗
▸ 📋 마스터정책 · 커머스               Drive에서 열기 ↗
▸ 📋 마스터정책 · 물류                 Drive에서 열기 ↗`}
        </Preview>
      </StepCard>

      <StepCard num={2} title="이게 어디에 쓰이나요?">
        <p className="text-sm text-neutral-700">
          여기 있는 파일들은 잡을 만들 때 <strong>프롬프트에 자동으로 주입</strong>됩니다. 즉 이 정본이 좋아지면 자동화 품질이 그대로 올라갑니다.
        </p>
        <Howto>
          <li><Link href="/tc-gen" className="text-kurly-500 underline">🧬 TC 생성</Link> / <Link href="/qa-design" className="text-kurly-500 underline">🔬 QA 설계</Link> → 선택한 BU(커머스/물류)·도메인의 <strong>마스터정책 + TC 스킬</strong> 적용</li>
          <li><Link href="/upload" className="text-kurly-500 underline">📋 기능 풀 테스트</Link> / <Link href="/adhoc" className="text-kurly-500 underline">🔍 애드혹</Link> → <strong>기능테스트 프롬프트·날리지</strong> 적용</li>
        </Howto>
        <Note variant="success" title="✅ 모든 워커에 자동 반영">
          정본은 어드민(서버) 한 곳이 들고 있다가 잡마다 주입하므로, 워커가 따로 파일을 받을 필요가 없습니다. 정본만 고치면 모든 워커가 같은 최신본으로 돕니다.
        </Note>
      </StepCard>

      <StepCard num={3} title="자동 동기화는 언제 도나요?">
        <p className="text-sm text-neutral-700">
          정해진 시각(자정 등)에 도는 스케줄러가 <strong>아닙니다.</strong> 작업을 시작하는 순간 따라 도는 방식이에요.
        </p>
        <Howto>
          <li><strong>트리거</strong>: QA설계 / TC생성 / 기능 풀 테스트 / 애드혹 잡을 <strong>시작하는 그 순간</strong> 한 번 동기화 시도</li>
          <li><strong>쿨다운</strong>: 마지막 동기화로부터 <strong>24시간</strong> 안이면 스킵하고 로컬 사용. (자정 리셋이 아니라 <strong>굴러가는 24시간</strong>)</li>
          <li><strong>스코프별로 따로</strong>: TC생성/설계는 <strong>도메인별</strong>, 기능테스트는 별도 타이머. (예: '회원멤버스' 갱신해도 '상품'은 그날 처음 쓸 때 또 동기화)</li>
          <li><strong>어드민 재시작 시</strong>: 타이머가 리셋돼 첫 잡에서 24h 전이라도 새로 동기화</li>
          <li>아무도 작업을 안 하면 → 자동 동기화도 안 일어남</li>
        </Howto>
        <Note variant="warn" title="❗ '로컬'은 워커 PC가 아니라 어드민입니다">
          여기서 말하는 <strong>"로컬"은 어드민(이 도구가 떠 있는 머신 — 지금은 담당자 맥, 추후 서버) 한 곳</strong>이에요.
          Drive에서 받는 주체는 <strong>어드민 하나</strong>이고(각 워커가 Drive에 붙어 받는 게 아님),
          어드민이 받아둔 내용을 <strong>잡마다 프롬프트에 실어 워커에게 보냅니다.</strong>
          → "24h 안엔 로컬 사용" = 어드민이 자기 사본을 다시 안 받고 그대로 쓴다는 뜻.
        </Note>
        <Note variant="info" title="🕘 마지막 반영 시각 확인">
          Drive 동기화 카드의 <strong>"마지막 갱신: …"</strong> + <strong>"누적 N개"</strong>가 어드민이 실제로 파일을 가져온 마지막 시각/개수입니다.
        </Note>
      </StepCard>

      <StepCard num={4} title="방금 Drive를 고쳤어요 → 즉시 반영하기 (갱신 버튼)">
        <p className="text-sm text-neutral-700">
          오른쪽 위 <strong>↻ 갱신</strong> 버튼은 <strong>24시간 쿨다운을 무시</strong>하고 즉시 전체 동기화 + 목록 새로고침을 합니다.
        </p>
        <Howto>
          <li><strong>언제 누르나</strong>: Drive에서 스킬/정책/프롬프트를 방금 고쳤고, <strong>지금 바로</strong> 그 변경분으로 잡을 돌리고 싶을 때</li>
          <li><strong>안 누르면</strong>: 24h 쿨다운 때문에 다음 잡이 <strong>옛 버전(로컬)</strong>으로 돌 수 있음</li>
        </Howto>
        <Note variant="warn" title="순서 주의">
          Drive에서 <strong>저장 먼저</strong> → 그다음 어드민에서 <strong>갱신</strong> → 그다음 잡 시작. 갱신을 먼저 누르면 아직 고치기 전 버전을 받습니다.
        </Note>
      </StepCard>

      <StepCard num={5} title="검색 · Drive에서 열기 · 파일 수정은 어디서?">
        <Howto>
          <li><strong>🔎 Drive 파일 검색</strong>: 파일명으로 바로 필터</li>
          <li><strong>Drive에서 열기 ↗</strong>: 각 그룹의 실제 Drive 폴더로 이동 (원본 보기/수정용)</li>
          <li>
            <strong>수정은 어드민이 아니라 Drive에서</strong> — 이 페이지는 보기 전용 미러라 여기서 편집할 수 없습니다.
            정본 파일을 Drive에서 고친 뒤 <strong>갱신</strong>하면 반영됩니다.
          </li>
        </Howto>
      </StepCard>

      <Card>
        <h2 className="text-base font-semibold">🛡️ 동기화가 안전하게 처리하는 것들</h2>
        <ul className="mt-2 ml-5 list-disc text-sm text-neutral-700 space-y-1">
          <li><strong>변경분만</strong> 받음 (수정시각 비교) — 매번 전체를 다시 받지 않아 빠름</li>
          <li>덮어쓰기 전 <Code>_drive-backup</Code>에 <strong>자동 백업</strong></li>
          <li><strong>Drive → 로컬 단방향(read-only)</strong> — 어드민이 Drive 정본을 절대 덮어쓰지 않음</li>
          <li>Drive가 느리거나 안 되면 <strong>20초 후 로컬 그대로 사용</strong> (잡을 막지 않음)</li>
          <li>로컬에만 있는 파일은 <strong>안 지움</strong> — 미러 정리는 Drive 관리 폴더 한정이고, 동기화 실패가 1건이라도 있으면 정리 자체를 건너뜀</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">❓ 자주 묻는 질문</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Faq q="Drive에서 방금 고쳤는데 자동화에 반영이 안 돼요">
            24시간 쿨다운 때문입니다. 오른쪽 위 <strong>↻ 갱신</strong>을 누른 뒤 잡을 다시 시작하세요. (Drive 저장 → 갱신 → 잡 시작 순서)
          </Faq>
          <Faq q="자동으로 정확히 언제 도나요?">
            고정 시각은 없어요. <strong>QA설계/TC생성/기능테스트/애드혹 잡을 시작할 때</strong> + 그 스코프가 <strong>마지막 동기화 후 24시간</strong>이 지났을 때만 돕니다. 아무도 작업을 안 하면 안 돕니다. (Step 3)
          </Faq>
          <Faq q="내가 로컬에만 둔 파일이 동기화로 사라지나요?">
            아니요. Drive 관리 폴더에서 Drive에 없는 잔존 파일만 <Code>_drive-backup</Code>으로 옮기고(하드 삭제 아님), 그것도 동기화에 실패가 있으면 건너뜁니다. 그 외 로컬 전용 파일은 보존됩니다.
          </Faq>
          <Faq q="커머스랑 물류가 따로 보여요">
            BU별로 정본이 분리돼 있어서예요. TC생성/QA설계에서 BU(커머스/물류)와 도메인을 고르면 해당 스킬·정책만 적용됩니다.
          </Faq>
          <Faq q="여기서 파일을 직접 못 고치겠어요">
            맞습니다 — 이 페이지는 <strong>보기 전용</strong>이에요. 정본은 Drive에 있으니 <strong>Drive에서 열기 ↗</strong>로 가서 고치고, 어드민에서 <strong>갱신</strong>하면 됩니다.
          </Faq>
          <Faq q=".skill 파일이나 Google 문서도 되나요?">
            네. <Code>.skill</Code>(ZIP 번들)은 안의 <Code>SKILL.md</Code>를 자동 추출해 저장하고, Google 문서/시트/슬라이드는 각각 <Code>.md</Code>/<Code>.csv</Code>/<Code>.txt</Code>로 변환해서 가져옵니다.
          </Faq>
          <Faq q="동기화를 잠시 끄고 싶어요 (운영자용)">
            어드민 실행 환경변수 <Code>KURLY_DRIVE_AUTOSYNC=0</Code>으로 자동 동기화를 끌 수 있습니다. 이때는 갱신 버튼으로만 수동 동기화됩니다.
          </Faq>
        </div>
      </Card>

      <Card>
        <p className="text-xs text-neutral-500">
          → <Link href="/guide" className="text-kurly-500 underline">가이드 목록</Link>으로 돌아가기 · 페이지 바로가기 <Link href="/prompts" className="text-kurly-500 underline">/prompts</Link>
        </p>
      </Card>
    </GuideShell>
  );
}
