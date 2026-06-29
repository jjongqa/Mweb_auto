"use client";

// 12x12 픽셀 캐릭터. hat(cap/crown/wizard/helmet/bandana) + exp(smile/neutral/happy/focused/cool) + 색.
function buildGrid(hat: string, exp: string): string[] {
  const g: string[][] = Array.from({ length: 12 }, () => "............".split(""));
  const S = (x: number, y: number, ch: string) => {
    if (x >= 0 && x < 12 && y >= 0 && y < 12) g[y][x] = ch;
  };
  const F = (a: number, b: number, y: number, ch: string) => {
    for (let x = a; x <= b; x++) S(x, y, ch);
  };
  F(2, 9, 4, "s"); F(2, 9, 5, "s"); F(2, 9, 6, "s"); F(2, 9, 7, "s"); F(3, 8, 8, "s");
  F(3, 8, 9, "b"); F(2, 9, 10, "b"); S(5, 10, "w"); S(2, 11, "b"); S(3, 11, "b"); S(8, 11, "b"); S(9, 11, "b");
  if (hat === "cap") { F(4, 7, 0, "c"); F(2, 9, 1, "c"); F(2, 9, 2, "c"); F(1, 10, 3, "k"); }
  else if (hat === "crown") { S(2, 1, "c"); S(4, 1, "c"); S(6, 1, "c"); S(8, 1, "c"); F(2, 9, 2, "c"); F(2, 9, 3, "c"); }
  else if (hat === "wizard") { S(6, 0, "c"); F(5, 6, 1, "c"); F(4, 7, 2, "c"); F(2, 9, 3, "c"); }
  else if (hat === "helmet") { F(3, 8, 0, "c"); F(2, 9, 1, "c"); F(1, 10, 2, "c"); F(1, 10, 3, "c"); S(1, 4, "c"); S(10, 4, "c"); }
  else if (hat === "bandana") { F(4, 7, 0, "k"); F(3, 8, 1, "k"); F(2, 9, 2, "c"); F(2, 9, 3, "c"); S(10, 3, "c"); S(10, 4, "c"); }
  else { F(4, 7, 0, "c"); F(2, 9, 1, "c"); F(2, 9, 2, "c"); F(1, 10, 3, "k"); }
  if (exp === "smile") { S(3, 5, "k"); S(8, 5, "k"); F(4, 7, 7, "m"); }
  else if (exp === "neutral") { S(3, 5, "k"); S(8, 5, "k"); S(5, 7, "m"); S(6, 7, "m"); }
  else if (exp === "happy") { S(3, 5, "k"); S(8, 5, "k"); S(4, 7, "m"); S(7, 7, "m"); S(5, 8, "m"); S(6, 8, "m"); }
  else if (exp === "focused") { S(3, 5, "k"); S(4, 5, "k"); S(7, 5, "k"); S(8, 5, "k"); S(5, 7, "m"); S(6, 7, "m"); }
  else if (exp === "cool") { S(3, 5, "k"); S(7, 5, "k"); S(8, 5, "k"); F(4, 7, 7, "m"); }
  else { S(3, 5, "k"); S(8, 5, "k"); S(5, 7, "m"); S(6, 7, "m"); }
  return g.map((r) => r.join(""));
}

export function PixelAgent({
  hat,
  exp,
  c,
  b,
  s,
  size = 48,
  hop = false,
}: {
  hat: string;
  exp: string;
  c: string;
  b: string;
  s: string;
  size?: number;
  hop?: boolean;
}) {
  const grid = buildGrid(hat, exp);
  const cm: Record<string, string> = { c, b, s, k: "#241a12", m: "#7a3b2e", w: "#ffffff" };
  const cell = 4;
  const rects: React.ReactNode[] = [];
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const ch = grid[y][x];
      if (ch === ".") continue;
      const fill = cm[ch];
      if (!fill) continue;
      rects.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={fill} />);
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={hop ? "agent-hop" : undefined}
      style={{ imageRendering: "pixelated", display: "block" }}
    >
      {rects}
    </svg>
  );
}
