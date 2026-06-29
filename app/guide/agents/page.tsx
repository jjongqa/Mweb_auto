import Link from "next/link";
import { GuideShell, StepCard, Howto, Code, Preview, Faq, Note, Card } from "../_components";

export const dynamic = "force-dynamic";

export default function AgentsGuide() {
  return (
    <GuideShell
      title="🎮 에이전트 오피스 (멀티 분할·병렬) 사용법"
      subtitle="워커(내 PC)마다 게임 캐릭터 같은 '에이전트'를 두고, 한 작업을 여러 에이전트가 나눠 병렬로 처리한 뒤 결과를 하나로 합칩니다. 설계·작성·수행 각 단계에 적용돼요."
      meta={
        <>
          <strong>⏱ 설정:</strong> 3~5분 (워커당 1회) · 이후 폼에서 체크 한 번
          <br />
          <strong>📦 필요한 것:</strong> 본인 PC 워커가 켜져 있을 것 (없으면 <Link href="/workers/install" className="underline">워커 설치</Link>)
          <br />
          <strong>🎯 누가 쓰나:</strong> TC가 많아 시간을 줄이고 싶거나, 한 기획서를 영역별로 나눠 분석/작성하고 싶은 분
        </>
      }
    >
      <Card>
        <h2 className="text-base font-semibold">🧠 한 줄 개념 — 메인 / 서브 에이전트</h2>
        <ul className="mt-2 ml-5 list-disc text-sm text-neutral-700 space-y-1.5">
          <li><strong>메인 에이전트 = 오케스트레이터(어드민)</strong>: 별도 AI가 아니라 어드민 로직. 일을 <strong>분석 → 분할 → 서브에 배분 → 결과 합본</strong>.</li>
          <li><strong>서브 에이전트 = 워커 PC에서 도는 claude 1개</strong>: 멀티를 켜면 서브 N명 = <Code>claude</Code> N개가 <strong>동시 실행</strong> → 합본.</li>
          <li>화면의 <strong>픽셀 캐릭터 = 페르소나 표현</strong>일 뿐. 멀티 켜면 <strong>캐릭터 수 = 동시에 도는 claude 수</strong>.</li>
        </ul>
        <Note variant="info">
          단일(single) 모드면 그냥 claude 1개가 통째로 처리합니다. 멀티(multi)일 때만 N개로 쪼개 병렬 → 합본.
        </Note>
      </Card>

      <StepCard num={1} title="에이전트 오피스 열기 + 내 워커 자동 고정">
        <Howto>
          <li>상단 메뉴 <strong>🎮 에이전트</strong> → <Link href="/agents" className="text-kurly-500 underline">/agents</Link></li>
          <li>접속한 PC의 워커가 <strong>자동으로 고정</strong>돼요 (접속 IP 감지 + 기억). 즉 <strong>내 워커의 에이전트만</strong> 편집하게 됩니다.</li>
          <li>다른 워커로 바꾸려면 상단 <Code>변경</Code> 클릭 (편의 잠금일 뿐 — 무인증).</li>
        </Howto>
        <Note variant="info" title="구성">
          워커마다: <strong>메인 1명</strong> + <strong>설계 / 작성 / 수행</strong> 3개 그룹(그룹마다 에이전트 여러 명). 그룹별로 단일/멀티를 따로 켭니다.
        </Note>
      </StepCard>

      <StepCard num={2} title="에이전트 구성 — 단일/멀티 · 이름 · 지시">
        <Howto>
          <li><strong>단일 / 멀티 토글</strong> (그룹 우상단): <strong>멀티 = 그 그룹 에이전트들이 병렬</strong>로 일함. 단일 = 1명만.</li>
          <li><strong>에이전트 추가/삭제</strong>: <Code>+ 에이전트 추가</Code> / 카드 우상단 <Code>×</Code>. (메인·마지막 1명은 보호)</li>
          <li><strong>이름 편집</strong>: 캐릭터 이름 클릭 → 인라인 수정 (예: 러너·대시·스프린트).</li>
          <li><strong>📝 지시 추가</strong>: 각 에이전트에 <strong>집중할 영역(focus)</strong>을 적으면 그 에이전트의 claude 프롬프트에 주입돼요.</li>
        </Howto>
        <Preview label="설계/작성 — 지시 예시 (영역 분담)">
{`아키   : [회원] 첫구매 넛징 과제에서 비회원 노출 정책 중점으로 분석
플래너 : [회원] 첫구매 넛징 과제에서 회원 노출 정책 중점으로 분석
스캐너 : [회원] 첫구매 넛징 과제에서 툴팁 공통 정책 중점으로 분석`}
        </Preview>
        <Note variant="warn" title="수행(기능테스트) 지시는 성격이 다름">
          수행 청크는 <strong>내용이 아니라 TC 줄 번호로</strong> 쪼개져요(예: 1~13 / 14~26 / 27~39). 그래서 "비회원 집중" 같은 내용 지시는 안 맞고,
          공통 주의는 <strong>폼의 "추가 지시사항"</strong>(전 청크 동일 주입)이 더 적합합니다. 에이전트별 지시는 청크마다 환경/계정을 다르게 줄 때 정도.
        </Note>
      </StepCard>

      <StepCard num={3} title="그룹별 멀티 동작 차이 (핵심)">
        <div className="mt-1 space-y-3">
          <div className="rounded border border-neutral-200 p-3">
            <strong className="text-sm">🔬 설계 / ✍️ 작성 — 지시 기반 병렬 → 합본</strong>
            <p className="mt-1 text-xs text-neutral-600">
              <strong>같은 기획서</strong>를 에이전트마다 각자 지시(focus)대로 분석/작성 → 결과를 하나로 합침.
              설계는 에이전트별 분석을 합본, 작성은 TC CSV를 union(합집합) + No 재넘버링.
            </p>
          </div>
          <div className="rounded border border-neutral-200 p-3">
            <strong className="text-sm">▶️ 수행(기능테스트) — TC 청크 분할 → 병렬 → 합본</strong>
            <p className="mt-1 text-xs text-neutral-600">
              업로드한 TC를 에이전트 수만큼 <strong>연속 범위로 N등분</strong>(39건·3명 → 13/13/13) → 각자 Playwright로 병렬 수행 →
              <strong>통합 summary.csv</strong> 하나로 합산. POC(시트분류)를 골랐다면 POC별 × 에이전트로 추가 분할.
            </p>
          </div>
        </div>
      </StepCard>

      <StepCard num={4} title="실제 실행에서 멀티 켜기">
        <p className="text-sm text-neutral-700">
          오피스에서 그룹을 <strong>멀티(에이전트 2명+)</strong>로 해두면, 해당 폼에 <strong>🎮 멀티 분할 배너</strong>가 자동으로 떠요. 체크하고 실행하면 끝.
        </p>
        <Howto>
          <li><strong>설계</strong>: <Link href="/qa-design" className="text-kurly-500 underline">/qa-design</Link> 폼 하단 — "지시 기반 병렬 설계 — N개 에이전트" 체크</li>
          <li><strong>작성</strong>: <Link href="/tc-gen" className="text-kurly-500 underline">/tc-gen</Link> 폼, 또는 설계 결과의 <strong>"TC생성으로 보내기"</strong> 핸드오프 (합본 분석이 작성 N잡 모두에 주입)</li>
          <li><strong>수행</strong>: <Link href="/upload" className="text-kurly-500 underline">/upload</Link>(기능테스트) 폼 — "🎮 멀티 분할 수행 — N개 에이전트 병렬" 체크</li>
        </Howto>
        <Note variant="info">
          배너가 안 보이면? → 그 폼에서 <strong>선택된 워커의 그 그룹이 멀티</strong>인지 확인. 에이전트가 1명이면 단일로 폴백.
        </Note>
      </StepCard>

      <StepCard num={5} title="결과 보기 — 합산 / 그룹 접힘 / 통합 CSV">
        <Howto>
          <li><strong>잡 상세 상단</strong>: 멀티면 <strong>그룹 합산</strong>(🎮 에이전트 N명 합산)이 주 결과 + "이 청크" 보조줄. 청크 그룹 배너에 형제 청크·전체 진행바.</li>
          <li><strong>통합 summary.csv</strong>: 청크 그룹 배너의 <Code>⬇ 통합 summary.csv</Code> — 전체 합쳐서 한 파일.</li>
          <li><strong>히스토리</strong>: <Link href="/history" className="text-kurly-500 underline">/history</Link> 에서 N개 청크가 <strong>▶ 한 묶음으로 접힘</strong> (🎮 에이전트 N명 + 합산). 펼치면 개별 확인.</li>
          <li><strong>설계 합본</strong>: 설계 상세 하단 "🔬 합본 QA 설계 (에이전트별 분석 통합)".</li>
        </Howto>
      </StepCard>

      <Card>
        <h2 className="text-base font-semibold">⚡ 진짜 동시 실행 = 워커 슬롯에 달림</h2>
        <p className="mt-1 text-sm text-neutral-700">
          멀티로 N개를 만들어도, 워커가 <strong>한 번에 N개를 동시에</strong> 돌리려면 동시 슬롯이 N 이상이어야 해요. 슬롯보다 많으면 일부는 순차 실행되고, 잡/진행바에 경고가 떠요.
        </p>
        <ul className="mt-2 ml-5 list-disc text-sm text-neutral-700 space-y-1">
          <li><strong>수행(기능테스트)</strong>: <Code>WORKER_MAX_CONCURRENT</Code> (브라우저 띄움 → 무거움). <Code>npm run worker</Code> 로 띄우면 기본 3.</li>
          <li><strong>설계/작성</strong>: <Code>WORKER_TCGEN_CONCURRENT</Code> (브라우저 없이 분석만 → 가벼움). 기본 3.</li>
          <li>결과 합본은 슬롯과 무관하게 <strong>항상</strong> 됩니다 — 단지 동시냐 순차냐 차이.</li>
        </ul>
        <CommandHint />
      </Card>

      <Card>
        <h2 className="text-base font-semibold">❓ 자주 묻는 질문</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Faq q="3개로 돌리면 결과가 3개 따로 나오나요?">
            아니요. 잡은 N개로 나뉘지만 <strong>합산 결과 + 통합 summary.csv 하나</strong>로 나옵니다. 히스토리에서도 ▶ 한 묶음으로 접혀요.
          </Faq>
          <Faq q="TC를 어떻게 쪼개나요? 의존성 있는 TC가 갈라지면?">
            현재는 <strong>연속 범위 분할</strong>(작성 순서대로 N등분)이에요. TC 사전조건이 <strong>이전 TC 산출물(주문번호 등)을 안 가리키고 자립적</strong>이면 분할 위치와 무관하게 안전합니다.
            (AI가 의존성 보고 묶어 분할하는 건 후속 과제)
          </Faq>
          <Faq q="에이전트 지시(focus)는 꼭 적어야 하나요?">
            설계/작성은 <strong>적으면 영역 분담</strong>이 돼서 유용해요(비회원/회원/툴팁 등). 안 적으면 다 같은 기획서를 보고 병렬. 수행은 지시 없이도 정상(분할만).
          </Faq>
          <Faq q="다른 사람이 내 워커 에이전트를 바꾸나요?">
            접속 PC 기준 자동 고정이라 보통은 본인 것만 보여요. 다만 <strong>인증 없는 편의 잠금</strong>이라, 굳이 변경하면 가능은 합니다(무인증 신뢰 기반).
          </Faq>
          <Faq q="멀티인데 1개씩 순차로 도는 것 같아요">
            워커 동시 슬롯이 부족한 거예요. 위 "진짜 동시 실행" 참고 — <Code>npm run worker</Code>(슬롯 3)로 재시작하거나 에이전트 수를 줄이세요. 결과 합본은 그대로 됩니다.
          </Faq>
        </div>
      </Card>

      <Card>
        <p className="text-xs text-neutral-500">
          → <Link href="/guide" className="text-kurly-500 underline">가이드 목록</Link>으로 돌아가기 · <Link href="/agents" className="text-kurly-500 underline">🎮 에이전트 오피스 열기</Link>
        </p>
      </Card>
    </GuideShell>
  );
}

function CommandHint() {
  return (
    <div className="mt-3 rounded-lg bg-neutral-900 p-3 font-mono text-xs text-neutral-100">
      # 빌트인 워커(내 Mac)를 슬롯 3으로 — 웹+워커 한 번에<br />
      npm run dev:all<br />
      <span className="text-neutral-400"># 또는 워커만: npm run worker</span>
    </div>
  );
}
