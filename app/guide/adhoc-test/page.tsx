import Link from "next/link";
import { GuideShell, StepCard, Howto, Code, Preview, Faq, Note, Card } from "../_components";

export const dynamic = "force-dynamic";

export default function AdhocTestGuide() {
  return (
    <GuideShell
      title="🔍 애드혹 테스트 사용법"
      subtitle="TC 가 없어도 OK — 기획서 + 자유 텍스트만 주면 AI 가 시나리오를 직접 도출해서 탐색적으로 검증합니다."
      meta={
        <>
          <strong>⏱ 예상 소요시간:</strong> 5분 (테스트 만들기) · 10~30분 (AI 실행)
          <br />
          <strong>📦 필요한 것:</strong> 기획 문서 (URL/PDF/직접입력) <strong>또는</strong> 검증 포커스 텍스트
          <br />
          <strong>🎯 누가 쓰나:</strong> 신기능 기획만 받았고 TC 작성 전인 분 / 빠르게 탐색 검증 원하는 분
        </>
      }
    >
      <StepCard num={1} title="애드혹 페이지 열기">
        <p className="text-sm text-neutral-700">상단 메뉴 <strong>"애드혹"</strong> 또는 메인 카드 <strong>"애드혹 시작 →"</strong>.</p>
        <Howto>
          <li><Link href="/adhoc" className="text-kurly-500 underline">/adhoc</Link> 페이지로 이동</li>
        </Howto>
      </StepCard>

      <StepCard num={2} title="기본 정보 입력">
        <Howto>
          <li><strong>도메인 *</strong> — 검증할 도메인 (knowledge 폴더 참조용)</li>
          <li><strong>플랫폼 *</strong> — Web / Mweb / App</li>
          <li><strong>테스트 환경 URL *</strong> — 워커가 접근 가능한 베이스 URL 전체
            <ul className="ml-5 mt-1 list-disc text-xs text-neutral-600">
              <li>예: <Code>https://stg.kurly.com</Code> / <Code>https://www.stg.kurly.com/main</Code></li>
              <li>워커 PC 의 VPN/DNS 환경에 맞춰 입력 — DNS 해석 가능한 URL 이어야 함</li>
            </ul>
          </li>
          <li><strong>실행자 *</strong> (필수) — <Link href="/jira-settings" className="text-kurly-500 underline">/jira-settings</Link> 에 등록한 본인 이름과 동일하게.
            <ul className="ml-5 mt-1 list-disc text-xs text-neutral-600">
              <li>예: <Code>다나</Code>, <Code>박상현</Code>, <Code>안종관</Code></li>
              <li>이 값으로 본인 Atlassian 토큰 매칭 → Confluence 본문 자동 추출 + Jira 이슈 reporter</li>
              <li>매칭 안 되면 default 토큰(다른 사람) 사용. <Link href="/guide/jira" className="text-kurly-500 underline">Jira 가이드</Link> 참고.</li>
            </ul>
          </li>
          <li><strong>과제명 (선택)</strong> — 결과 폴더명에 사용. <Code>회원가입 흐름 탐색</Code> 같이.</li>
        </Howto>
      </StepCard>

      <StepCard num={3} title="📎 기획 문서 입력 (3가지 방법 중 택1)">
        <p className="text-sm text-neutral-700">아래 셋 중 <strong>어느 하나라도</strong> 채우면 됩니다 (다 비워도 포커스 텍스트만 있으면 OK).</p>

        <div className="mt-3 space-y-3">
          <div className="rounded border border-neutral-200 p-3">
            <strong className="text-sm">방법 A: URL 입력 (Confluence 자동 추출 지원)</strong>
            <p className="mt-1 text-xs text-neutral-600">
              Confluence / Notion / Figma / 일반 웹 페이지 URL. 어드민이 자동 fetch (최대 30000자 발췌).
              여러 개는 한 줄당 1개.
            </p>
            <Note variant="success">
              ✅ <strong>Confluence URL</strong>(<Code>*.atlassian.net/wiki/...</Code>): <Link href="/jira-settings" className="text-kurly-500 underline">/jira-settings</Link> 에 본인 Atlassian 토큰 등록해두면
              본인 권한으로 본문 자동 추출 (인증 페이지 HTML 안 들어옴). <Link href="/guide/jira" className="text-kurly-500 underline">Jira 가이드</Link> 참고.
              잡 만들 때 <Code>실행자</Code> 가 등록 이름과 매칭돼야 본인 토큰 사용됨.
            </Note>
            <Note variant="warn">
              토큰 미등록 / 실행자 매칭 실패 시: spec_text 에 <Code>### ⚠️ Confluence 본문 미추출</Code> 메시지가 들어가요 → 방법 C 로 대체.
            </Note>
          </div>

          <div className="rounded border border-neutral-200 p-3">
            <strong className="text-sm">방법 B: PDF 첨부</strong>
            <p className="mt-1 text-xs text-neutral-600">
              기획서 PDF 파일 그대로 → 텍스트 추출.
            </p>
          </div>

          <div className="rounded border border-neutral-200 p-3">
            <strong className="text-sm">방법 C: 명세 본문 직접 붙여넣기 (추천)</strong>
            <p className="mt-1 text-xs text-neutral-600">
              핵심 섹션만 복사해서 textarea 에 직접. URL fetch 가 안 되거나 큰 명세에서 정확도 최대.
            </p>
          </div>
        </div>
      </StepCard>

      <StepCard num={4} title="🎯 포커스 영역 텍스트 (가장 중요)">
        <p className="text-sm text-neutral-700">
          <strong>구체적일수록 결과 품질이 좋아집니다.</strong> AI 에게 "어디를 집중 검증해" 가이드.
        </p>
        <Preview label="잘 쓴 포커스 예시 (멤버스 도메인)">
{`회원가입 시 만 14세 이하 차단,
통신사 인증 실패 케이스 처리,
동일 이메일 중복 가입 방지

— 위 3가지 위주로 집중 검증해.
부정 케이스 (잘못된 입력) 와 엣지 케이스 (경계값) 도 같이.`}
        </Preview>
        <Preview label="나쁜 포커스 예시 (너무 추상)">
{`회원가입 잘 되는지 확인해줘`}
        </Preview>
        <Note variant="info">
          포커스만 있고 기획서가 없어도 동작합니다. 단 그러면 AI 가 도메인 knowledge 만 보고 진행 → 결과 품질은 낮아짐.
        </Note>
      </StepCard>

      <StepCard num={5} title="실행 모드 + 워커 선택">
        <Howto>
          <li><strong>모드</strong>: MOCK (시뮬) / REAL (실제 Claude 호출). 진짜 검증은 REAL.</li>
          <li><strong>워커</strong>: 본인 PC (⭐ 표시) 가 자동 디폴트. 다른 워커도 선택 가능.</li>
        </Howto>
      </StepCard>

      <StepCard num={6} title="실행 → AI 가 시나리오 도출 + 실행">
        <p className="text-sm text-neutral-700">"애드혹 테스트 시작" 클릭 → 테스트 상세 페이지로 이동.</p>
        <p className="mt-2 text-sm text-neutral-700">AI 가 자동으로:</p>
        <Howto>
          <li><strong>시나리오 도출</strong> (5~15개) — 정상 / 엣지 / 부정 / 회귀</li>
          <li><strong>순서대로 실행</strong> — Playwright/Mobile MCP 로 실제 화면 조작</li>
          <li><strong>PASS/FAIL/BLOCKED 판정</strong> + 스크린샷 + 노트 기록</li>
        </Howto>
        <Preview label="진행 중 로그 예시">
{`[info] 애드혹 작업 시작: 멤버스/web/https://stg.kurly.com [mode=real]
[info] Claude 세션 시작
[info] 🔧 도구 호출: mcp__playwright__browser_navigate
[info] TC-1 PASS: 회원가입 페이지 정상 노출
[warn] TC-2 FAIL: 만 13세 입력 시 차단 안 됨 (에러 메시지 미노출)
[info] TC-3 PASS: 통신사 인증 실패 시 친화적 메시지 노출
...`}
        </Preview>
      </StepCard>

      <StepCard num={7} title="결과: summary.csv + report.md 자동 생성">
        <p className="text-sm text-neutral-700">테스트 끝나면 테스트 상세 페이지에 자동 표시.</p>
        <Howto>
          <li><strong>⚠️ 실패/블록 케이스 목록 카드</strong> — FAIL/BLOCKED 탭 전환 + 사유/기대·실제 결과/스크린샷 한 화면에 표시</li>
          <li><strong>⏱ 실행시간 (duration)</strong> — 잡 완료 시 자동 기록. 다음 잡 예상시간 추정에도 활용됨</li>
          <li><strong>⚠ Flaky TC 배지</strong> — 재실행 체인에서 PASS ↔ FAIL/BLOCKED 뒤집힌 케이스 주황 강조</li>
          <li><strong>잡 설정 컨텍스트 패널</strong> — 페이지 하단 접힘 카드: 애드혹 포커스 / 스펙 본문 / 사용한 모델 등 입력값 다시 확인</li>
          <li><strong>summary.csv</strong> — 시나리오별 PASS/FAIL 표 (Notes 는 풀어쓴 한국어 문장)</li>
          <li><strong>🔍 애드혹 테스트 리포트 (report.md)</strong> 카드 — 마크다운 렌더링
            <ul className="ml-5 mt-1 list-disc text-xs text-neutral-600">
              <li>요약 — 시나리오 N건, PASS/FAIL/BLOCKED</li>
              <li>발견된 버그 — [심각도] + 재현 단계 + 기대/실제 + 스크린샷</li>
              <li>의문점 — 기획서 모호한 부분</li>
              <li>테스트 범위 — 다룬 / 못 다룬 영역</li>
              <li>추천 다음 액션</li>
            </ul>
          </li>
          <li><strong>FAIL/BLOCKED 재실행</strong> — 모달에서 <strong>모델·우선순위 오버라이드</strong> 가능 (flaky 한 건 Opus 로)</li>
          <li><strong>📁 스위트로 저장</strong> + <strong>📊 결과 비교</strong> — 같은 도메인의 회귀 검증에 유용. <Link href="/suites" className="text-kurly-500 underline">/suites</Link> · <Link href="/compare" className="text-kurly-500 underline">/compare</Link></li>
        </Howto>
      </StepCard>

      <Card>
        <h2 className="text-base font-semibold">💡 결과 품질 높이는 팁</h2>
        <ul className="mt-2 ml-5 list-disc text-sm text-neutral-700 space-y-1">
          <li><strong>포커스를 구체적으로</strong> — "회원가입" 보다 "회원가입 시 만 14세 이하 차단 + 통신사 인증 실패 + 중복 이메일"</li>
          <li><strong>knowledge 폴더 활용</strong> — 도메인의 <Code>knowledge/{`{도메인}`}/</Code> 에 사전 정보 .md 파일 있으면 AI 가 자동 참고</li>
          <li><strong>추가 지시사항</strong> — "모바일 우선" / "다국어는 영문만" 등 보조 가이드</li>
          <li><strong>기획서 + 포커스 둘 다</strong> — 기획서로 컨텍스트, 포커스로 방향. 둘 다 있으면 최고 품질</li>
          <li><strong>🔍 사전 spec 검증</strong> — Confluence URL 입력 후 [검증] 클릭 → 본문 미리보기 + 토큰/권한 즉시 확인</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">❓ 자주 묻는 질문</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Faq q="TC CSV 가 있는데도 애드혹 써도 되나요?">
            기능 풀 테스트가 더 적합합니다. 풀 테스트로 정의된 케이스 다 돌리고, 빈틈은 애드혹으로 보완.
          </Faq>
          <Faq q="시나리오 몇 개가 적당한가요?">
            5~15개가 표준. 너무 많으면 시간/토큰 비용 증가. AI 가 자동으로 의미 있는 개수만 도출.
          </Faq>
          <Faq q="기획서가 PDF 인데 잘 안 읽혀요">
            PDF 가 이미지 기반(스캔본)이면 텍스트 추출 실패. <strong>방법 C: 직접 붙여넣기</strong> 추천.
          </Faq>
          <Faq q="결과의 'BLOCKED' 가 너무 많아요">
            knowledge 폴더에 도메인 정보가 부족하거나, 포커스가 너무 광범위해서 AI 가 진행을 못 한 경우.
            knowledge 보강 또는 포커스 좁히기.
          </Faq>
          <Faq q="report.md 가 마음에 안 들어요. 다시 돌리려면?">
            테스트 상세 페이지 우상단 <strong>"재실행"</strong> 버튼 → 같은 입력으로 새 테스트 (parent_job_id 자동 연결).
            또는 포커스/추가 지시 수정해서 새로 만들기.
          </Faq>
          <Faq q="DNS 해석 실패 / VPN 안 되는 환경이라 BLOCKED 가 많이 나와요">
            <strong>테스트 환경 URL</strong> 필드에 워커 PC 에서 실제 접근 가능한 URL 을 직접 입력하세요.
            워커마다 VPN/네트워크 환경이 달라 같은 잡이라도 워커에 따라 결과가 다를 수 있습니다.
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
