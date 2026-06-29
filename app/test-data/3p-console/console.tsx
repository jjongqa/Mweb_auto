"use client";

import { useMemo, useState } from "react";
import { confirmDialog } from "@/app/_components/confirm-dialog";
import { OPENAPI_BASE, type ThreePOp } from "@/lib/threep-openapi-catalog";

interface RunResult {
  ok: boolean;
  status: number;
  durationMs: number;
  url: string;
  method: string;
  contentType?: string;
  data?: unknown;
  error?: string;
}

interface FinderRow {
  orderItemNo: number | string;
  productName?: string;
  status?: string;
  parentOrderNo?: string;
  kafkaOrderNo?: string | number;
}

interface FinderResultRow {
  id: string;
  primary: string;
  secondary?: string;
  tertiary?: string;
}

const METHOD_COLOR: Record<string, string> = {
  GET: "bg-sky-100 text-sky-700",
  POST: "bg-emerald-100 text-emerald-700",
  PUT: "bg-amber-100 text-amber-700",
  DELETE: "bg-rose-100 text-rose-700",
  PATCH: "bg-violet-100 text-violet-700",
};

function placeholders(path: string): string[] {
  return Array.from(path.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
}

export function ThreePConsole({ catalog }: { catalog: ThreePOp[] }) {
  const [selectedId, setSelectedId] = useState<string>(catalog[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [pathVals, setPathVals] = useState<Record<string, string>>({});
  const [queryVals, setQueryVals] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");
  const [tokenOverride, setTokenOverride] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<RunResult | null>(null);
  const [respView, setRespView] = useState<"tree" | "raw">("tree");
  // orderItemNo 찾기 헬퍼
  const [finderType, setFinderType] = useState("PARENT_ORDER_NO");
  const [finderText, setFinderText] = useState("");
  const [finderLoading, setFinderLoading] = useState(false);
  const [finderError, setFinderError] = useState("");
  const [finderResults, setFinderResults] = useState<FinderRow[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailErr, setDetailErr] = useState("");

  const op = useMemo(() => catalog.find((o) => o.id === selectedId), [catalog, selectedId]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? catalog.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.path.toLowerCase().includes(q) ||
            o.method.toLowerCase().includes(q) ||
            o.group.toLowerCase().includes(q)
        )
      : catalog;
    const map = new Map<string, ThreePOp[]>();
    for (const o of filtered) {
      if (!map.has(o.group)) map.set(o.group, []);
      map.get(o.group)!.push(o);
    }
    return Array.from(map.entries());
  }, [catalog, search]);

  function select(o: ThreePOp) {
    setSelectedId(o.id);
    setPathVals({});
    setQueryVals({});
    setBodyText(o.requestBodyExample || "");
    setResp(null);
    setFinderResults([]);
    setFinderText("");
    setFinderError("");
    setDetailErr("");
  }

  // 상세조회로 현재 값을 받아 본문(JSON)에 채움.
  //  - copyKeys(기본): keepKeys 그대로 복사 (상품 수정)
  //  - stockSkeleton: detailOptions → {quantities:[{detailOptionId, operationQuantity:0}]} 골격 (재고 일괄변경)
  async function loadCurrentForEdit() {
    if (!op?.editLoadFrom) return;
    const { path: tpl, idParam, keepKeys, mode = "copyKeys" } = op.editLoadFrom;
    const id = (pathVals[idParam] || "").trim();
    if (!id) {
      setDetailErr(`먼저 위 경로 파라미터 {${idParam}} 값을 입력하세요`);
      return;
    }
    setLoadingDetail(true);
    setDetailErr("");
    try {
      const path = tpl.replace(`{${idParam}}`, encodeURIComponent(id));
      const res = await fetch("/api/test-data/3p-console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "GET", path, accessToken: tokenOverride.trim() || undefined }),
      });
      const data = await res.json();
      const stg = data?.data as { message?: string; data?: Record<string, unknown> } | undefined;
      const product = stg?.data;
      if (!data.ok || !product || typeof product !== "object") {
        setDetailErr(stg?.message || `상세조회 실패 (status ${data?.status ?? "?"})`);
        return;
      }
      if (mode === "stockSkeleton") {
        const detail = (product as Record<string, any>)?.detail;
        const opts = detail?.detailOptions;
        if (!Array.isArray(opts) || opts.length === 0) {
          setDetailErr("이 상품의 옵션(detailOptions)을 찾지 못했습니다");
          return;
        }
        const body = {
          quantities: opts.map((o: Record<string, any>) => ({ detailOptionId: o.id, operationQuantity: 0 })),
        };
        setBodyText(JSON.stringify(body, null, 2));
      } else {
        const body: Record<string, unknown> = {};
        for (const k of keepKeys) {
          if (k in product) body[k] = (product as Record<string, unknown>)[k];
        }
        if (Object.keys(body).length === 0) {
          setDetailErr("상세 응답에서 수정 가능한 필드를 찾지 못했습니다");
          return;
        }
        setBodyText(JSON.stringify(body, null, 2));
      }
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDetail(false);
    }
  }

  // 대표주문번호/상품명 등으로 order-sheets 조회 → orderItemNo 후보 목록
  async function runFinder() {
    if (finderType !== "ALL" && !finderText.trim()) {
      setFinderError("검색어를 입력하세요 (또는 기준을 '전체'로)");
      return;
    }
    setFinderLoading(true);
    setFinderError("");
    setFinderResults([]);
    const now = new Date();
    const start = new Date(now.getTime() - 89 * 24 * 3600 * 1000); // 3개월 이내 제약
    const p2 = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    try {
      const res = await fetch("/api/test-data/3p-console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "GET",
          path: "/open-api/v1/order-sheets",
          query: {
            page: "0",
            size: "50",
            periodSearchType: "NEW_ORDER",
            searchStartAt: fmt(start),
            searchEndAt: fmt(now),
            searchType: finderType,
            searchText: finderText.trim(),
            orderStatusSearchType: "ALL",
          },
          accessToken: tokenOverride.trim() || undefined,
        }),
      });
      const data = await res.json();
      const stg = data?.data as { code?: string; message?: string; data?: { content?: unknown[] } } | undefined;
      if (!data.ok || !stg) {
        setFinderError(`조회 실패 (status ${data?.status ?? "?"})`);
        return;
      }
      const content = stg?.data?.content;
      if (!Array.isArray(content)) {
        setFinderError(stg?.message || "결과 형식을 해석할 수 없음");
        return;
      }
      if (content.length === 0) {
        setFinderError("최근 3개월 내 일치하는 주문이 없습니다");
        return;
      }
      setFinderResults(
        content.map((raw) => {
          const c = raw as Record<string, any>;
          return {
            orderItemNo: c.orderItemNo,
            productName: c.productName,
            status: c?.orderStatus?.text,
            parentOrderNo: c.parentOrderNo,
            kafkaOrderNo: c.kafkaOrderNo,
          } as FinderRow;
        })
      );
    } catch (e) {
      setFinderError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinderLoading(false);
    }
  }

  async function run() {
    if (!op) return;
    if (!op.supported) {
      await confirmDialog({ title: "콘솔 미지원", body: `이 API는 콘솔에서 직접 지원하지 않습니다.\n${op.notes || ""}`, okLabel: "확인" });
      return;
    }

    // 경로 파라미터 치환
    const phs = placeholders(op.path);
    let path = op.path;
    for (const name of phs) {
      const v = (pathVals[name] || "").trim();
      if (!v) {
        await confirmDialog({ title: "경로 값 필요", body: `경로 파라미터 {${name}} 값을 입력하세요.`, okLabel: "확인" });
        return;
      }
      path = path.replace(`{${name}}`, encodeURIComponent(v));
    }

    // 변경 계열 확인
    if (op.category === "write") {
      const ok = await confirmDialog({
        title: op.destructive ? "⚠️ 비가역 변경 호출" : "변경 호출 확인",
        body:
          `${op.method} ${path}\n\n` +
          (op.destructive
            ? "이 호출은 되돌리기 어려운 변경(삭제/강제취소/취소 처리)입니다.\nSTG 실데이터에 영향을 줍니다. 정말 호출할까요?"
            : "이 호출은 STG 데이터를 변경합니다. 호출할까요?"),
        okLabel: "호출",
        danger: op.destructive,
      });
      if (!ok) return;
    }

    setLoading(true);
    setResp(null);
    try {
      const res = await fetch("/api/test-data/3p-console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: op.method,
          path,
          query: queryVals,
          bodyText: op.method === "GET" || op.method === "DELETE" ? "" : bodyText,
          accessToken: tokenOverride.trim() || undefined,
        }),
      });
      const data: RunResult = await res.json();
      setResp(data);
    } catch (e) {
      setResp({ ok: false, status: 0, durationMs: 0, url: "", method: op.method, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  const phs = op ? placeholders(op.path) : [];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
      {/* 좌: 엔드포인트 목록 */}
      <div className="card flex max-h-[78vh] flex-col p-0">
        <div className="border-b border-neutral-200 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="검색 (이름·경로·메서드)"
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-kurly-400 focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {groups.map(([group, ops]) => (
            <div key={group} className="mb-2">
              <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">{group}</div>
              {ops.map((o) => (
                <button
                  key={o.id}
                  onClick={() => select(o)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-50 ${
                    o.id === selectedId ? "bg-kurly-50 ring-1 ring-kurly-200" : ""
                  }`}
                >
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${METHOD_COLOR[o.method] ?? "bg-neutral-100"}`}>
                    {o.method}
                  </span>
                  <span className="flex-1 truncate text-neutral-700">{o.name}</span>
                  {o.destructive && <span className="shrink-0 text-rose-500" title="비가역 변경">●</span>}
                  {!o.supported && <span className="shrink-0 text-neutral-300" title="콘솔 미지원">⊘</span>}
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="p-4 text-center text-sm text-neutral-400">검색 결과 없음</div>}
        </div>
      </div>

      {/* 우: 실행 + 응답 */}
      <div className="space-y-4">
        {op && (
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${METHOD_COLOR[op.method] ?? "bg-neutral-100"}`}>{op.method}</span>
              <h2 className="text-base font-semibold">{op.name}</h2>
              <span className={`badge ${op.category === "read" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {op.category === "read" ? "조회" : "변경"}
              </span>
              {op.destructive && <span className="badge bg-rose-100 text-rose-700">🔴 비가역</span>}
              {!op.supported && <span className="badge bg-neutral-100 text-neutral-500">콘솔 미지원</span>}
            </div>
            <div className="mt-2 break-all font-mono text-xs text-neutral-500">
              {OPENAPI_BASE}
              <span className="text-neutral-800">{op.path}</span>
            </div>
            {op.notes && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{op.notes}</p>}

            {!op.supported ? (
              <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-medium text-neutral-700">콘솔에서 직접 호출하지 않는 API예요.</p>
                <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{op.notes || "본문이 방대하거나 멀티파트/선행 데이터가 필요합니다."}</p>
                {op.dedicatedTool && (
                  <a
                    href={op.dedicatedTool.href}
                    className="mt-3 inline-block rounded-md bg-kurly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kurly-600"
                  >
                    {op.dedicatedTool.label} →
                  </a>
                )}
              </div>
            ) : (
              <>
            {/* 경로 파라미터 */}
            {phs.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-semibold text-neutral-500">경로 파라미터</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {phs.map((name) => {
                    const meta = op.pathParams.find((p) => p.name === name);
                    return (
                      <Field key={name} name={`{${name}}`} desc={meta?.desc} required>
                        <input
                          value={pathVals[name] || ""}
                          onChange={(e) => setPathVals((s) => ({ ...s, [name]: e.target.value }))}
                          placeholder={meta?.example || ""}
                          className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-kurly-400 focus:outline-none"
                        />
                      </Field>
                    );
                  })}
                </div>
              </div>
            )}

            {/* orderItemNo 찾기 헬퍼 */}
            {phs.includes("orderItemNo") && (
              <div className="mt-3 rounded-md border border-sky-200 bg-sky-50/50 p-3">
                <div className="mb-2 text-xs font-semibold text-sky-700">🔍 orderItemNo 찾기 — 대표주문번호·상품명으로 (웹엔 안 보이는 값)</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={finderType}
                    onChange={(e) => setFinderType(e.target.value)}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs focus:border-kurly-400 focus:outline-none"
                  >
                    <option value="PARENT_ORDER_NO">대표주문번호</option>
                    <option value="ORDER_NUMBER">개별주문번호</option>
                    <option value="PRODUCT_NAME">상품명</option>
                    <option value="DEAL_PRODUCT_NUMBER">딜코드</option>
                    <option value="ALL">전체(최근 3개월)</option>
                  </select>
                  <input
                    value={finderText}
                    onChange={(e) => setFinderText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runFinder();
                      }
                    }}
                    placeholder={finderType === "ALL" ? "(비우고 찾기)" : "검색어"}
                    className="min-w-[160px] flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-kurly-400 focus:outline-none"
                  />
                  <button
                    onClick={runFinder}
                    disabled={finderLoading}
                    className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {finderLoading ? "찾는 중…" : "찾기"}
                  </button>
                </div>
                {finderError && <p className="mt-2 text-xs text-rose-600">{finderError}</p>}
                {finderResults.length > 0 && (
                  <div className="mt-2 max-h-52 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200 bg-white">
                    {finderResults.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setPathVals((s) => ({ ...s, orderItemNo: String(r.orderItemNo) }));
                          setFinderResults([]);
                        }}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-sky-50"
                        title={r.parentOrderNo ? `대표주문번호 ${r.parentOrderNo}` : undefined}
                      >
                        <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 font-mono font-bold text-sky-700">{r.orderItemNo}</span>
                        <span className="flex-1 truncate text-neutral-700">{r.productName}</span>
                        {r.status && <span className="shrink-0 text-neutral-400">{r.status}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-neutral-400">행 클릭 → 위 orderItemNo 칸에 자동 입력</p>
              </div>
            )}

            {/* partnerProductId 찾기 헬퍼 */}
            {phs.includes("partnerProductId") && (
              <ParamFinder
                key={op.id}
                label="🔍 partnerProductId 찾기 — 상품명·상품번호·딜코드로 (목록의 id 값)"
                defaultMode="PRODUCT_NAME"
                modes={[
                  { value: "PRODUCT_NAME", label: "상품명" },
                  { value: "PRODUCT_NO", label: "상품번호" },
                  { value: "DEAL_PRODUCT_CODE", label: "딜코드" },
                ]}
                onPick={(id) => setPathVals((s) => ({ ...s, partnerProductId: id }))}
                runSearch={async (mode, t) => {
                  const text = t.trim();
                  if (!text) return { error: "검색어를 입력하세요" };
                  const query: Record<string, string> = { page: "0", size: "30" };
                  if (mode === "PRODUCT_NAME") {
                    query.keywordSearchType = "PRODUCT_NAME";
                    query.keywordText = text;
                  } else {
                    query.searchType = mode;
                    query.searchText = text;
                  }
                  const res = await fetch("/api/test-data/3p-console", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      method: "GET",
                      path: "/open-api/v1/partner-products",
                      query,
                      accessToken: tokenOverride.trim() || undefined,
                    }),
                  });
                  const data = await res.json();
                  const stg = data?.data as { message?: string; data?: { content?: unknown[] } } | undefined;
                  if (!data.ok || !stg) return { error: `조회 실패 (status ${data?.status ?? "?"})` };
                  const content = stg?.data?.content;
                  if (!Array.isArray(content)) return { error: stg?.message || "결과 형식을 해석할 수 없음" };
                  if (content.length === 0) return { error: "일치하는 상품이 없습니다" };
                  return {
                    rows: content.map((raw) => {
                      const c = raw as Record<string, any>;
                      return {
                        id: String(c.id),
                        primary: c.name || "",
                        secondary: c?.saleStatus?.text || "",
                        tertiary: c.partnerProductNo ? `상품번호 ${c.partnerProductNo}` : undefined,
                      };
                    }),
                  };
                }}
              />
            )}

            {/* 쿼리 파라미터 */}
            {op.queryParams.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-semibold text-neutral-500">쿼리 파라미터</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {op.queryParams.map((p) => (
                    <Field key={p.name} name={p.name} desc={p.desc} required={p.required}>
                      <input
                        value={queryVals[p.name] || ""}
                        onChange={(e) => setQueryVals((s) => ({ ...s, [p.name]: e.target.value }))}
                        placeholder={p.example || ""}
                        className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-kurly-400 focus:outline-none"
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}

            {/* 본문 (write) */}
            {op.method !== "GET" && op.method !== "DELETE" && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-neutral-500">요청 본문 (JSON)</span>
                  {op.editLoadFrom && (
                    <button
                      onClick={loadCurrentForEdit}
                      disabled={loadingDetail}
                      className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                      title="상세조회로 현재 값을 본문에 채웁니다 (그 뒤 원하는 값만 고쳐 PUT)"
                    >
                      {loadingDetail ? "불러오는 중…" : `📥 ${op.editLoadFrom.label || "현재 값 불러오기"}`}
                    </button>
                  )}
                </div>
                {detailErr && <p className="mb-1.5 text-xs text-rose-600">{detailErr}</p>}
                {op.bodyPicker && <BodyOrderPicker key={op.id} cfg={op.bodyPicker} tokenOverride={tokenOverride} onBuild={setBodyText} />}
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={Math.min(16, Math.max(4, bodyText.split("\n").length + 1))}
                  spellCheck={false}
                  className="w-full rounded-md border border-neutral-300 p-2.5 font-mono text-xs focus:border-kurly-400 focus:outline-none"
                  placeholder="{ }"
                />
              </div>
            )}

            {/* 토큰 override */}
            <div className="mt-4">
              <button onClick={() => setShowToken((v) => !v)} className="text-xs text-neutral-500 hover:text-kurly-500">
                {showToken ? "▾" : "▸"} 토큰 — 기본 STG 파트너 토큰 사용 중 (다른 토큰으로 호출하려면 펼치기)
              </button>
              {showToken && (
                <input
                  value={tokenOverride}
                  onChange={(e) => setTokenOverride(e.target.value)}
                  placeholder="비우면 서버 기본 토큰 사용"
                  className="mt-1.5 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 font-mono text-xs focus:border-kurly-400 focus:outline-none"
                />
              )}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={run}
                disabled={loading || !op.supported}
                className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  op.destructive ? "bg-rose-500 hover:bg-rose-600" : "bg-kurly-500 hover:bg-kurly-600"
                }`}
              >
                {loading ? "호출 중…" : op.category === "read" ? "호출 →" : "변경 호출 →"}
              </button>
              {op.category === "write" && <span className="text-xs text-neutral-400">변경 계열 — 호출 전 확인창</span>}
            </div>
              </>
            )}
          </div>
        )}

        {/* 응답 */}
        {resp && (
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded px-2 py-0.5 text-sm font-bold ${
                  resp.status >= 200 && resp.status < 300
                    ? "bg-emerald-100 text-emerald-700"
                    : resp.status >= 400
                    ? "bg-amber-100 text-amber-700"
                    : "bg-rose-100 text-rose-700"
                }`}
              >
                {resp.status || "ERR"}
              </span>
              <span className="text-xs text-neutral-500">{resp.durationMs}ms</span>
              {resp.url && (
                <span className="break-all font-mono text-[11px] text-neutral-400">
                  {resp.method} {resp.url}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {typeof resp.data !== "string" && resp.data != null && (
                  <div className="flex overflow-hidden rounded-md border border-neutral-200 text-[11px]">
                    <button onClick={() => setRespView("tree")} className={`px-2 py-0.5 ${respView === "tree" ? "bg-kurly-500 text-white" : "text-neutral-500 hover:bg-neutral-50"}`}>트리</button>
                    <button onClick={() => setRespView("raw")} className={`px-2 py-0.5 ${respView === "raw" ? "bg-kurly-500 text-white" : "text-neutral-500 hover:bg-neutral-50"}`}>원본</button>
                  </div>
                )}
                <button
                  onClick={() => navigator.clipboard?.writeText(typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data, null, 2))}
                  className="text-xs text-neutral-500 hover:text-kurly-500"
                >
                  응답 복사
                </button>
              </div>
            </div>
            {resp.error && <p className="mt-2 text-sm text-rose-600">{resp.error}</p>}
            {typeof resp.data === "string" || resp.data == null ? (
              <pre className="mt-3 max-h-[60vh] overflow-auto rounded-md bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-800">
                {typeof resp.data === "string" ? resp.data : String(resp.data)}
              </pre>
            ) : respView === "tree" ? (
              <div className="mt-3 max-h-[60vh] overflow-auto rounded-md bg-neutral-50 p-3">
                <JsonView data={resp.data} />
              </div>
            ) : (
              <pre className="mt-3 max-h-[60vh] overflow-auto rounded-md bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-800">
                {JSON.stringify(resp.data, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 접을 수 있는 JSON 트리 뷰어 — 큰 응답을 폴딩해서 보기 편하게 (상위 2레벨·작은 배열 펼침, 큰 배열 접힘)
function JsonView({ data }: { data: unknown }) {
  return (
    <div className="font-mono text-xs leading-relaxed text-neutral-800">
      <JsonNode value={data} depth={0} />
    </div>
  );
}

function JsonNode({ value, depth, k }: { value: unknown; depth: number; k?: string }) {
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object" && !isArr;
  const entries: [string, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : isObj
    ? Object.entries(value as Record<string, unknown>)
    : [];
  const count = entries.length;
  const [open, setOpen] = useState(depth < 2 && !(isArr && count > 30));

  if (!isArr && !isObj) {
    return (
      <span>
        {k !== undefined && <JsonKey k={k} />}
        <JsonPrimitive v={value} />
      </span>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded px-0.5 hover:bg-neutral-100"
      >
        <span className="w-3 text-neutral-400">{count === 0 ? "" : open ? "▾" : "▸"}</span>
        {k !== undefined && <JsonKey k={k} />}
        <span className="text-neutral-400">{isArr ? `[${count}]` : `{${count}}`}</span>
      </button>
      {open && count > 0 && (
        <div className="ml-3 border-l border-neutral-200 pl-3">
          {entries.map(([key, v]) => (
            <div key={key}>
              <JsonNode value={v} depth={depth + 1} k={key} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JsonKey({ k }: { k: string }) {
  return (
    <span>
      <span className="text-sky-700">{k}</span>
      <span className="text-neutral-400">: </span>
    </span>
  );
}

function JsonPrimitive({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="italic text-neutral-400">null</span>;
  if (typeof v === "string") return <span className="break-all text-emerald-700">&quot;{v}&quot;</span>;
  if (typeof v === "number") return <span className="text-violet-600">{String(v)}</span>;
  if (typeof v === "boolean") return <span className="text-amber-600">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

function Field({ name, desc, required, children }: { name: string; desc?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block break-words text-[11px]">
        <span className={required ? "font-bold text-neutral-800" : "text-neutral-500"}>
          {name}
          {required && <span className="text-rose-500"> *</span>}
        </span>
        {desc && <span className="text-neutral-400"> · {desc}</span>}
      </span>
      {children}
    </label>
  );
}

// 경로 파라미터(id류)를 목록 API로 검색해서 클릭 한 번에 채우는 범용 헬퍼.
// key={op.id} 로 마운트하면 엔드포인트 전환 시 자동 초기화.
function ParamFinder({
  label,
  modes,
  defaultMode,
  runSearch,
  onPick,
}: {
  label: string;
  modes: { value: string; label: string }[];
  defaultMode: string;
  runSearch: (mode: string, text: string) => Promise<{ rows?: FinderResultRow[]; error?: string }>;
  onPick: (id: string) => void;
}) {
  const [mode, setMode] = useState(defaultMode);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<FinderResultRow[]>([]);

  async function go() {
    setLoading(true);
    setError("");
    setRows([]);
    try {
      const r = await runSearch(mode, text);
      if (r.error) setError(r.error);
      else setRows(r.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-sky-200 bg-sky-50/50 p-3">
      <div className="mb-2 text-xs font-semibold text-sky-700">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs focus:border-kurly-400 focus:outline-none"
        >
          {modes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go();
            }
          }}
          placeholder="검색어"
          className="min-w-[160px] flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-kurly-400 focus:outline-none"
        />
        <button
          onClick={go}
          disabled={loading}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {loading ? "찾는 중…" : "찾기"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      {rows.length > 0 && (
        <div className="mt-2 max-h-52 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200 bg-white">
          {rows.map((r, i) => (
            <button
              key={i}
              onClick={() => {
                onPick(r.id);
                setRows([]);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-sky-50"
              title={r.tertiary}
            >
              <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 font-mono font-bold text-sky-700">{r.id}</span>
              <span className="flex-1 truncate text-neutral-700">{r.primary}</span>
              {r.secondary && <span className="shrink-0 text-neutral-400">{r.secondary}</span>}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-neutral-400">행 클릭 → 위 칸에 자동 입력</p>
    </div>
  );
}

// order-sheets에서 대상 상태 주문을 다중선택 → 본문 배열(orderItemNos/reservations/invoices)을 생성.
function BodyOrderPicker({
  cfg,
  tokenOverride,
  onBuild,
}: {
  cfg: { orderStatus: string; arrayKey: string; itemShape: "id" | "object"; itemTemplate?: Record<string, string>; label: string };
  tokenOverride: string;
  onBuild: (bodyText: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string; status: string }[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    setRows([]);
    setChecked({});
    setLoaded(false);
    const now = new Date();
    const start = new Date(now.getTime() - 89 * 24 * 3600 * 1000);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    try {
      const res = await fetch("/api/test-data/3p-console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "GET",
          path: "/open-api/v1/order-sheets",
          query: {
            page: "0",
            size: "50",
            periodSearchType: "NEW_ORDER",
            searchStartAt: fmt(start),
            searchEndAt: fmt(now),
            searchType: "ALL",
            orderStatusSearchType: cfg.orderStatus,
          },
          accessToken: tokenOverride.trim() || undefined,
        }),
      });
      const data = await res.json();
      const stg = data?.data as { message?: string; data?: { content?: unknown[] } } | undefined;
      const content = stg?.data?.content;
      if (!data.ok || !Array.isArray(content)) {
        setError(stg?.message || `조회 실패 (status ${data?.status ?? "?"})`);
        return;
      }
      if (content.length === 0) {
        setError("대상 상태의 주문이 없습니다");
        return;
      }
      setRows(
        content.map((raw) => {
          const c = raw as Record<string, any>;
          return { id: String(c.orderItemNo), name: c.productName || "", status: c?.orderStatus?.text || "" };
        })
      );
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function build() {
    const ids = rows.filter((r) => checked[r.id]).map((r) => r.id);
    if (ids.length === 0) {
      setError("최소 1건 선택하세요");
      return;
    }
    setError("");
    const arr =
      cfg.itemShape === "id"
        ? ids.map((id) => Number(id))
        : ids.map((id) => ({ orderItemNo: Number(id), ...(cfg.itemTemplate || {}) }));
    onBuild(JSON.stringify({ [cfg.arrayKey]: arr }, null, 2));
  }

  const selectedCount = rows.filter((r) => checked[r.id]).length;

  return (
    <div className="mb-2 rounded-md border border-sky-200 bg-sky-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-sky-700">📋 {cfg.label}</span>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50"
        >
          {loading ? "불러오는 중…" : loaded ? "다시 불러오기" : "대상 주문 불러오기"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      {rows.length > 0 && (
        <>
          <div className="mt-2 max-h-52 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200 bg-white">
            {rows.map((r) => (
              <label key={r.id} className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-sky-50">
                <input
                  type="checkbox"
                  checked={!!checked[r.id]}
                  onChange={() => setChecked((s) => ({ ...s, [r.id]: !s[r.id] }))}
                  className="accent-sky-600"
                />
                <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 font-mono font-bold text-sky-700">{r.id}</span>
                <span className="flex-1 truncate text-neutral-700">{r.name}</span>
                <span className="shrink-0 text-neutral-400">{r.status}</span>
              </label>
            ))}
          </div>
          <button
            onClick={build}
            className="mt-2 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
          >
            선택 {selectedCount}건 본문에 담기 →
          </button>
        </>
      )}
    </div>
  );
}
