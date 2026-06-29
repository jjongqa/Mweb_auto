// 클립보드 복사 — secure context (HTTPS/localhost) 와 HTTP origin (사내 IP) 모두 지원.
// 사용처 모두 동일 헬퍼 사용.

export async function copyToClipboard(text: string): Promise<boolean> {
  // 1차: 최신 Clipboard API (HTTPS 또는 localhost)
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof window !== "undefined" && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 실패 → 폴백
  }

  // 2차: HTTP origin 폴백 — 숨겨진 textarea + execCommand
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
