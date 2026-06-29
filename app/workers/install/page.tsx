"use client";

import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

type WorkerMeta = {
  ok: boolean;
  version: string | null;
  description: string | null;
  changelog: string | null;
  mtime: string | null;
};

export default function InstallPage() {
  const [adminUrl, setAdminUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [includeApp, setIncludeApp] = useState(false);
  const [meta, setMeta] = useState<WorkerMeta | null>(null);

  useEffect(() => {
    setAdminUrl(window.location.origin);
    fetch("/api/workers/meta")
      .then((r) => r.json())
      .then((j) => setMeta(j))
      .catch(() => setMeta(null));
  }, []);

  const envPrefix = includeApp ? "INSTALL_APP=yes " : "";
  const oneLiner = adminUrl
    ? `curl -fsSL ${adminUrl}/api/workers/install.sh | ${envPrefix}bash`
    : "...";

  const copy = async () => {
    const ok = await copyToClipboard(oneLiner);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      alert("복사가 안 되네요. 명령어를 마우스로 드래그해서 직접 복사해주세요.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">워커 설치 가이드</h1>
        <p className="mt-2 text-sm text-neutral-600">
          처음이신가요? <strong>아래 순서대로만 따라하시면 됩니다</strong>. 어려운 거 없어요.
        </p>
        <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
          <strong>⏱ 예상 소요시간:</strong> 10~20분 (Chromium 다운로드가 가장 오래 걸려요)
          <br />
          <strong>💻 지원 환경:</strong> macOS (Intel / Apple Silicon 둘 다 OK)
          <br />
          <strong>🧰 필요한 것:</strong> 본인 Mac의 로그인 비밀번호 (한 번만 입력)
        </div>
      </div>

      {/* 옵션 토글 */}
      <Card>
        <h2 className="text-base font-semibold">📱 옵션: 모바일 앱 자동화도 함께 설치할까요?</h2>
        <p className="mt-1 text-xs text-neutral-500">
          PC 웹만 테스트하시면 끄세요. iOS/Android 앱 테스트도 한다면 켜세요.
        </p>
        <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 hover:bg-neutral-100">
          <input
            type="checkbox"
            checked={includeApp}
            onChange={(e) => setIncludeApp(e.target.checked)}
            className="h-5 w-5 rounded border-neutral-300"
          />
          <span className="text-sm">
            <strong>모바일 앱 자동화 포함</strong>
            <span className="ml-2 text-xs text-neutral-500">
              (켜면 Xcode 또는 Android Studio 별도 설치 안내 추가)
            </span>
          </span>
        </label>
      </Card>

      {/* STEP 1: Terminal 열기 */}
      <StepCard num={1} title="Terminal 앱 열기">
        <p className="text-sm text-neutral-700">
          Mac 의 <strong>"명령어 입력 창"</strong> 입니다. 검은 화면이 나오는 그거 맞아요.
        </p>
        <Howto>
          <li>
            키보드에서 <Key>⌘</Key> + <Key>Space</Key> 눌러서 검색창 열기
          </li>
          <li>
            <Code>terminal</Code> 입력 → <Key>Enter</Key>
          </li>
        </Howto>
        <Preview label="이런 검은 창이 뜨면 성공!">
          {`Last login: Mon Jun  9 10:23:45 on console
yourname@MacBookPro ~ %`}
        </Preview>
      </StepCard>

      {/* STEP 2: 명령어 복사 */}
      <StepCard num={2} title="아래 명령어를 복사하기">
        <p className="text-sm text-neutral-700">
          <strong>오른쪽 "복사" 버튼</strong>만 누르면 자동으로 복사됩니다.
        </p>

        <div className="mt-3 flex items-start gap-2 rounded-lg bg-neutral-900 p-4 font-mono text-xs text-neutral-100">
          <code className="flex-1 break-all">{oneLiner}</code>
          <button
            onClick={copy}
            className="shrink-0 rounded-md bg-kurly-500 px-3 py-2 text-sm font-medium text-white hover:bg-kurly-600"
          >
            {copied ? "✓ 복사됨" : "📋 복사"}
          </button>
        </div>

        {includeApp && (
          <p className="mt-2 text-xs text-neutral-500">
            (모바일 앱 옵션이 켜져 있어서 명령어 끝에 <code>INSTALL_APP=yes bash</code> 가 포함됐어요)
          </p>
        )}
      </StepCard>

      {/* STEP 3: 붙여넣기 */}
      <StepCard num={3} title="Terminal 에 붙여넣고 실행">
        <Howto>
          <li>
            방금 열어둔 Terminal 창을 <strong>클릭</strong> (창이 활성화돼야 함)
          </li>
          <li>
            <Key>⌘</Key> + <Key>V</Key> 눌러서 붙여넣기
          </li>
          <li>
            <Key>Enter</Key> 한 번 더 눌러서 실행
          </li>
        </Howto>
        <Preview label="이런 식으로 시작되면 OK">
          {`🔧 Kurly QA Worker 자동 설치
  어드민: ${adminUrl || "http://..."}
  설치 위치: /Users/yourname/kurly-qa-worker-v1

✓ Node.js v20.x.x
📥 워커 패키지 다운로드...`}
        </Preview>
      </StepCard>

      {/* STEP 4: 비밀번호 */}
      <StepCard num={4} title="비밀번호 입력 (Node 미설치 시 한 번)">
        <p className="text-sm text-neutral-700">
          중간에 <strong>비밀번호 화면</strong>이 나오면 본인 Mac 의 <strong>로그인 비밀번호</strong>를 입력하세요.
        </p>
        <div className="mt-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>⚠️ 비밀번호 입력 시 글자가 안 보입니다 — 정상입니다!</strong>
          <br />
          (보안 때문에 별표나 점도 안 나와요. 그냥 입력 후 <Key>Enter</Key>)
        </div>
        <Preview label="이런 화면이 나오면">
          {`Password:`}
        </Preview>
        <p className="mt-2 text-xs text-neutral-600">
          이미 Node 가 깔려 있으면 이 화면은 안 나옵니다. 그냥 넘어가세요.
        </p>
      </StepCard>

      {/* STEP 5: 기다리기 */}
      <StepCard num={5} title="설치 끝날 때까지 기다리기 (5~15분)">
        <p className="text-sm text-neutral-700">
          여러 단계가 자동으로 실행됩니다. <strong>Terminal 창은 닫지 마세요</strong>. 다른 일은 하셔도 OK.
        </p>
        <ul className="mt-3 ml-4 list-disc text-xs text-neutral-600 space-y-1">
          <li>워커 패키지 다운로드</li>
          <li>의존성 설치 (<code>npm install</code>)</li>
          <li>Playwright 브라우저 다운로드 (약 200MB — 여기가 제일 오래 걸려요)</li>
          <li>Playwright MCP / Mobile MCP 캐싱</li>
          <li>Claude Code CLI 설치</li>
        </ul>
        <Preview label="이 화면이 나오면 설치 완료!">
          {`✅ 자동 설치 단계 완료!

🔐 마지막 한 단계: Claude 회사 계정 로그인 (한 번만)
  새 Terminal 창에서 아래 명령을 실행하세요:

  claude

▶️  로그인 완료 후, 워커 시작:

  cd /Users/yourname/kurly-qa-worker-v1 && npm start`}
        </Preview>
      </StepCard>

      {/* STEP 6: Claude 로그인 */}
      <StepCard num={6} title="Claude 회사 계정 로그인 (한 번만, 평생 1회)">
        <p className="text-sm text-neutral-700">
          Terminal 에 <strong>아래 한 글자만 입력</strong>하고 Enter:
        </p>
        <CommandBox>claude</CommandBox>
        <Howto>
          <li>입력하고 <Key>Enter</Key></li>
          <li>
            <strong>웹 브라우저가 자동으로 열립니다</strong>
          </li>
          <li>Claude 회사 계정 계정으로 로그인 (회사 계정)</li>
          <li>"로그인 성공" 페이지 나오면 브라우저 닫기</li>
        </Howto>
        <div className="mt-3 rounded-lg border-l-4 border-rose-400 bg-rose-50 p-3 text-xs text-rose-900">
          <strong>⚠️ Claude 회사 계정 계정이 없으면 안 됩니다.</strong>
          <br />
          회사에서 발급받은 Claude 회사 계정 계정 필요. 없으면 종관님께 문의.
        </div>
      </StepCard>

      {/* STEP 7: 워커 시작 */}
      <StepCard num={7} title="워커 시작 — 마지막 단계!">
        <p className="text-sm text-neutral-700">
          Step 5 끝에 나온 <strong>안내 명령어</strong>(파란색)를 그대로 복사해서 붙여넣기:
        </p>
        <CommandBox>cd ~/kurly-qa-worker-v1 && npm start</CommandBox>
        <Preview label="이렇게 떠 있으면 워커 작동 중!">
          {`Kurly QA Worker v1.0
워커 이름: your-mac
중앙 서버: ${adminUrl || "http://..."}
✓ 등록 성공
워커 동작 중. Ctrl+C 로 종료.`}
        </Preview>
        <div className="mt-3 rounded-lg border-l-4 border-emerald-400 bg-emerald-50 p-3 text-xs text-emerald-900">
          <strong>✅ 끝! 이 Terminal 창은 그대로 켜두세요.</strong>
          <br />
          창을 닫으면 워커도 꺼집니다. 작업 다 끝나면 <Key>Ctrl</Key> + <Key>C</Key> 로 끄세요.
        </div>
      </StepCard>

      {/* 확인 */}
      <Card>
        <h2 className="text-base font-semibold">🎉 설치 완료 확인</h2>
        <p className="mt-2 text-sm text-neutral-700">
          아래 페이지에서 본인 PC 이름이 보이면 성공입니다.
        </p>
        <a
          href="/workers"
          className="mt-3 inline-block rounded-md bg-kurly-500 px-4 py-2 text-sm font-medium text-white hover:bg-kurly-600"
        >
          → 워커 목록 페이지 보러가기
        </a>
      </Card>

      {/* FAQ */}
      <Card>
        <h2 className="text-base font-semibold">❓ 자주 묻는 질문 / 문제 해결</h2>
        <div className="mt-4 space-y-4 text-sm">
          <Faq q="Terminal 검색이 안 나와요">
            화면 우상단 <strong>돋보기 🔍</strong> 아이콘 클릭 → "terminal" 검색.
            그래도 안 되면 <code>응용 프로그램 → 유틸리티 → 터미널.app</code>.
          </Faq>
          <Faq q="복사 버튼이 안 눌려요">
            검은 박스 안의 명령어를 <strong>마우스로 드래그해서 선택</strong> → <Key>⌘</Key> + <Key>C</Key> 로 복사.
          </Faq>
          <Faq q="비밀번호 입력해도 별표 ★★★ 가 안 보여요">
            <strong>정상입니다.</strong> Mac Terminal 의 보안 기능이에요. 그냥 입력 후 <Key>Enter</Key>.
          </Faq>
          <Faq q="중간에 빨간 에러가 났어요">
            전체 메시지를 <strong>스크린샷</strong> 찍어서 종관님께 슬랙으로. 대부분 네트워크
            문제이거나 권한 문제예요. 같은 명령어를 다시 한 번 실행하면 풀리는 경우도 많습니다.
          </Faq>
          <Faq q="워커를 끄고 싶어요">
            워커가 돌고 있는 Terminal 창에서 <Key>Ctrl</Key> + <Key>C</Key> 누르세요.
            (Terminal 창 자체를 닫아도 워커는 꺼집니다)
          </Faq>
          <Faq q="다음 날 다시 켜려면?">
            Terminal 열고 <CommandInline>cd ~/kurly-qa-worker-v1 && npm start</CommandInline> 한 줄만. 설치는 한 번만 하면 평생 OK.
          </Faq>
          <Faq q="한 PC 에서 동시에 여러 잡을 돌리고 싶어요">
            기본은 1잡씩 직렬. 환경변수로 조정: <CommandInline>WORKER_MAX_CONCURRENT=2 npm start</CommandInline> (2~3 권장 — REAL 잡 1개당 Chrome+Playwright 가 추가로 뜨므로 PC 사양 고려).
            <br />
            💡 어드민에서 본인 워커 카드의 <strong>"동시 슬롯"</strong> 숫자가 자동으로 갱신됩니다.
          </Faq>
          <Faq q="ERR_ADDRESS_UNREACHABLE 가 떴어요 (어드민에 접속 안 됨)">
            워커 PC 측 ARP/DNS 캐시 문제일 가능성이 큽니다. 순서대로 시도:
            <ol className="ml-5 mt-1 list-decimal text-xs">
              <li>Wi-Fi 껐다 켜기</li>
              <li><CommandInline>sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder</CommandInline></li>
              <li>워커 PC 재부팅 (가장 확실)</li>
            </ol>
          </Faq>
          <Faq q="이미 한 번 설치했는데 다시 누르면 어떻게 돼요?">
            기존 폴더는 <code>{"~/kurly-qa-worker-v1.bak.{날짜}"}</code> 로 자동 백업되고 새로 깔립니다. 안전해요.
          </Faq>
          <Faq q="진짜 모르겠어요. 도와주세요">
            슬랙으로 종관님 멘션. 화면 캡처 같이 보내주시면 더 빠릅니다.
          </Faq>
        </div>
      </Card>

      {/* 이미 설치하신 분 — 재설치 별도 페이지로 안내 */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-emerald-700">🔄 이미 설치하신 분 — 재설치 / 업데이트</h2>
            <p className="mt-1 text-xs text-neutral-600">
              어드민에 새 패치가 반영되면 워커도 함께 업데이트하세요. 한 줄 명령으로 백업+재설치 가능.
              {meta?.version && (
                <span className="ml-1 text-emerald-700">(현재 v{meta.version})</span>
              )}
            </p>
          </div>
          <a
            href="/workers/update"
            className="shrink-0 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
          >
            재설치 페이지 →
          </a>
        </div>
      </Card>

      {/* 수동 다운로드 */}
      <Card>
        <h2 className="text-sm font-semibold text-neutral-600">고급 사용자용: 수동 다운로드</h2>
        <p className="mt-2 text-xs text-neutral-500">
          위 자동 설치가 정 안 될 때만 사용하세요.{" "}
          <a href="/api/workers/download" className="text-kurly-500 underline">
            워커 패키지 직접 다운로드 (.zip)
          </a>
          {" "}→ 풀고 <code>npm install && npm run setup && npm start</code>.
        </p>
      </Card>
    </div>
  );
}

/* ===== 보조 컴포넌트 ===== */

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-5">{children}</div>;
}

function StepCard({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kurly-500 text-base font-bold text-white">
          {num}
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="mt-3 pl-12">{children}</div>
    </div>
  );
}

function Howto({ children }: { children: React.ReactNode }) {
  return <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-neutral-700">{children}</ol>;
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-block min-w-[1.5em] rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-center font-mono text-[11px] font-medium text-neutral-700 shadow-sm">
      {children}
    </kbd>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">{children}</code>
  );
}

function CommandBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg bg-neutral-900 p-3 font-mono text-sm text-neutral-100">
      {children}
    </div>
  );
}

function CommandInline({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-[11px] text-neutral-100">
      {children}
    </code>
  );
}

function Preview({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <pre className="mt-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11px] leading-relaxed text-neutral-700">
        {children}
      </pre>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 open:bg-white">
      <summary className="cursor-pointer text-sm font-medium text-neutral-800">{q}</summary>
      <div className="mt-2 pl-1 text-xs text-neutral-600">{children}</div>
    </details>
  );
}
