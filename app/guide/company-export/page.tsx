import Link from "next/link";
import { GuideShell, StepCard, Howto, Code, Preview, Faq, Note, Card } from "../_components";

export const dynamic = "force-dynamic";

const ZIP_COMMAND = `zip -r jjongqa-v2-work.zip . \\
  -x "node_modules/*" \\
  -x ".next/*" \\
  -x ".git/*" \\
  -x "data/*.db" \\
  -x "data/*.db-wal" \\
  -x "data/*.db-shm" \\
  -x "uploads/*" \\
  -x "results/*" \\
  -x "tc-gen-output/*"`;

const COMPANY_PROMPT = `이 폴더는 개인 PC에서 작업한 jjongqa V2 개선본입니다.
회사 PC의 현재 레포에 그대로 덮어쓰지 말고, 아래 범위만 비교해서 필요한 코드만 반영해주세요.

반영 범위:
- QA 설계 고도화
- TC 작성 고도화
- 에이전트 페이지 고도화
- 에이전트 지시사항 관리/AI 개선안 생성 UI
- 에이전트별 품질 인사이트
- 테스트데이터 에이전트 및 수행 중 테스트 데이터 생성/검증 중앙 큐 핸드오프
- 설계 품질 리뷰/점수
- TC 결과 REQ-ID 커버리지 UI
- 종합 품질 리뷰
- 자동 개선 루프

워커 관련 원칙:
- 회사 PC의 외부 워커 운영 환경은 건드리지 마세요.
- 워커 설치, 재설치, 등록, 토큰, 환경변수, 실행 경로, heartbeat/claim 설정은 변경하지 마세요.
- worker/external-worker 코드는 설계/작성 잡 호환에 꼭 필요한 최소 diff만 검토하고, 운영 설정 변경은 제외해주세요.
- 회사 워커를 재시작하거나 재등록하지 말고, 코드 반영 후 문법/빌드 검증까지만 진행해주세요.

Codex 관련 원칙:
- 개인 PC의 Codex 설정, 스킬, 플러그인, 캐시, 세션, 로컬 MCP/connector 설정은 회사 PC에 반영하지 마세요.
- .codex, ~/.codex, Codex 앱/CLI 설정, 개인 API 키/토큰, 로컬 스레드/작업 세션 정보는 제외해주세요.
- Codex에서 만든 산출물은 코드 diff 참고용으로만 보고, 회사 환경 설정에는 반영하지 마세요.

테스트데이터 중앙 큐 반영 기준:
- 테스트데이터 관련 변경은 TC 생성 후 사전 분석 방식이 아닙니다.
- 기능테스트 수행 중 수행 에이전트가 필요한 데이터를 중앙 큐(data_requests)에 요청하고,
  테스트데이터 워커가 요청을 1건씩 순차 처리한 뒤 dataContext를 반환하는 구조만 반영해주세요.
- 특히 아래 파일/영역을 확인해주세요.
  - lib/data-requests.ts
  - lib/db.ts 의 data_requests 테이블
  - app/api/data-requests/**
  - worker/index.js 의 데이터 큐 polling/처리 로직
  - external-worker/src/index.js 의 데이터 큐 polling/처리 로직
  - external-worker/src/prompts.js 및 worker/index.js 의 수행 중 데이터 요청 프롬프트

주의:
- 회사 PC의 환경변수, DB, 업로드 파일, node_modules, .next는 덮어쓰지 마세요.
- 회사 PC의 워커 설정 파일, 설치 스크립트 실행 상태, 등록된 워커 정보는 덮어쓰거나 초기화하지 마세요.
- 회사 PC의 Codex 설정/캐시/세션/개인 토큰도 덮어쓰거나 가져가지 마세요.
- 먼저 diff를 분석하고, 어떤 파일을 반영할지 목록을 보여준 뒤 적용해주세요.
- package.json/package-lock.json 변경은 실제 의존성 변화가 있을 때만 반영해주세요.
- 반영 후 npm run build, node -c worker/index.js, node -c external-worker/src/index.js를 실행해주세요.`;

export default function CompanyExportGuidePage() {
  return (
    <GuideShell
      title="📦 회사 반영 Export 가이드"
      subtitle="개인 PC에서 실험한 jjongqa V2 변경분을 회사 PC 레포에 안전하게 선별 반영하는 방법입니다."
      meta={
        <>
          <strong>목표:</strong> 전체 덮어쓰기 금지. 압축본을 회사 PC에 가져간 뒤 Claude에게 diff 기반으로 필요한 파일만 반영시킵니다.
        </>
      }
    >
      <StepCard num={1} title="현재 작업본 위치에서 변경 파일 확인">
        <Howto>
          <li>터미널에서 작업 폴더로 이동합니다.</li>
          <li><Code>git status --short</Code>로 변경 파일 목록을 확인합니다.</li>
          <li>회사에 가져갈 범위가 설계/작성/가이드 중심인지 한 번 훑어봅니다.</li>
          <li>워커 운영 환경을 바꾸는 변경은 회사 반영 대상에서 제외합니다.</li>
        </Howto>
        <Preview label="확인 명령">
{`cd /Users/jjong/Documents/Claude/jjongqa_v2
git status --short
git diff --stat`}
        </Preview>
      </StepCard>

      <StepCard num={2} title="안전 압축 만들기">
        <p className="text-sm text-neutral-700">
          소스와 설정 파일만 가져가고, 로컬 실행 산출물과 개인정보성 DB는 제외합니다.
        </p>
        <Preview label="권장 zip 명령">
{ZIP_COMMAND}
        </Preview>
        <Note variant="warn" title="반드시 제외">
          <Code>node_modules</Code>, <Code>.next</Code>, <Code>data/*.db</Code>, <Code>uploads</Code>, <Code>results</Code>, <Code>tc-gen-output</Code>는 회사 레포에 덮지 않는 쪽이 안전합니다.
        </Note>
        <Note variant="warn" title="회사 워커 환경은 건드리지 않기">
          회사 PC에 이미 연결된 외부 워커의 설치 상태, 등록 정보, 토큰, 환경변수, 실행 경로는 압축본 기준으로 덮거나 초기화하지 않습니다.
          워커 파일은 설계/작성 잡 처리에 필요한 코드 diff만 확인하고, 운영 환경 변경은 별도 승인 전까지 제외하세요.
        </Note>
        <Note variant="warn" title="Codex 환경도 제외">
          개인 PC의 Codex 설정, 스킬, 플러그인, 캐시, 세션, MCP/connector 설정, API 키/토큰은 회사 PC로 가져가지 않습니다.
          회사 반영에는 앱 코드 diff만 사용하고 Codex 로컬 환경은 참고 대상에서 제외하세요.
        </Note>
      </StepCard>

      <StepCard num={3} title="회사 PC에서 Claude에게 선별 반영 요청">
        <p className="text-sm text-neutral-700">
          압축을 회사 PC에 풀고, 회사 레포와 작업본을 비교해서 필요한 부분만 반영하라고 요청합니다.
        </p>
        <Preview label="회사 반영용 프롬프트">
{COMPANY_PROMPT}
        </Preview>
      </StepCard>

      <StepCard num={4} title="반영 후 검증">
        <Howto>
          <li><Code>npm run build</Code>로 Next 빌드와 타입 체크를 확인합니다.</li>
          <li><Code>node -c worker/index.js</Code>로 내장 워커 문법을 확인합니다.</li>
          <li><Code>node -c external-worker/src/index.js</Code>로 외부 워커 문법을 확인합니다.</li>
          <li>회사 워커 재설치/재등록/재시작은 하지 않습니다. 실제 워커 연결 검증은 회사 환경 담당 승인 후 별도로 진행합니다.</li>
          <li>Codex 설정/스킬/플러그인/세션은 검증 대상이 아니며 회사 PC에 복사하지 않습니다.</li>
        </Howto>
        <Preview label="검증 명령">
{`npm run build
node -c worker/index.js
node -c external-worker/src/index.js`}
        </Preview>
      </StepCard>

      <Card>
        <h2 className="text-base font-semibold">가져가면 좋은 폴더/파일</h2>
        <div className="mt-3 grid gap-2 text-sm text-neutral-700 md:grid-cols-2">
          {["app", "lib", "worker", "external-worker", "shared", "tailwind.config.mjs", "package.json", "package-lock.json", "tsconfig.json", "next.config.mjs"].map((name) => (
            <div key={name} className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs">{name}</div>
          ))}
        </div>
      </Card>

      <div className="space-y-2">
        <Faq q="그냥 회사 레포에 통째로 덮어써도 되나요?">
          추천하지 않습니다. 회사 PC의 DB, 환경변수, 워커 설정, 업로드 파일이 다를 수 있어서 diff 기반 선별 반영이 안전합니다. 특히 회사 외부 워커 환경은 이미 운영 중인 상태 그대로 두는 쪽이 좋습니다.
        </Faq>
        <Faq q="zip 생성 기능을 앱에서 자동으로 만들 필요가 있나요?">
          지금 단계에서는 가이드만으로 충분합니다. 나중에 반복 작업이 많아지면 변경 파일 목록/zip 명령 복사/프롬프트 복사 버튼을 실제 기능으로 올리면 됩니다.
        </Faq>
      </div>

      <div className="text-sm">
        → <Link href="/guide" className="text-kurly-500 underline">가이드 목록</Link>으로 돌아가기
      </div>
    </GuideShell>
  );
}
