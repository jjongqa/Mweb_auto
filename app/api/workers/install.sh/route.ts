import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // 어드민 URL 자동 추출 (요청 origin = 워커가 접속할 어드민 주소)
  const host = req.headers.get("host") || new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const adminUrl = `${proto}://${host}`;

  const script = `#!/usr/bin/env bash
# Kurly QA Worker — 자동 부트스트랩
# 사용법: curl -fsSL ${adminUrl}/api/workers/install.sh | bash

set -e

ADMIN_URL="\${ADMIN_URL:-${adminUrl}}"
INSTALL_DIR="\${INSTALL_DIR:-$HOME/kurly-qa-worker-v1}"
INSTALL_APP="\${INSTALL_APP:-no}"  # yes 로 주면 App 자동화도 셋업 (.env 의 WORKER_CAN_APP=true)

bold() { printf "\\033[1m%s\\033[0m\\n" "$1"; }
ok()   { printf "\\033[32m✓\\033[0m %s\\n" "$1"; }
warn() { printf "\\033[33m⚠\\033[0m %s\\n" "$1"; }
err()  { printf "\\033[31m✗\\033[0m %s\\n" "$1"; }

bold "🔧 Kurly QA Worker 자동 설치"
echo "  어드민: $ADMIN_URL"
echo "  설치 위치: $INSTALL_DIR"
echo ""

# 1. Node.js 체크 + (macOS) Homebrew 경유 자동 설치
need_node=false
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js 미설치 — 자동 설치 시도"
  need_node=true
elif [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  warn "Node.js 18+ 필요 (현재: $(node --version)) — 자동 업그레이드 시도"
  need_node=true
fi

if [ "$need_node" = true ]; then
  if [ "$(uname)" != "Darwin" ]; then
    err "자동 Node 설치는 macOS 만 지원합니다."
    echo "  https://nodejs.org/ 에서 LTS 설치 후 재실행하세요."
    exit 1
  fi

  echo ""
  bold "📦 Node.js 자동 설치 (Homebrew 경유)"
  echo "  ※ Homebrew 설치 단계에서 sudo 비밀번호를 한 번 물어볼 수 있습니다."
  echo ""

  # Homebrew 체크/설치
  if ! command -v brew >/dev/null 2>&1; then
    warn "Homebrew 도 미설치 — Homebrew 부터 자동 설치"
    if ! NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
      err "Homebrew 설치 실패 — https://brew.sh 참고해서 수동 설치 후 재시도"
      exit 1
    fi
    # Apple Silicon (/opt/homebrew) / Intel (/usr/local) 경로 모두 시도
    if [ -x /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -x /usr/local/bin/brew ]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew 설치 완료"
  fi

  # Node 설치
  echo "📦 brew install node ..."
  if ! brew install node; then
    err "brew install node 실패 — https://nodejs.org/ 에서 수동 설치"
    exit 1
  fi
  ok "Node.js $(node --version) 설치 완료"
else
  ok "Node.js $(node --version)"
fi

# 2. 기존 워커명 보존 (재설치=업데이트는 같은 워커로 잡아야 함 — 새 id 발급 시 옛 워커가 좀비로 남아 업데이트 배너 오인 + 워커목록 중복)
PRESERVE_WORKER_NAME=""
if [ -f "$INSTALL_DIR/.env" ]; then
  PRESERVE_WORKER_NAME=$(grep -E "^WORKER_NAME=" "$INSTALL_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' \\r\\n')
  [ -n "$PRESERVE_WORKER_NAME" ] && ok "기존 워커명 보존: $PRESERVE_WORKER_NAME (업데이트=같은 워커)"
fi

# 3. 기존 설치 백업
if [ -d "$INSTALL_DIR" ]; then
  STAMP=$(date +%Y%m%d_%H%M%S)
  warn "기존 \${INSTALL_DIR} → \${INSTALL_DIR}.bak.\${STAMP} 로 백업"
  mv "$INSTALL_DIR" "\${INSTALL_DIR}.bak.\${STAMP}"
fi

# 3. 워커 zip 다운로드
TMPZIP=$(mktemp -t kurly-worker.XXXXXX).zip
echo "📥 워커 패키지 다운로드..."
if ! curl -fSL "$ADMIN_URL/api/workers/download" -o "$TMPZIP"; then
  err "다운로드 실패 — 어드민이 켜져있고 네트워크가 연결되어 있는지 확인하세요"
  exit 1
fi
ok "다운로드 완료"

# 4. 압축 해제
PARENT=$(dirname "$INSTALL_DIR")
mkdir -p "$PARENT"
ditto -x -k "$TMPZIP" "$PARENT"
rm "$TMPZIP"
ok "압축 해제: $INSTALL_DIR"

cd "$INSTALL_DIR"

# 5. setup 실행 (-y: 모든 prompt 기본값 자동 수락)
echo ""
bold "⚙️  의존성 + Playwright + .env 자동 셋업"
echo "  (수 분 소요. Chromium 다운로드가 가장 오래 걸림)"
echo ""
npm run setup -- -y || warn "setup 일부 실패 — 결과 요약 확인하세요"

# 6. .env 의 CENTRAL_URL / WORKER_CAN_APP 강제 세팅
if [ -f .env ]; then
  if grep -q "^CENTRAL_URL=" .env; then
    sed -i.bak "s|^CENTRAL_URL=.*|CENTRAL_URL=$ADMIN_URL|" .env && rm -f .env.bak
  else
    echo "CENTRAL_URL=$ADMIN_URL" >> .env
  fi
  ok "CENTRAL_URL=$ADMIN_URL 로 설정"

  # 보존된 워커명 복원 — 업데이트가 새 워커 행을 만들지 않게(같은 워커로 버전만 갱신)
  if [ -n "$PRESERVE_WORKER_NAME" ]; then
    if grep -q "^WORKER_NAME=" .env; then
      sed -i.bak "s|^WORKER_NAME=.*|WORKER_NAME=$PRESERVE_WORKER_NAME|" .env && rm -f .env.bak
    else
      echo "WORKER_NAME=$PRESERVE_WORKER_NAME" >> .env
    fi
    ok "워커명 유지: $PRESERVE_WORKER_NAME"
  fi

  if [ "$INSTALL_APP" = "yes" ]; then
    if grep -q "^WORKER_CAN_APP=" .env; then
      sed -i.bak "s|^WORKER_CAN_APP=.*|WORKER_CAN_APP=true|" .env && rm -f .env.bak
    else
      echo "WORKER_CAN_APP=true" >> .env
    fi
    ok "WORKER_CAN_APP=true 로 설정 (App 자동화 활성화)"
    echo ""
    bold "📱 App 자동화 사용 시 추가 설치 필요 (자동화 X)"
    echo "  - iOS:     Xcode + Xcode Command Line Tools (App Store)"
    echo "  - Android: Android Studio + ADB (https://developer.android.com/studio)"
    echo "  - 실기기 연결 또는 시뮬레이터/에뮬레이터 실행 후 워커 시작"
  fi
fi

# 6.5 QA-Cowork 자산 (prompts / knowledge / CLAUDE.md) 다운로드
QA_COWORK_HOME="\$HOME/Documents/QA-Cowork/AI_Test"
echo ""
bold "📚 QA-Cowork 자산 다운로드 (prompts / knowledge / CLAUDE.md)"

# ⚠️ 다운로드가 성공한 뒤에만 기존 자산을 백업·교체한다.
#    (먼저 mv 했다가 다운로드 실패하면 기존 홈이 통째로 사라지는 사고 방지)
TMPCOWORK=$(mktemp -t qa-cowork.XXXXXX).zip
if curl -fSL "$ADMIN_URL/api/qa-cowork/download" -o "\$TMPCOWORK"; then
  if [ -d "\$QA_COWORK_HOME" ]; then
    COWORK_STAMP=$(date +%Y%m%d_%H%M%S)
    warn "기존 \$QA_COWORK_HOME → \${QA_COWORK_HOME}.bak.\${COWORK_STAMP} 백업"
    mv "\$QA_COWORK_HOME" "\${QA_COWORK_HOME}.bak.\${COWORK_STAMP}"
  fi
  mkdir -p "\$QA_COWORK_HOME"
  ditto -x -k "\$TMPCOWORK" "\$QA_COWORK_HOME"
  rm "\$TMPCOWORK"
  ok "QA-Cowork 자산 설치: \$QA_COWORK_HOME"

  # .env 의 QA_COWORK_HOME 강제 세팅
  if [ -f .env ]; then
    if grep -q "^QA_COWORK_HOME=" .env; then
      sed -i.bak "s|^QA_COWORK_HOME=.*|QA_COWORK_HOME=\$QA_COWORK_HOME|" .env && rm -f .env.bak
    else
      echo "QA_COWORK_HOME=\$QA_COWORK_HOME" >> .env
    fi
  fi
else
  err "QA-Cowork 다운로드 실패 — 어드민이 켜져있는지 확인. 기존 QA-Cowork 자산은 그대로 유지됩니다."
  rm -f "\$TMPCOWORK"
fi

# 6.6 하네스(커머스+물류 TC생성 엔진) 다운로드 + python deps — 이게 있어야 이 워커가 하네스 잡 실행 가능
HARNESS_HOME="\$HOME/kurly-qa-harness"
echo ""
bold "🧬 하네스(TC생성 엔진) 다운로드"
TMPHARNESS=$(mktemp -t kurly-harness.XXXXXX).zip
if curl -fSL "$ADMIN_URL/api/workers/harness.zip" -o "\$TMPHARNESS"; then
  if [ -d "\$HARNESS_HOME" ]; then
    HARNESS_STAMP=$(date +%Y%m%d_%H%M%S)
    warn "기존 \$HARNESS_HOME → \${HARNESS_HOME}.bak.\${HARNESS_STAMP} 백업"
    mv "\$HARNESS_HOME" "\${HARNESS_HOME}.bak.\${HARNESS_STAMP}"
  fi
  mkdir -p "\$HARNESS_HOME"
  ditto -x -k "\$TMPHARNESS" "\$HARNESS_HOME"
  rm "\$TMPHARNESS"
  ok "하네스 설치: \$HARNESS_HOME"

  # .env 에 KURLY_HARNESS_PATH 세팅 (워커가 dotenv 로 읽음)
  if [ -f .env ]; then
    if grep -q "^KURLY_HARNESS_PATH=" .env; then
      sed -i.bak "s|^KURLY_HARNESS_PATH=.*|KURLY_HARNESS_PATH=\$HARNESS_HOME|" .env && rm -f .env.bak
    else
      echo "KURLY_HARNESS_PATH=\$HARNESS_HOME" >> .env
    fi
    ok "KURLY_HARNESS_PATH=\$HARNESS_HOME"
  fi

  # python3 + 하네스 deps (xlsx 파싱/생성/어댑터). PEP668(externally-managed) 환경은 --break-system-packages 폴백.
  if command -v python3 >/dev/null 2>&1; then
    echo "🐍 python deps 설치 (openpyxl/xlsxwriter/pyyaml/allpairspy)..."
    python3 -m pip install --user --quiet openpyxl xlsxwriter pyyaml allpairspy 2>/dev/null ||
      python3 -m pip install --user --break-system-packages --quiet openpyxl xlsxwriter pyyaml allpairspy 2>/dev/null ||
      warn "python deps 설치 실패 — 수동: python3 -m pip install --user openpyxl xlsxwriter pyyaml allpairspy"
    ok "python deps 처리 완료"
  else
    warn "python3 미설치 — 하네스 xlsx 변환 불가. macOS: brew install python 후 deps 설치 필요"
  fi
else
  warn "하네스 다운로드 실패 — 어드민에 KURLY_HARNESS_PATH 설정됐는지 확인. 이 워커는 하네스 잡 실행 불가(레거시 TC생성은 정상)."
  rm -f "\$TMPHARNESS"
fi

# 7. Claude Code CLI 자동 설치 (npm global)
CLAUDE_INSTALLED=false
if command -v claude >/dev/null 2>&1; then
  ok "Claude CLI 이미 존재: $(claude --version 2>&1 | head -1)"
  CLAUDE_INSTALLED=true
else
  echo ""
  bold "📦 Claude Code CLI 자동 설치 (npm i -g @anthropic-ai/claude-code)"
  if npm i -g @anthropic-ai/claude-code; then
    ok "Claude CLI 설치 완료"
    CLAUDE_INSTALLED=true
  else
    warn "자동 설치 실패 — 권한 문제일 가능성"
    echo "  수동 시도: sudo npm i -g @anthropic-ai/claude-code"
    CLAUDE_INSTALLED=false
  fi
fi

echo ""
bold "✅ 자동 설치 단계 완료!"
echo ""

# 마지막 수동 단계: Claude 회사 계정 로그인 (OAuth 라 자동화 불가)
bold "🔐 마지막 한 단계: Claude 회사 계정 로그인 (한 번만)"
if [ "$CLAUDE_INSTALLED" = true ]; then
  echo "  새 Terminal 창에서 아래 명령을 실행하세요:"
else
  echo "  Claude CLI 수동 설치 후 아래 명령을 실행하세요:"
fi
printf "\\n  \\033[36mclaude\\033[0m\\n\\n"
echo "  → 브라우저가 자동으로 열림 → Claude 회사 계정 계정으로 로그인"
echo ""

# 워커 시작 안내
bold "▶️  로그인 완료 후, 워커 시작:"
printf "\\n  \\033[36mcd $INSTALL_DIR && npm start\\033[0m\\n\\n"
echo "워커가 시작되면 어드민 워커 목록에 자동 등록됩니다."
echo "  → $ADMIN_URL/workers"
echo ""
`;

  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
