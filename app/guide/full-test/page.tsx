import Link from "next/link";
import { GuideShell, StepCard, Howto, Key, Code, Preview, Faq, Note, Card } from "../_components";

export const dynamic = "force-dynamic";

export default function FullTestGuide() {
  return (
    <GuideShell
      title="📋 기능 풀 테스트 사용법"
      subtitle="TC CSV 가 있을 때 — 정의된 케이스 전부를 순서대로 자동 실행합니다."
      meta={
        <>
          <strong>⏱ 예상 소요시간:</strong> 5분 (테스트 만들기까지)
          <br />
          <strong>📦 필요한 것:</strong> 검증할 TC CSV 파일 (No / Priority / Title / Step / Expected Result 컬럼 권장)
          <br />
          <strong>🎯 누가 쓰나:</strong> 회귀 테스트 / 정기 풀 테스트 / 정의된 시나리오 자동 실행이 필요한 분
        </>
      }
    >
      <StepCard num={1} title="기능테스트 페이지 열기">
        <p className="text-sm text-neutral-700">상단 메뉴에서 <strong>"기능테스트"</strong> 클릭, 또는 메인 카드의 <strong>"기능테스트 시작 →"</strong> 버튼.</p>
        <Howto>
          <li><Link href="/upload" className="text-kurly-500 underline">/upload</Link> 페이지로 이동</li>
        </Howto>
      </StepCard>

      <StepCard num={2} title="TC CSV 파일 업로드">
        <p className="text-sm text-neutral-700">파일을 드래그앤드롭 또는 클릭해서 선택. <strong>여러 파일 동시 업로드</strong>도 가능.</p>
        <Preview label="CSV 컬럼 형식 (권장)">
{`No,Priority,Type,TC Title,Test Step,Expected Result,시트분류
1,P1,기능검증,홈 진입,1) 메인 URL 접속,페이지 200 + 메인 노출,컬리몰(웹)
2,P1,기능검증,로그인,1) 로그인 버튼 클릭,로그인 모달 노출,컬리몰(웹)
3,P1,기능검증,파트너 상품등록,1) 상품 등록 메뉴 진입,등록 폼 표시,파트너오피스
...`}
        </Preview>
        <Note variant="info" title="📊 업로드 즉시 자동 분석">
          CSV 행 수 / 우선순위 분포(P1·P2·P3) / 도메인 자동 추정 / 플랫폼 추천 / <strong>시트분류(POC)</strong> 자동 인식이 화면에 표시됩니다.
        </Note>
        <Note variant="success" title="🎯 POC 모드 — 시트분류로 잡 자동 분할">
          CSV 에 <Code>시트분류</Code> 컬럼이 있고 값이 여러 POC (예: 컬리몰(웹) + 파트너오피스 혼합) 면 → 폼에 <strong>POC 선택기</strong> 자동 노출.
          선택한 POC 별로 <strong>잡이 따로 생성</strong>되고 platform 도 자동 결정됩니다.
          <ul className="ml-4 mt-1 list-disc text-[11px]">
            <li>컬리몰(웹) / La-CMS / 파트너오피스 / 파트너어드민 → <strong>Web</strong> (Playwright)</li>
            <li>컬리몰(앱) → <strong>App</strong> (Mobile MCP)</li>
            <li>다중 선택 시 한 번에 N개 잡 동시 시작 — 실행자/모델/추가지시 등 공통 옵션은 한 번만 입력</li>
          </ul>
        </Note>
      </StepCard>

      <StepCard num={3} title="기본 정보 입력">
        <Howto>
          <li><strong>도메인</strong> 선택 (멤버스/회원/3P/상품 등 10가지)</li>
          <li><strong>플랫폼</strong>: Web / Mweb / App</li>
          <li><strong>테스트 환경 URL *</strong>: 워커가 접근 가능한 베이스 URL 전체 입력
            <ul className="ml-5 mt-1 list-disc text-xs text-neutral-600">
              <li>예: <Code>https://stg.kurly.com</Code> / <Code>https://www.stg.kurly.com/main</Code> / <Code>https://qa10.kurly.services</Code></li>
              <li>워커 PC 의 VPN/DNS 환경에 맞춰 직접 입력 — DNS 해석 가능한 URL 이어야 합니다</li>
            </ul>
          </li>
          <li><strong>실행자 *</strong> (필수): <Link href="/jira-settings" className="text-kurly-500 underline">/jira-settings</Link> 에 등록한 본인 이름과 동일하게.
            <ul className="ml-5 mt-1 list-disc text-xs text-neutral-600">
              <li>예: <Code>다나</Code>, <Code>박상현</Code>, <Code>안종관</Code></li>
              <li>본인 Atlassian 토큰 매칭 키 — Confluence 본문 추출 + Jira 이슈 reporter</li>
              <li>매칭 안 되면 default 토큰(다른 사람) 사용. <Link href="/guide/jira" className="text-kurly-500 underline">Jira 가이드</Link> 참고.</li>
            </ul>
          </li>
          <li><strong>과제명</strong> (선택): 결과 폴더명에 사용. <Code>2026-06 멤버스 무료배송 회귀</Code> 같이.</li>
          <li><strong>에픽 키</strong> (선택): Jira 에픽 키</li>
        </Howto>
      </StepCard>

      <StepCard num={4} title="실행 옵션 (선택)">
        <p className="text-sm text-neutral-700">기본은 전체 실행. 특정 범위만 돌리려면 필터 사용.</p>
        <Howto>
          <li><strong>우선순위 필터</strong>: P1 만 / P1+P2 만 / 전체</li>
          <li><strong>행 범위</strong>: 예) 30~50번만 실행 (분할 검증 시)</li>
          <li><strong>추가 지시</strong>: AI 에게 전달할 보조 가이드 — <Code>모바일 우선 / 다국어는 영문만</Code> 식</li>
          <li><strong>기획 문서</strong> (선택): URL/PDF 첨부 → 모호한 TC 에 컨텍스트 제공.
            Confluence URL 은 <Link href="/jira-settings" className="text-kurly-500 underline">/jira-settings</Link> 토큰 등록 시 본문 자동 추출 (<Link href="/guide/jira" className="text-kurly-500 underline">Jira 가이드</Link>).
            <ul className="ml-5 mt-1 list-disc text-xs text-neutral-600">
              <li><strong>🔍 사전 검증</strong> 버튼 — 잡 생성 전에 URL 본문이 실제로 추출되는지 확인. 토큰 만료/URL 오타/권한 문제를 잡 실행 후가 아니라 등록 전에 발견</li>
            </ul>
          </li>
          <li><strong>모델</strong> (선택): Claude Sonnet 4.6 (기본, 빠름/저렴) / Opus 4.8 (까다로운 케이스)</li>
        </Howto>
      </StepCard>

      <StepCard num={5} title="실행 워커 + 모드 선택">
        <Howto>
          <li><strong>실행 워커</strong>:
            <ul className="ml-5 mt-1 list-disc text-xs text-neutral-600">
              <li><strong>(자동)</strong> — 종관님 PC 가 처리</li>
              <li><strong>본인 PC (⭐ 표시)</strong> — 본인이 자기 머신에서</li>
              <li><strong>다른 사람 워커</strong> — 그 사람 PC 에서 (그 사람 켜져 있어야)</li>
            </ul>
          </li>
          <li><strong>모드</strong>:
            <ul className="ml-5 mt-1 list-disc text-xs text-neutral-600">
              <li><strong>MOCK</strong> — AI 안 부르고 시뮬레이션 (UI 검증 용도, 빠름)</li>
              <li><strong>REAL</strong> — 실제 Claude → Playwright 호출 (진짜 자동화)</li>
            </ul>
          </li>
        </Howto>
        <Note variant="warn" title="⚠️ 외부 워커 선택 시 MOCK 자동 비활성">
          외부 워커는 REAL 만 처리. MOCK 돌리려면 워커 "(자동)" 선택.
        </Note>
      </StepCard>

      <StepCard num={6} title="실행 → 진행 모니터링">
        <p className="text-sm text-neutral-700">맨 아래 <strong>"실행 시작"</strong> 버튼 → 자동으로 테스트 상세 페이지(<Code>/jobs/&#123;id&#125;</Code>) 로 이동.</p>
        <Howto>
          <li>실시간 로그 스트림 — Claude 가 어떤 도구 호출하는지, 각 TC PASS/FAIL/BLOCKED</li>
          <li>진행률 카운터 자동 갱신</li>
          <li>중간에 <strong>중단</strong> 가능 — 우상단 "취소" 버튼</li>
        </Howto>
        <Preview label="실시간 로그 예시">
{`[info] 작업 시작: my-tcs.csv (멤버스/web/https://stg.kurly.com) [mode=real]
[info] 총 25개 케이스 감지
[info] Claude 세션 시작
[info] 🔧 도구 호출: mcp__playwright__browser_navigate
[info] TC-1 PASS - 홈 진입 정상
[warn] TC-2 FAIL - 로그인 버튼 미노출
...
[info] 최종 집계: PASS=20 FAIL=3 BLOCKED=2
[info] 작업 완료`}
        </Preview>
      </StepCard>

      <StepCard num={7} title="결과 확인">
        <p className="text-sm text-neutral-700">완료되면 같은 페이지에 결과 카드들이 자동 표시됩니다.</p>
        <Howto>
          <li><strong>⚠️ 실패/블록 케이스 목록 카드</strong> — FAIL/BLOCKED 탭 전환 + No/우선순위/제목/사유/기대·실제 결과/스크린샷 한 화면에 표시 (CSV 안 열어도 OK)</li>
          <li><strong>⏱ 실행시간 (duration)</strong> — 잡 완료 시 자동 기록. 히스토리에서 도메인별/모델별로 비교 가능</li>
          <li><strong>⚠ Flaky TC 배지</strong> — 같은 TC 가 재실행 체인에서 PASS ↔ FAIL/BLOCKED 뒤집힌 경우 주황 배지로 표시 (환경 일시 이슈 또는 불안정 케이스)</li>
          <li><strong>잡 설정 컨텍스트 패널</strong> — 페이지 하단 <Code>잡 설정 컨텍스트</Code> 접힘 카드: 모델/스펙 본문/CSV 자동분석 결과 등 잡 만들 때 입력값을 다시 확인 가능</li>
          <li><strong>결과 파일</strong>: <Code>summary.csv</Code> (전체) / <Code>fail-detail.csv</Code> (FAIL만)</li>
          <li><strong>스크린샷 갤러리</strong>: TC-N 별 스크린샷 (FAIL 은 필수)</li>
          <li><strong>FAIL/BLOCKED 재실행 버튼</strong>: 실패한 케이스만 다시 돌리기 + <strong>모델·우선순위 오버라이드</strong> 가능 (flaky 한 건 Opus 로, P1 실패만 등)</li>
          <li><strong>📁 스위트로 저장</strong>: 이 잡 설정(파일+옵션 전체)을 이름으로 저장 → 나중에 <Link href="/suites" className="text-kurly-500 underline">/suites</Link> 에서 한 번에 재실행</li>
        </Howto>
        <Note variant="info" title="📝 결과 사유는 풀어쓴 한국어로">
          AI 가 작성하는 Notes/Fail Reason 은 <strong>전문 영문 용어(clamp, Severity, fallback 등) 금지</strong> · <strong>완성형 한국어 문장</strong>으로 풀어쓰도록 prompt에 박혀 있습니다. 비개발자도 바로 이해 가능.
        </Note>
      </StepCard>

      <Card>
        <h2 className="text-base font-semibold">💡 결과 잘 활용하는 팁</h2>
        <ul className="mt-2 ml-5 list-disc text-sm text-neutral-700 space-y-1">
          <li><strong>FAIL 재실행</strong>: <Code>retry_Nfails.csv</Code> 자동 생성 → 사람이 한 번 더 확인해야 할 케이스만 빠르게 재검증. 재실행 모달에서 <strong>모델(Sonnet/Opus) + 우선순위 필터</strong> 별도 지정 가능</li>
          <li><strong>BLOCKED 재실행</strong>: 격려 모드로 다시 시도 — "미리 한계 선언 금지" 프롬프트 자동 주입</li>
          <li><strong>📊 결과 비교</strong>: 잡 2개 이상 골라서 <Link href="/compare" className="text-kurly-500 underline">/compare</Link> 에서 TC 별 결과를 나란히. fix 전후 효과 확인. 결과가 바뀐 TC 는 주황 강조</li>
          <li><strong>히스토리 그룹화 + 검색/필터</strong>: 재실행은 원본 테스트 아래 ▶ 으로 묶임. <Link href="/history" className="text-kurly-500 underline">히스토리</Link> 에서 파일명/과제명 검색 + 상태/도메인/실행자 필터 조합 가능</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">❓ 자주 묻는 질문</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Faq q="TC 가 너무 많아요. 일부만 돌릴 수 있나요?">
            네 — Step 4 의 <strong>우선순위 필터</strong> (P1 만) 또는 <strong>행 범위</strong> (N~M 번) 활용.
          </Faq>
          <Faq q="테스트가 진행 중인데 멈추고 싶어요">
            테스트 상세 페이지 우상단 <strong>"취소"</strong> 버튼. 워커가 자식 프로세스까지 정리합니다.
          </Faq>
          <Faq q="테스트가 'pending' 상태로 멈춰있어요">
            지정한 워커가 offline 일 수 있어요. <Link href="/workers" className="text-kurly-500 underline">/workers</Link> 에서 상태 확인.
            (영원히 갇히면 종관님에게 워커 재할당 요청)
          </Faq>
          <Faq q="MOCK 과 REAL 차이가 뭐예요?">
            MOCK 은 결과를 랜덤 생성하는 시뮬레이션 (어드민/워커 동작 확인용). REAL 은 실제 Claude + Playwright/Mobile MCP 호출해서 진짜 자동화. <strong>진짜 검증은 REAL 만</strong>.
          </Faq>
          <Faq q="결과가 다른 사람 PC 에 저장돼요">
            외부 워커가 처리해도 결과는 자동으로 어드민으로 업로드됩니다. <Code>/jobs/&#123;id&#125;</Code> 에서 다 보임.
          </Faq>
          <Faq q="DNS 해석 실패 / VPN 안 되는 환경에서 BLOCKED 가 너무 많이 나와요">
            <strong>테스트 환경 URL</strong> 필드에 워커 PC 에서 실제 접근 가능한 URL 을 직접 입력하세요.
            워커마다 VPN 상태 / split-DNS 설정이 다르므로, 같은 잡이라도 워커에 따라 결과가 다를 수 있어요.
            워커 시작 전 <Code>curl https://stg.kurly.com</Code> 으로 접근 확인하는 게 안전합니다.
          </Faq>
          <Faq q="로그인 자격증명 때문에 시간을 많이 잡아먹어요">
            knowledge 폴더에 도메인별 stg 테스트 계정(id/pw) 미리 적어두거나, 잡 실행 중 채팅으로
            <Code>"모든 계정 비밀번호는 XXX 야"</Code> 한 줄 추가하면 즉시 학습합니다.
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
