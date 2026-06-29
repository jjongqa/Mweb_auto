#!/bin/bash
# Graceful shutdown — Ctrl+C 대신 이걸 호출하면 WAL 체크포인트까지 깔끔히 정리.
# 사용: ./scripts/shutdown.sh
# 또는: npm run shutdown (package.json scripts 등록 시)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DB="$ROOT/data/qa-admin.db"

echo "[shutdown] root: $ROOT"

# 1) dev 프로세스 SIGTERM (web + worker)
killed=0
for pat in "next dev -p 3000" "next-server" "node worker/index.js" "concurrently"; do
  pids="$(pgrep -f "$pat" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "[shutdown] SIGTERM '$pat' (pids: $pids)"
    kill -TERM $pids 2>/dev/null || true
    killed=$((killed + 1))
  fi
done

# 2) 5초 대기 후 잔존 프로세스 SIGKILL
if [ $killed -gt 0 ]; then
  sleep 5
  for pat in "next dev -p 3000" "next-server" "node worker/index.js"; do
    pids="$(pgrep -f "$pat" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "[shutdown] SIGKILL '$pat' (pids: $pids)"
      kill -KILL $pids 2>/dev/null || true
    fi
  done
fi

# 3) SQLite WAL 체크포인트 — 다음 부팅이 깔끔
if [ -f "$DB" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    echo "[shutdown] WAL checkpoint: $DB"
    sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" || echo "[shutdown] checkpoint 실패 (락 충돌 가능성)"
  else
    echo "[shutdown] sqlite3 CLI 없음 — 체크포인트 스킵"
  fi
fi

echo "[shutdown] done"
