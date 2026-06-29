import Link from "next/link";
import { GuideShell, StepCard, Howto, Code, Preview, Faq, Note, Card } from "../_components";

export const dynamic = "force-dynamic";

export default function JiraGuide() {
  return (
    <GuideShell
      title="🪲 Jira 자동 등록 + Confluence 자동 추출 사용법"
      subtitle="워커별로 본인 Atlassian 토큰을 등록하면 — Confluence 기획서 본문 자동 추출 + FAIL 건 Jira 이슈 자동 등록(reporter=본인) 한 번에 처리."
      meta={
        <>
          <strong>⏱ 예상 소요시간:</strong> 최초 5분 (토큰 발급+등록) · 테스트당 30초 (체크해서 등록)
          <br />
          <strong>📦 필요한 것:</strong> Atlassian 계정 + API 토큰 + 등록할 에픽 키 (예: <Code>KQA-1234</Code>)
          <br />
          <strong>🎯 누가 쓰나:</strong> 어드민으로 잡 만드는 모든 워커 — 본인 토큰 등록 안 하면 다른 사람 명의로 이슈 등록됨
        </>
      }
    >
      <Note variant="warn" title="⚠️ 워커마다 본인 토큰 1회 등록 필수">
        한 어드민 DB 에 여러 워커 토큰을 같이 저장합니다. 잡 만들 때 <Code>실행자</Code> 입력값이 등록한 이름과 매칭되면 그 사람의 토큰으로 동작.
        매칭 안 되면 <strong>default 토큰(다른 사람)</strong> 으로 동작 → Confluence 본문이 안 가져와지거나, Jira 이슈 reporter 가 본인 아닌 다른 사람으로 박힘.
      </Note>

      <Note variant="info" title="🧭 전체 흐름 한눈에">
        ① Atlassian 토큰 발급 → ② <Code>/jira-settings</Code> 에 본인 행 등록 (자동 claim) → ③ 새 테스트 만들 때 <Code>실행자</Code> 에 등록 이름 입력 →
        ④ Confluence URL 넣으면 본인 권한으로 본문 자동 추출 → ⑤ 테스트 완료 후 FAIL 검토 → ⑥ 체크박스로 진짜 버그만 선택 → ⑦ "🚀 Jira 등록" → ⑧ <strong>reporter=본인</strong> 으로 에픽 하위에 Bug 생성.
      </Note>

      {/* ============================== */}
      <StepCard num={1} title="Atlassian API 토큰 발급 (워커마다 본인 계정으로 1회)">
        <p className="text-sm text-neutral-700">
          본인 Atlassian 계정에서 토큰을 발급. 비밀번호 대용으로 쓰는 키.
        </p>
        <Howto>
          <li>
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
              className="text-kurly-500 underline"
            >
              id.atlassian.com/manage-profile/security/api-tokens
            </a>{" "}
            접속
          </li>
          <li><strong>Create API token</strong> 클릭 → 라벨 입력 (예: <Code>kurly-qa-admin</Code>)</li>
          <li>만료일 선택 — <strong>최대 1년</strong> 권장 (Atlassian 정책상 만료일 필수)</li>
          <li>Create → 토큰 문자열 복사 (이 화면 닫으면 다시 못 봐요! 메모장에 잠깐)</li>
        </Howto>
        <Note variant="warn" title="⚠️ 토큰 보안">
          API 토큰은 비밀번호와 같습니다. 슬랙/이메일에 노출 금지. 어드민 DB 에는 <strong>AES-256-GCM 암호화</strong> 저장 (키: <Code>~/.config/kurly-qa/master.key</Code>, 0600 권한, 사내망 한정).
        </Note>
      </StepCard>

      {/* ============================== */}
      <StepCard num={2} title="어드민에 본인 행 등록 → 자동 claim">
        <p className="text-sm text-neutral-700">
          상단 메뉴 <strong>🪲 Jira</strong> → <Link href="/jira-settings" className="text-kurly-500 underline">/jira-settings</Link> 이동.
        </p>
        <Howto>
          <li>하단 <strong>"+ 새 워커 토큰 등록"</strong> 폼에 입력</li>
          <li><strong>이름 (워커 식별자)</strong> ★ 중요 ★ → 잡 만들 때 <Code>실행자</Code> 입력값과 동일해야 매칭됨 (예: <Code>다나</Code>, <Code>박상현</Code>, <Code>안종관</Code>)</li>
          <li><strong>Host</strong>: <Code>kurly0521.atlassian.net</Code> (기본값 그대로)</li>
          <li><strong>이메일</strong>: 본인 회사 이메일</li>
          <li><strong>API 토큰</strong>: Step 1 에서 복사한 문자열</li>
          <li><strong>기본 프로젝트 키</strong>: <Code>KQA</Code></li>
          <li>[🔗 연결 테스트] → "✓ 연결 성공" 확인</li>
          <li>[등록] → <strong>본인 행 자동 claim</strong> + 리스트에 <Code>내 토큰</Code> 배지 표시</li>
        </Howto>
        <Preview label="/jira-settings 화면 예시 (다중 워커 등록 상태)">
{`등록된 워커 (3명)

  이름           이메일                          토큰              마지막사용   관리
  ─────────────  ──────────────────────────────  ────────────────  ──────────  ──────────────
  안종관 [내토큰] jongkwan.ahn@kurlycorp.com      ATATT3••••9DB6    2026-06-12   [수정] [해제] [삭제]
  다나 [주인있음] dana@kurlycorp.com              ATATT3••••2F1A    2026-06-12   [수정] [삭제]
  박상현 [주인있음] sanghyun@kurlycorp.com        ATATT3••••B7C3    미사용       [수정] [삭제]

  + 새 워커 토큰 등록
  이름: [다나                                 ]    Host: [kurly0521.atlassian.net]
  이메일: [dana@kurlycorp.com                  ]    API 토큰: [ATATT...     ]
  ...
  [🔗 연결 테스트]   [등록]`}
        </Preview>
        <Note variant="info" title="🏷️ 배지의 의미">
          <ul className="ml-4 list-disc">
            <li><Code>내 토큰</Code> (초록): 본인이 claim한 행. 본인 브라우저 localStorage 에 마킹.</li>
            <li><Code>주인 있음</Code> (회색): 다른 워커가 이미 claim. 본인 화면에서 [내 토큰] 버튼 안 보임.</li>
            <li><strong>해제</strong> 버튼: 본인 claim 해제 (글로벌) → 다른 사람이 다시 잡을 수 있게.</li>
          </ul>
        </Note>
      </StepCard>

      {/* ============================== */}
      <StepCard num={3} title="새 테스트 만들 때 실행자 + 에픽 키 입력">
        <p className="text-sm text-neutral-700">
          <Link href="/upload" className="text-kurly-500 underline">/upload</Link> 또는 <Link href="/adhoc" className="text-kurly-500 underline">/adhoc</Link> 에서 새 테스트 생성.
        </p>
        <Howto>
          <li><strong>실행자 *</strong> (필수) → Step 2 에서 등록한 이름과 정확히 동일하게 (예: <Code>다나</Code>)</li>
          <li><strong>Jira 에픽 키</strong> (선택) → <Code>KQA-1234</Code> 형식. FAIL 이슈가 이 에픽 하위로 자동 연결됨</li>
          <li>Confluence URL 을 기획 문서에 넣으면 → 어드민이 본인 토큰으로 본문 자동 추출 (5219자 등 실제 본문이 spec_text 에 저장됨)</li>
        </Howto>
        <Preview label="실행자 매칭 규칙">
{`실행자 입력값           매칭되는 토큰
────────────────────  ────────────────────────────
"다나"                  ✅ 다나 토큰 (정확 일치)
"다 나"                 ✅ 다나 토큰 (공백 무시 부분 일치)
"sanghyun"              ⚠️ 매칭 실패 → default 토큰
""                      ❌ 잡 생성 자체 실패 (실행자 필수)`}
        </Preview>
        <Note variant="warn" title="⚠️ 실행자 미입력 / 매칭 실패 시">
          잡 생성 단계에서 빈 값은 막힙니다. 등록된 이름과 다른 값을 넣으면 default 토큰(다른 사람)으로 fetch + reporter 도 그 사람으로 박힙니다.
        </Note>
      </StepCard>

      {/* ============================== */}
      <StepCard num={4} title="Confluence 본문 자동 추출 확인 (Step 2 등록 후 자동)">
        <p className="text-sm text-neutral-700">
          기획 문서에 Confluence URL (<Code>*.atlassian.net/wiki/...</Code>) 넣으면 어드민이 인증된 REST API 로 본문 추출. 토큰 없으면 로그인 페이지 HTML 이 spec_text 로 들어가 Claude 가 헛다리.
        </p>
        <Preview label="잡 상세 페이지에서 spec_text 길이로 확인">
{`잡 만들기 전:
  ❌ spec_text = 358자 ("Log in with Atlassian account...")
  → Claude 가 기획서를 못 보고 추측만으로 테스트

잡 만들기 후 (토큰 등록됨):
  ✅ spec_text = 5219자 ("# [26.04] 자주산 상품 진입 소구점 개선\\n배경\\n장바구니 내 '자주 산 상품'...")
  → Claude 가 본문 다 읽고 시나리오 10개 도출 → TC-1 ~ TC-10 실행`}
        </Preview>
        <Note variant="info" title="💡 본문 fetch 실패 시 표시">
          spec_text 가 <Code># ⚠️ Confluence 본문 추출 실패</Code> 로 시작하면 토큰 만료 또는 권한 문제. 잡 상세 페이지에서 바로 확인 가능.
        </Note>
      </StepCard>

      {/* ============================== */}
      <StepCard num={5} title="테스트 실행 후 결과 검토">
        <p className="text-sm text-neutral-700">
          테스트가 끝나면 <Code>/jobs/&#123;id&#125;</Code> 상세 페이지에서 결과 확인. 화면 하단에 <strong>🪲 Jira 이슈 등록</strong> 카드가 자동으로 뜹니다 (FAIL 이 있을 때).
        </p>
        <Howto>
          <li>FAIL 항목은 <Code>fail-detail.csv</Code> 에서 자동 추출 (No / Priority / Title / Step / Expected / Actual / Fail Reason / Screenshot)</li>
          <li>실패 원인을 사람이 한 번 봐야 함 — 진짜 버그인지, 환경 이슈인지, AI 오판인지 판단</li>
          <li>스크린샷도 같이 확인 권장</li>
        </Howto>
        <Note variant="warn" title="⚠️ 무조건 다 등록하지 말기">
          AI 가 FAIL 로 본 것 중 일부는 환경/데이터 문제일 수 있어요. <strong>사람이 검토하고 진짜 버그만 선택</strong>하는 게 이 기능의 핵심.
        </Note>
      </StepCard>

      {/* ============================== */}
      <StepCard num={6} title="체크박스로 진짜 버그만 선택 → 등록">
        <p className="text-sm text-neutral-700">
          <strong>"+ Jira 등록 (N건 미등록)"</strong> 버튼 클릭하면 FAIL 목록 펼쳐짐. 등록할 항목만 체크박스로 선택.
        </p>
        <Howto>
          <li><strong>전체 선택</strong> 또는 개별 체크</li>
          <li>이미 등록한 항목은 목록에서 자동 제외 (중복 방지)</li>
          <li><strong>"🚀 선택 N건 Jira 등록"</strong> 클릭 → 잡의 <Code>requested_by</Code> 로 토큰 매칭 → 본인 명의 등록</li>
          <li>응답에 <Code>used_settings</Code> 정보 포함 (어떤 토큰으로 등록됐는지 확인 가능)</li>
        </Howto>
        <Preview label="Jira 이슈 패널 화면 예시">
{`🪲 Jira 이슈 등록  (FAIL 5건 · 등록 0건)        [+ Jira 등록 (5건 미등록)]

  ☑ 전체 선택 (3/5)                              [🚀 선택 3건 Jira 등록]

  ┌──┬─────┬──────────┬──────────────────┬──────────────────┬───────────┐
  │☑│ No  │ Priority │ 제목              │ Fail Reason      │ Screenshot│
  ├──┼─────┼──────────┼──────────────────┼──────────────────┼───────────┤
  │☑│ 7   │ P1→Highest│ 로그인 후 홈 이동 │ 메인이 안 뜸     │ 7.png    │
  │☑│ 12  │ P2→Medium │ 무료배송 배지 노출│ 배지 미표시      │ 12.png   │
  │☐│ 18  │ P3→Low    │ 푸터 링크 확인    │ (환경문제 — 제외)│ -        │
  │☑│ 21  │ P1→Highest│ 결제 진입         │ 500 에러         │ 21.png   │
  └──┴─────┴──────────┴──────────────────┴──────────────────┴───────────┘

  에픽 KQA-1234 자식으로 자동 연결됩니다.
  reporter = 다나 (잡 실행자 = "다나" 매칭됨)`}
        </Preview>
      </StepCard>

      {/* ============================== */}
      <StepCard num={7} title="등록 결과 확인">
        <p className="text-sm text-neutral-700">
          등록 완료되면 같은 카드 하단에 <strong>"등록된 이슈" 목록</strong>이 나타납니다. 이슈 키 클릭 → 새 탭으로 Jira 이슈 페이지.
        </p>
        <Howto>
          <li>등록된 이슈는 DB 에도 기록 → 새로고침해도 유지</li>
          <li>같은 테스트에서 추가로 등록할 수 있음 (남은 FAIL 만 표시)</li>
          <li>각 이슈는 <Code>parent: KQA-1234</Code> 로 에픽에 자동 연결, <Code>reporter</Code> 는 토큰 소유자(=실행자) 본인</li>
        </Howto>
        <Preview label="등록된 이슈 목록 예시">
{`등록된 이슈 (3) — reporter: 다나

  TC-7    [KQA-5678]  [AI-Test FAIL] TC-7: 로그인 후 홈 이동       2026-06-09 14:22
  TC-12   [KQA-5679]  [AI-Test FAIL] TC-12: 무료배송 배지 노출    2026-06-09 14:22
  TC-21   [KQA-5680]  [AI-Test FAIL] TC-21: 결제 진입             2026-06-09 14:22`}
        </Preview>
      </StepCard>

      {/* ============================== */}
      <Card>
        <h2 className="text-base font-semibold">📋 자동 등록되는 이슈 형식</h2>
        <p className="mt-2 text-sm text-neutral-700">각 FAIL 케이스마다 아래 형식으로 Jira Bug 이슈가 생성됩니다.</p>
        <Preview label="Jira 이슈 생성 사양">
{`Site:        kurly0521.atlassian.net
Project:     KQA
Issue Type:  Bug
Parent Epic: (테스트 생성 시 입력한 키, 예: KQA-1234)
Reporter:    토큰 소유자 (=실행자와 매칭된 jira_settings 행의 사용자)

Summary:     [AI-Test FAIL] TC-{No}: {TC Title}

Description:
  ## TC 정보
  - TC No:    {No}
  - Priority: {P1/P2/P3}
  - TC Title: {Title}

  ## Test Step
  {Step}

  ## Expected Result
  {Expected}

  ## Actual Result
  {Actual}

  ## Fail Reason
  {Fail Reason}

  ## 스크린샷
  첨부 참고: {파일명}

  ---
  ## 테스트 정보
  - 테스트 ID:    {job_id}
  - 도메인:   {domain} / 환경: {qa_env}
  - 과제명:   {task_name}
  - 실행자:   {requested_by}
  - 에픽:     {epic_key}

Priority:    P1 → Highest / P2 → Medium / P3 → Low
Labels:      ai-test, confirmed-bug`}
        </Preview>
      </Card>

      {/* ============================== */}
      <Card>
        <h2 className="text-base font-semibold">💡 운영 팁</h2>
        <ul className="mt-2 ml-5 list-disc text-sm text-neutral-700 space-y-1">
          <li><strong>"이름" 필드 신중하게</strong>: Step 2 의 "이름" 이 곧 매칭 키. 한 번 정한 이름을 잡 만들 때 "실행자" 에 일관되게 사용. 한국어/공백 OK.</li>
          <li><strong>토큰 발급 주기 1년</strong>: Atlassian 정책상 토큰 만료일 필수. 만료 전에 재발급 → /jira-settings 본인 행 [수정] → 새 토큰 붙여넣기.</li>
          <li><strong>테스트당 검토 시간 5분</strong>: AI 가 FAIL 로 본 것 ≠ 전부 진짜 버그. 사람이 한 번 거르는 게 핵심.</li>
          <li><strong>스크린샷 먼저 보기</strong>: 화면을 보면 환경 문제인지/실제 버그인지 빠르게 구분.</li>
          <li><strong>에픽 = 과제 단위</strong>: 한 과제 = 한 에픽. 테스트 만들 때마다 그 과제의 에픽을 입력.</li>
          <li><strong>본인 토큰 해제 (claim 풀기)</strong>: 다른 PC 에서 본인 토큰 잡고 싶으면 기존 PC 에서 [해제] 후 새 PC 에서 [내 토큰] 클릭.</li>
        </ul>
      </Card>

      {/* ============================== */}
      <Card>
        <h2 className="text-base font-semibold">❓ 자주 묻는 질문</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Faq q="실행자를 jira-settings 이름과 다르게 적으면?">
            매칭 실패 → default 토큰(가장 최근 사용된 행)으로 fetch / 이슈 등록. 그러면 <strong>본인 명의가 아닌 다른 사람</strong>으로 reporter 가 박혀요.
            잡 상세에서 spec_text 맨 위에 <Code>※ default 토큰으로 추출됨</Code> 메시지가 보이면 매칭 실패한 것.
          </Faq>
          <Faq q="여러 PC 에서 같은 토큰을 쓰고 싶어요">
            한 어드민 DB 의 한 행이라 가능합니다. 다만 [내 토큰] localStorage 마킹은 PC 별로 따로. 본인이 메인 PC 에서 [내 토큰] claim 한 상태에서 다른 PC 들어가면 그 행은 <Code>주인 있음</Code> 배지로 보임 — 거기서도 본인이 [내 토큰] 다시 누르고 싶으면 메인 PC 에서 [해제] 한 다음에.
          </Faq>
          <Faq q="에픽 키 없이 등록하면 어떻게 되나요?">
            테스트 만들 때 에픽 키를 비워두면 — 단독 Bug 로 KQA 프로젝트에 생성됩니다. 에픽 연결이 없을 뿐 등록은 됩니다.
            나중에 Jira 에서 손으로 에픽에 옮길 수 있어요.
          </Faq>
          <Faq q="Confluence 본문이 아예 안 가져와져요">
            대부분 다음 중 하나:
            <ul className="ml-5 mt-1 list-disc">
              <li>잡 만들 때 실행자와 등록 이름이 매칭 안 됨 → spec_text 에 <Code>### ⚠️</Code> 메시지 확인</li>
              <li>토큰 만료 → /jira-settings 본인 행 [수정] → 새 토큰</li>
              <li>본인 계정이 그 Confluence 페이지를 못 보는 권한 (private space)</li>
              <li>URL 형식이 <Code>/wiki/spaces/&#123;key&#125;/pages/&#123;id&#125;/...</Code> 도 <Code>/wiki/x/&#123;key&#125;</Code> 도 아님</li>
            </ul>
          </Faq>
          <Faq q="등록 실패가 떴는데 뭐가 문제일까요?">
            대부분 다음 중 하나:
            <ul className="ml-5 mt-1 list-disc">
              <li>토큰 만료 → /jira-settings 갱신</li>
              <li>에픽 키 오타 (대소문자 무관이지만 숫자 부분 정확해야)</li>
              <li>본인 계정에 KQA 프로젝트 Create Issue 권한 없음</li>
              <li>Priority 값이 해당 프로젝트에 정의 안 됨 (관리자에게 문의)</li>
            </ul>
            패널 상단에 에러 메시지가 빨간 박스로 표시됩니다.
          </Faq>
          <Faq q="등록한 이슈를 어드민에서 삭제할 수 있나요?">
            어드민에서는 "등록 기록" 만 표시되고 Jira 이슈 자체는 삭제 안 됩니다. 잘못 등록했으면 Jira 에 가서 직접 삭제하세요.
          </Faq>
          <Faq q="다른 사람 토큰 행을 실수로 [삭제] 클릭하면?">
            확인 다이얼로그 후 삭제됩니다. 삭제된 행은 잡 매칭 안 됨 → 그 워커는 default 토큰으로 fallback. 본인이 다시 [신규 등록] 으로 살릴 수 있음.
          </Faq>
          <Faq q="토큰을 다른 사람이 볼 수 있나요?">
            토큰은 마스킹(<Code>ATATT3••••9DB6</Code>)돼서만 UI 에 노출. 실제 토큰은 <strong>AES-256-GCM 으로 암호화</strong>된 채 DB 에 저장돼 어드민 코드만 복호화 가능 (API 호출 직전에 메모리에서만 평문화).
            본인 이메일은 /jira-settings 직접 들어오면 다른 팀원이 볼 수 있음 — 어드민에 인증이 없는 사내 도구라는 점 유의.
          </Faq>
        </div>
      </Card>

      <Card>
        <p className="text-xs text-neutral-500">
          → <Link href="/guide" className="text-kurly-500 underline">가이드 목록</Link>으로 돌아가기
        </p>
      </Card>
    </GuideShell>
  );
}
