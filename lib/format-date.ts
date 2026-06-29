// SQLite 의 datetime('now') 는 UTC 를 ISO-like 문자열로 저장.
// JS Date 가 그걸 UTC 로 인식하도록 'Z' 를 붙여서 해석.
// 그 다음 ko-KR 로컬 시간으로 표시.

export function formatDateTimeKR(value: string | null | undefined): string {
  if (!value) return "-";
  // 이미 Z 또는 +xx:xx 있으면 그대로, 없으면 UTC 로 간주
  const hasTimezone = value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value);
  const isoLike = hasTimezone ? value : value.replace(" ", "T") + "Z";
  const d = new Date(isoLike);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// 상대 시각 — heartbeat 신선도 등 "얼마나 지났나" 표시용. 예: "방금", "12초 전", "3분 전".
// 서버 렌더 시점(≈now) 기준. 자동 갱신과 함께 쓰면 매 갱신마다 최신값.
export function formatRelativeKR(value: string | null | undefined): string {
  if (!value) return "-";
  const hasTimezone = value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value);
  const isoLike = hasTimezone ? value : value.replace(" ", "T") + "Z";
  const t = new Date(isoLike).getTime();
  if (Number.isNaN(t)) return value;
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 0) return "방금";
  if (diffSec < 10) return "방금";
  if (diffSec < 60) return `${diffSec}초 전`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return `${Math.floor(diffSec / 86400)}일 전`;
}

// 초 단위 실행 시간을 사람이 읽기 쉽게. 예: 95 → "1분 35초", 3725 → "1시간 2분"
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "-";
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s > 0 ? `${m}분 ${s}초` : `${m}분`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}시간 ${mm}분` : `${h}시간`;
}
