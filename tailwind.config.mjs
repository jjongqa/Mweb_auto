/** @type {import('tailwindcss').Config} */

// ── KPDS(Kurly Product Design System) 토큰 ──
// 출처: github.com/thefarmersfront/kpds-web · packages/tokens/src
// purple = 브랜드(950=#5F0080), gray = 중립(쿨톤). KPDS는 50=밝음 → 950=어두움(Tailwind와 동일 방향).
// 50~300 = 표면/테두리(KPDS 라이트 그대로). 400~700 = 텍스트용 — 가독성 위해 한 단계씩 어둡게 조정.
// (KPDS 원본 gray는 흰 배경에서 400~600이 너무 옅어 메타텍스트가 안 읽힘 → 텍스트 단계만 다운시프트)
const kpdsGray = {
  50: "#F2F5F8",
  100: "#ECEFF3",
  200: "#DFE4EB",
  300: "#CBD1D7",
  400: "#848F9A", // 메타/캡션 (KPDS gray600) — 흰 배경 가독 확보
  500: "#6B747F", // 보조 텍스트
  600: "#565E67", // 보조-강조 (KPDS gray700)
  700: "#464C52", // 본문 (KPDS gray800)
  800: "#393D41", // (KPDS gray850)
  850: "#2E3236",
  900: "#222222", // 제목 (KPDS gray900)
  950: "#1C1C1C",
};

const kpdsPurple = {
  50: "#F5EFFA",
  100: "#E8DBF3",
  200: "#DCC7ED",
  300: "#C7A8E1",
  400: "#9747FF",
  500: "#5F0080",
  600: "#4D0066",
  700: "#3B0050",
  800: "#2D003D",
  900: "#22002E",
};

const kpdsMint = {
  50: "#E8F7FA",
  100: "#D8F1F6",
  200: "#B9E6EF",
  300: "#8AD4E3",
  400: "#69C9DD",
  500: "#4DBED7",
  600: "#3AA7BF",
  700: "#1F7E95",
  800: "#176276",
  900: "#10495A",
};

const kpdsSale = {
  50: "#FBE4E4",
  100: "#F9D1D1",
  200: "#F3A9AA",
  300: "#EC7778",
  400: "#E64F50",
  500: "#E22D2E",
  600: "#C92021",
  700: "#A81A1B",
  800: "#801516",
  900: "#5E1011",
};

const kpdsWarn = {
  50: "#FFF7E6",
  100: "#FFEDC2",
  200: "#FFDC8A",
  300: "#FFC54D",
  400: "#FBB234",
  500: "#F5A623",
  600: "#D98A0A",
  700: "#9A6300",
  800: "#714900",
  900: "#523500",
};

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 브랜드 — kurly-500 = KPDS purple950(#5F0080) 유지(앱 primary). 50/100/200 = KPDS 라이트 퍼플.
        kurly: {
          ...kpdsPurple,
        },
        // 중립 — Tailwind 기본 neutral 을 KPDS gray 로 덮어씀 → 전 페이지 자동 KPDS 톤(쿨 그레이)
        neutral: kpdsGray,
        // KPDS 시맨틱 alias. 기존 Tailwind color class를 대거 쓰고 있어 동일 키를 KPDS 톤으로 맞춘다.
        mint: kpdsMint,
        sale: kpdsSale,
        warn: kpdsWarn,
        emerald: kpdsMint,
        rose: kpdsSale,
        red: kpdsSale,
        amber: kpdsWarn,
        yellow: kpdsWarn,
        blue: kpdsMint,
        violet: kpdsPurple,
        purple: kpdsPurple,
      },
      borderRadius: {
        kpds: "8px", // KPDS radius $8
        "kpds-lg": "12px", // KPDS radius $12
      },
      boxShadow: {
        kpds1: "0px 2px 2px 0px rgba(0, 0, 0, 0.03)",
        kpds2: "0px 0px 4px 0px rgba(0, 0, 0, 0.15)",
        kpds3: "2px 2px 10px 0px rgba(0, 0, 0, 0.10)",
      },
      fontFamily: {
        // KPDS 폰트 스택 (Pretendard 우선)
        sans: [
          "Pretendard",
          '"Pretendard Variable"',
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          '"Apple SD Gothic Neo"',
          '"Noto Sans KR"',
          '"Malgun Gothic"',
          "sans-serif",
        ],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
