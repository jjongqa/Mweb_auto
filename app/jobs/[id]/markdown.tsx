// 매우 가벼운 마크다운 렌더러 — 외부 패키지 의존성 없이 헤딩/리스트/볼드/인라인코드/링크만 지원.
// 풀 마크다운 필요 시 react-markdown 도입 권장.

import React from "react";

function processInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // 인라인 코드 → ` ` , 볼드 → ** ** , 링크 → [text](url) 순으로 분해
  // 간단히 정규식 split. 우선순위: 코드 → 링크 → 볼드
  const tokens = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  let key = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok.startsWith("`") && tok.endsWith("`")) {
      out.push(<code key={key++} className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**") && tok.endsWith("**")) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("[") && tok.includes("](")) {
      const m = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        out.push(
          <a key={key++} href={m[2]} target="_blank" rel="noreferrer" className="text-kurly-500 underline">
            {m[1]}
          </a>
        );
        continue;
      }
      out.push(tok);
    } else {
      out.push(tok);
    }
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 코드 블록 ```
    if (line.startsWith("```")) {
      const start = i + 1;
      let end = start;
      while (end < lines.length && !lines[end].startsWith("```")) end++;
      const code = lines.slice(start, end).join("\n");
      blocks.push(
        <pre key={key++} className="my-3 overflow-x-auto rounded-md bg-neutral-900 p-3 font-mono text-xs leading-relaxed text-neutral-100">
          {code}
        </pre>
      );
      i = end + 1;
      continue;
    }

    // 헤딩
    if (line.startsWith("### ")) {
      blocks.push(<h4 key={key++} className="mt-5 text-sm font-semibold text-neutral-800">{processInline(line.slice(4))}</h4>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(<h3 key={key++} className="mt-6 border-b border-neutral-200 pb-1.5 text-base font-bold text-neutral-900">{processInline(line.slice(3))}</h3>);
      i++; continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(<h2 key={key++} className="mt-2 text-lg font-bold text-neutral-900">{processInline(line.slice(2))}</h2>);
      i++; continue;
    }

    // 리스트 (- 또는 *)
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-2 ml-5 list-disc space-y-1 text-sm leading-relaxed text-neutral-700">
          {items.map((it, idx) => <li key={idx}>{processInline(it)}</li>)}
        </ul>
      );
      continue;
    }

    // 빈 줄
    if (line.trim() === "") {
      blocks.push(<div key={key++} className="h-2" />);
      i++; continue;
    }

    // 일반 문단
    blocks.push(
      <p key={key++} className="my-1 text-sm leading-relaxed text-neutral-700">
        {processInline(line)}
      </p>
    );
    i++;
  }

  return <div>{blocks}</div>;
}
