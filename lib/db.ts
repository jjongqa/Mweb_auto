import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { scheduleMaintenance } from "./maintenance";
import { splitCsvLines, parseCsvRow } from "./csv-parser";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "qa-admin.db");

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined;
}

export const db = global.__db ?? new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 10000");
db.pragma("foreign_keys = ON");

if (!global.__db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      domain TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'web',
      qa_env TEXT NOT NULL DEFAULT 'stg',
      task_name TEXT,
      env TEXT NOT NULL DEFAULT 'stg',
      epic_key TEXT,
      tc_filename TEXT NOT NULL,
      tc_path TEXT NOT NULL,
      result_dir TEXT,
      total INTEGER DEFAULT 0,
      passed INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      blocked INTEGER DEFAULT 0,
      current_index INTEGER DEFAULT 0,
      error_message TEXT,
      requested_by TEXT,
      mode TEXT NOT NULL DEFAULT 'mock',
      generated_prompt TEXT,
      cancel_requested INTEGER DEFAULT 0,
      tc_filter TEXT,
      analyzer_summary TEXT,
      chunk_group_id TEXT,
      chunk_index INTEGER,
      chunk_total INTEGER
    );

    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_logs_job ON job_logs(job_id, id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS prompt_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      action TEXT NOT NULL,                      -- 'upload' | 'overwrite' | 'delete' | 'restore'
      target_folder TEXT NOT NULL,                -- 'prompts', 'prompts/베이스', 'knowledge/멤버스' 등
      filename TEXT NOT NULL,
      size_bytes INTEGER,
      backup_path TEXT,                           -- 백업된 경로 (덮어쓰기/삭제 시)
      uploaded_by TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_ts ON prompt_uploads(ts);

    -- v1.0 분산 워커
    CREATE TABLE IF NOT EXISTS workers (
      name TEXT PRIMARY KEY,
      ip_address TEXT,
      capabilities TEXT,                            -- JSON: {"web":true, "app":false}
      status TEXT NOT NULL DEFAULT 'offline',       -- 'online' | 'busy' | 'offline'
      last_heartbeat TEXT,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_jobs INTEGER NOT NULL DEFAULT 0,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

    -- v1.8 Jira 자동 등록
    CREATE TABLE IF NOT EXISTS jira_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,                       -- "Kurly Atlassian"
      host TEXT NOT NULL,                       -- "kurly0521.atlassian.net"
      email TEXT NOT NULL,                      -- Atlassian 계정 이메일
      api_token TEXT NOT NULL,                  -- Atlassian API token (평문, 사내 한정)
      default_project_key TEXT NOT NULL,        -- "KQA" 등
      default_issue_type TEXT NOT NULL DEFAULT 'Bug',
      labels TEXT,                              -- "qa-automated,3p" 같이 쉼표 구분
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS jira_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      tc_no TEXT,                               -- TC-1 같은 식별자
      issue_key TEXT NOT NULL,                  -- KQA-12345
      issue_url TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_jira_issues_job ON jira_issues(job_id);

    -- v1.7 진행 중 잡에 끼어들기: 사용자가 보낸 메시지 큐
    -- 워커가 turn 사이마다 polling → pending 인 메시지를 stdin 으로 push 후 delivered 표시
    CREATE TABLE IF NOT EXISTS pending_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending / delivered / failed
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pending_messages_job ON pending_messages(job_id, status);

    -- 수행 중 테스트데이터 요청 큐
    -- 수행 에이전트가 동시에 요청해도 워커가 순차 claim 하도록 중앙에서 상태를 관리한다.
    CREATE TABLE IF NOT EXISTS data_requests (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      claimed_at TEXT,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',      -- pending / running / ready / blocked / failed
      source_job_id TEXT,
      source_agent TEXT,
      tc_ref TEXT,
      need TEXT NOT NULL,
      reason TEXT,
      inputs TEXT,
      preferred_tool TEXT,
      claimed_by TEXT,
      result_context TEXT,
      verification TEXT,
      notes TEXT,
      error_message TEXT,
      raw_output TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_data_requests_status ON data_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_data_requests_job ON data_requests(source_job_id, status);

    -- v1.6 Postman Collection 저장소 (Newman 실행용)
    CREATE TABLE IF NOT EXISTS postman_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,                         -- 사용자 식별용 (예: "3P Open API 마스터 v1")
      domain TEXT NOT NULL,                       -- 적용 도메인
      collection_json TEXT NOT NULL,              -- Postman collection v2.1 JSON 전체
      environment_json TEXT,                      -- (선택) Postman environment JSON
      collection_size INTEGER,                    -- JSON 길이 (UI 표시용)
      request_count INTEGER,                      -- 파싱한 request 수 (UI 표시용)
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_postman_domain ON postman_collections(domain);

    -- v1.7 Postman Environment 저장소
    CREATE TABLE IF NOT EXISTS postman_environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,                         -- 예: "Kurly OpenAPI STG(25)"
      domain TEXT NOT NULL,                       -- 적용 도메인
      environment_json TEXT NOT NULL,             -- Postman environment JSON
      env_size INTEGER,
      variable_count INTEGER,                     -- env values 개수
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_postman_env_domain ON postman_environments(domain);

    -- v1.5 API 명세 저장소 (도메인 필수)
    CREATE TABLE IF NOT EXISTS api_specs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,                       -- 사용자 식별용 (예: "3P 파트너 외부 API REST Docs")
      domain TEXT NOT NULL,                     -- 적용 도메인 (필수)
      qa_env TEXT,                              -- 적용 환경 (NULL = 모든 환경)
      api_base_url TEXT,                        -- API base URL (선택)
      spec_url TEXT,                            -- 명세 원본 URL
      spec_text TEXT,                           -- 명세 본문 (URL fetch 결과 또는 직접 입력)
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_specs_domain ON api_specs(domain, qa_env);

    -- v1.4 API 인증 토큰 시크릿 저장소
    CREATE TABLE IF NOT EXISTS api_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,                       -- 사용자 식별용 (예: "QA10 파트너 jjongqa1")
      domain TEXT,                              -- 적용 도메인 (NULL = 모든 도메인)
      qa_env TEXT,                              -- 적용 환경 (NULL = 모든 환경)
      api_base_url TEXT,                        -- 적용 API base (NULL = 자동 결정)
      token_value TEXT NOT NULL,                -- 평문 (사내 도구 한정 / 사외 노출 X)
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_secrets_domain ON api_secrets(domain, qa_env);

    CREATE TABLE IF NOT EXISTS worker_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_name TEXT NOT NULL,
      grp TEXT NOT NULL,                          -- main | design | write | exec
      nickname TEXT NOT NULL,
      hat TEXT NOT NULL DEFAULT 'cap',            -- cap | crown | wizard | helmet | bandana
      exp TEXT NOT NULL DEFAULT 'smile',          -- smile | neutral | happy | focused | cool
      color_c TEXT NOT NULL DEFAULT '#185FA5',
      color_b TEXT NOT NULL DEFAULT '#1D9E75',
      color_s TEXT NOT NULL DEFAULT '#F2C49B',
      sort_order INTEGER NOT NULL DEFAULT 0,
      instruction TEXT NOT NULL DEFAULT '',       -- 에이전트별 지시 (멀티 수행 시 이 에이전트 프롬프트에 주입)
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_worker_agents_worker ON worker_agents(worker_name);

    CREATE TABLE IF NOT EXISTS worker_agent_settings (
      worker_name TEXT NOT NULL,
      grp TEXT NOT NULL,                          -- design | write | exec
      mode TEXT NOT NULL DEFAULT 'single',        -- single | multi
      PRIMARY KEY (worker_name, grp)
    );
  `);

  // 마이그레이션
  const cols = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  const migrations: [string, string][] = [
    ["platform", `ALTER TABLE jobs ADD COLUMN platform TEXT NOT NULL DEFAULT 'web'`],
    ["qa_env", `ALTER TABLE jobs ADD COLUMN qa_env TEXT NOT NULL DEFAULT 'stg'`],
    ["task_name", `ALTER TABLE jobs ADD COLUMN task_name TEXT`],
    ["blocked", `ALTER TABLE jobs ADD COLUMN blocked INTEGER DEFAULT 0`],
    ["mode", `ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'mock'`],
    ["generated_prompt", `ALTER TABLE jobs ADD COLUMN generated_prompt TEXT`],
    ["started_at", `ALTER TABLE jobs ADD COLUMN started_at TEXT`],
    ["finished_at", `ALTER TABLE jobs ADD COLUMN finished_at TEXT`],
    ["cancel_requested", `ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER DEFAULT 0`],
    ["tc_filter", `ALTER TABLE jobs ADD COLUMN tc_filter TEXT`],
    ["analyzer_summary", `ALTER TABLE jobs ADD COLUMN analyzer_summary TEXT`],
    // v0.4b knowledge-match + 추가 지시사항
    ["additional_instructions", `ALTER TABLE jobs ADD COLUMN additional_instructions TEXT`],
    // v0.4b 재실행 부모 추적
    ["parent_job_id", `ALTER TABLE jobs ADD COLUMN parent_job_id TEXT`],
    ["retry_type", `ALTER TABLE jobs ADD COLUMN retry_type TEXT`],  // 'FAIL' | 'BLOCKED' | null
    // v1.0 분산 워커
    ["worker_name", `ALTER TABLE jobs ADD COLUMN worker_name TEXT`],
    ["assigned_at", `ALTER TABLE jobs ADD COLUMN assigned_at TEXT`],
    // v1.1 기획 문서 참조
    ["spec_url", `ALTER TABLE jobs ADD COLUMN spec_url TEXT`],
    ["spec_filename", `ALTER TABLE jobs ADD COLUMN spec_filename TEXT`],
    ["spec_text", `ALTER TABLE jobs ADD COLUMN spec_text TEXT`],
    // v1.2 다중 TC 파일 (JSON array; 기존 tc_path/tc_filename은 첫 파일로 호환 유지)
    ["tc_paths", `ALTER TABLE jobs ADD COLUMN tc_paths TEXT`],
    ["tc_filenames", `ALTER TABLE jobs ADD COLUMN tc_filenames TEXT`],
    // v1.3 애드혹 테스트 (기획서 + 자유 텍스트 기반, TC 없음)
    ["job_type", `ALTER TABLE jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'full'`],
    ["adhoc_focus", `ALTER TABLE jobs ADD COLUMN adhoc_focus TEXT`],
    // v1.7.5 잡별 모델 — null 이면 워커 default (Sonnet)
    ["claude_model", `ALTER TABLE jobs ADD COLUMN claude_model TEXT`],
    // v1.4 API 테스트 인증 토큰
    ["api_auth_token", `ALTER TABLE jobs ADD COLUMN api_auth_token TEXT`],
    ["api_secret_name", `ALTER TABLE jobs ADD COLUMN api_secret_name TEXT`],
    // v1.6 Postman 잡 (Newman 실행)
    ["postman_collection_json", `ALTER TABLE jobs ADD COLUMN postman_collection_json TEXT`],
    ["postman_environment_json", `ALTER TABLE jobs ADD COLUMN postman_environment_json TEXT`],
    ["postman_collection_name", `ALTER TABLE jobs ADD COLUMN postman_collection_name TEXT`],
    // v1.7 Postman 보조 파일 (multipart 업로드용)
    ["postman_assets_dir", `ALTER TABLE jobs ADD COLUMN postman_assets_dir TEXT`],
    // F1 실행 시간(초) — complete route 에서 (finished-started) 계산해 저장
    ["duration_sec", `ALTER TABLE jobs ADD COLUMN duration_sec INTEGER`],
    // 기능테스트 inline 컨텍스트 — admin이 Drive 동기화된 base/도메인/knowledge/CLAUDE 내용을 박아 워커에 전달(외부워커 Drive 최신 반영)
    ["inlined_context", `ALTER TABLE jobs ADD COLUMN inlined_context TEXT`],
    // Phase 2 멀티 분할 수행 — 한 수행을 N청크로 쪼갠 잡들이 공유하는 그룹 + 순번/총개수
    ["chunk_group_id", `ALTER TABLE jobs ADD COLUMN chunk_group_id TEXT`],
    ["chunk_index", `ALTER TABLE jobs ADD COLUMN chunk_index INTEGER`],
    ["chunk_total", `ALTER TABLE jobs ADD COLUMN chunk_total INTEGER`],
  ];
  for (const [col, sql] of migrations) {
    if (!colNames.has(col)) db.exec(sql);
  }

  // jira_settings 마이그레이션 — v1.9 워커별 토큰 분기 / 글로벌 claim
  const jiraCols = db.prepare(`PRAGMA table_info(jira_settings)`).all() as { name: string }[];
  const jiraColNames = new Set(jiraCols.map((c) => c.name));
  const jiraMigrations: [string, string][] = [
    // 누가 [내 토큰] claim 한 시각. 값이 있으면 다른 워커 화면에서 [내 토큰] 버튼 숨김.
    ["claimed_at", `ALTER TABLE jira_settings ADD COLUMN claimed_at TEXT`],
  ];
  for (const [col, sql] of jiraMigrations) {
    if (!jiraColNames.has(col)) db.exec(sql);
  }

  // workers 테이블 마이그레이션
  const workerCols = db.prepare(`PRAGMA table_info(workers)`).all() as { name: string }[];
  const workerColNames = new Set(workerCols.map((c) => c.name));
  const workerMigrations: [string, string][] = [
    // v1.7 multi-concurrency: 워커가 현재 처리 중인 잡 수 + 최대 동시 슬롯
    ["active_jobs", `ALTER TABLE workers ADD COLUMN active_jobs INTEGER NOT NULL DEFAULT 0`],
    ["max_concurrent", `ALTER TABLE workers ADD COLUMN max_concurrent INTEGER NOT NULL DEFAULT 1`],
    // v1.7 사용자 친화 이름 — name(호스트명) 은 그대로 키, label 만 별도 편집 가능
    ["label", `ALTER TABLE workers ADD COLUMN label TEXT`],
    // 워커 패키지 버전(heartbeat 보고) — 구버전 워커 업데이트 배너용. 미보고(구 v1.8)면 null
    ["version", `ALTER TABLE workers ADD COLUMN version TEXT`],
  ];
  for (const [col, sql] of workerMigrations) {
    if (!workerColNames.has(col)) db.exec(sql);
  }

  // worker_agents 마이그레이션 — 에이전트별 지시(멀티 수행 시 프롬프트 주입). 기존 DB는 instruction 컬럼이 없을 수 있음.
  {
    const waCols = new Set((db.prepare(`PRAGMA table_info(worker_agents)`).all() as { name: string }[]).map((c) => c.name));
    if (!waCols.has("instruction")) db.exec(`ALTER TABLE worker_agents ADD COLUMN instruction TEXT NOT NULL DEFAULT ''`);
  }

  // 마이그레이션으로 추가된 컬럼 위 인덱스 — CREATE TABLE 안에 못 넣음
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_parent_id ON jobs(parent_job_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_name, status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_chunk_group ON jobs(chunk_group_id);`);

  // F5 TC 단위 실행 결과 — flaky 탐지 / 잡 비교용. complete route 에서 summary.csv 파싱 시 적재.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tc_execution_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      tc_no TEXT NOT NULL,
      result TEXT NOT NULL,                       -- PASS | FAIL | BLOCKED
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tc_runs_job ON tc_execution_runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_tc_runs_no ON tc_execution_runs(tc_no);
  `);

  // TC 생성 잡 — 기획서 → (스킬+정책 주입) Claude → TC CSV. 실행 잡(jobs)과 분리.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tc_gen_jobs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',     -- pending | running | succeeded | failed
      domain TEXT NOT NULL,
      task_name TEXT,
      requested_by TEXT,
      spec_url TEXT,
      spec_filename TEXT,
      spec_text TEXT,
      focus TEXT,
      claude_model TEXT,
      output_path TEXT,
      output_filename TEXT,
      tc_count INTEGER DEFAULT 0,
      duration_sec INTEGER,
      error_message TEXT,
      log TEXT,
      parent_id TEXT,                 -- 개선 재생성 시 원본 tc_gen 잡
      refine_instructions TEXT,       -- 개선 피드백
      include_analysis INTEGER NOT NULL DEFAULT 1,  -- (deprecated) 기존 tc-gen QA분석 토글
      qa_analysis TEXT,               -- kind=design: 생성된 QA설계 분석 / kind=tc: 반영할 주입 분석
      kind TEXT NOT NULL DEFAULT 'tc',      -- 'design'(QA설계) | 'tc'(TC생성)
      source_design_id TEXT,          -- tc 잡이 어떤 QA설계에서 넘어왔나
      pocs TEXT,                      -- JSON string[] — 대상 POC(시트분류). null=미지정/레거시
      agent_group_id TEXT,            -- 설계/작성 지시기반 병렬: 같은 그룹의 N잡(에이전트별)이 공유. null=단독
      agent_nickname TEXT             -- 이 잡을 담당한 에이전트(라벨)
    );
    CREATE INDEX IF NOT EXISTS idx_tc_gen_created ON tc_gen_jobs(created_at);
  `);
  // 기존 DB 마이그레이션 — 개선(refine) + QA분석 + QA설계(kind) 컬럼
  {
    const cols = new Set((db.prepare(`PRAGMA table_info(tc_gen_jobs)`).all() as { name: string }[]).map((c) => c.name));
    if (!cols.has("parent_id")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN parent_id TEXT`);
    if (!cols.has("refine_instructions")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN refine_instructions TEXT`);
    if (!cols.has("include_analysis")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN include_analysis INTEGER NOT NULL DEFAULT 1`);
    if (!cols.has("qa_analysis")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN qa_analysis TEXT`);
    if (!cols.has("kind")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'tc'`);
    if (!cols.has("source_design_id")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN source_design_id TEXT`);
    if (!cols.has("pocs")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN pocs TEXT`);
    // 워커 분배 모델 — 생성 시 프롬프트 미리 조립 저장, 워커가 claim 해서 로컬 claude 로 실행.
    if (!cols.has("prompt")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN prompt TEXT`);       // 미리 조립된 claude 프롬프트
    if (!cols.has("model")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN model TEXT`);          // 확정 모델
    if (!cols.has("worker_name")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN worker_name TEXT`); // claim 한 워커
    if (!cols.has("assigned_at")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN assigned_at TEXT`); // claim 시각 (스테일 reclaim 기준)
    if (!cols.has("target_worker")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN target_worker TEXT`); // 생성 시 지정한 실행 워커 (null=아무 워커나)
    // 설계/작성 지시기반 병렬 — 같은 그룹 N잡(에이전트별 focus) + 합본
    if (!cols.has("agent_group_id")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN agent_group_id TEXT`);
    if (!cols.has("agent_nickname")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN agent_nickname TEXT`);
    if (!cols.has("harness_report")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN harness_report TEXT`); // 하네스 게이트/평가 점수 JSON
    if (!cols.has("engine")) db.exec(`ALTER TABLE tc_gen_jobs ADD COLUMN engine TEXT`); // 'harness' | 'legacy' | null(=env TCGEN_HARNESS 따름) — per-job 생성 엔진 선택
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tc_gen_agent_group ON tc_gen_jobs(agent_group_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tc_gen_status ON tc_gen_jobs(status, created_at);`);

  // 좀비 tc-gen 회수 — 워커 분배 모델: pending 은 워커를 기다리는 정상 상태라 건드리지 않는다.
  //   claim 후 멈춘(워커 사망 추정) running 잡만 pending 으로 되돌려 다른 워커가 다시 집게 한다.
  //   스테일 임계: 하네스 잡(__HARNESS__, 오케스트레이터 수십 분 소요)은 90분, 그 외(단순 스킬)는 15분.
  //   ⚠️ lib/tc-gen.ts claimNextTcGenJob 의 reclaim 과 반드시 동일하게 유지(여기/거기 2곳).
  //   (assigned_at 기준. prompt 가 이미 저장돼 있어 reclaim 후 재실행 가능.)
  db.exec(`
    UPDATE tc_gen_jobs
    SET status='pending', worker_name=NULL, assigned_at=NULL, started_at=NULL
    WHERE status='running'
      AND assigned_at IS NOT NULL
      AND (
        (prompt LIKE '__HARNESS__%' AND assigned_at < datetime('now','-90 minutes'))
        OR (COALESCE(prompt,'') NOT LIKE '__HARNESS__%' AND assigned_at < datetime('now','-15 minutes'))
      )
  `);

  // F7 회귀 스위트 — 잡 설정을 이름으로 저장해 두고 "지금 실행"
  db.exec(`
    CREATE TABLE IF NOT EXISTS regression_suites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'web',
      qa_env TEXT NOT NULL DEFAULT 'stg',
      mode TEXT NOT NULL DEFAULT 'mock',
      tc_paths TEXT NOT NULL,                     -- JSON array (절대경로)
      tc_filenames TEXT NOT NULL,                 -- JSON array (표시명)
      claude_model TEXT,
      worker_name TEXT,
      tc_filter TEXT,
      additional_instructions TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  // F1 백필 — 기존 완료 잡의 duration_sec 1회 계산 (이미 값 있으면 skip)
  db.exec(`
    UPDATE jobs
    SET duration_sec = CAST((julianday(finished_at) - julianday(started_at)) * 86400 AS INTEGER)
    WHERE duration_sec IS NULL
      AND finished_at IS NOT NULL
      AND started_at IS NOT NULL
  `);

  // F5 백필 — tc_execution_runs 적재 로직 추가 이전에 완료된 잡들의 per-TC 결과를
  // summary.csv 에서 1회 적재 (이미 행 있는 잡은 skip). compare/flaky 가 과거 잡에도 적용됨.
  try {
    const missing = db.prepare(`
      SELECT j.id AS id, j.result_dir AS result_dir FROM jobs j
      WHERE j.status IN ('succeeded','failed') AND j.result_dir IS NOT NULL AND j.total > 0
        AND NOT EXISTS (SELECT 1 FROM tc_execution_runs t WHERE t.job_id = j.id)
    `).all() as { id: string; result_dir: string }[];
    if (missing.length > 0) {
      const ins = db.prepare(`INSERT INTO tc_execution_runs (job_id, tc_no, result) VALUES (?, ?, ?)`);
      const backfill = db.transaction(() => {
        let filled = 0;
        for (const j of missing) {
          const p = path.join(j.result_dir, "summary.csv");
          if (!fs.existsSync(p)) continue;
          let text: string;
          try { text = fs.readFileSync(p, "utf-8").replace(/^﻿/, ""); } catch { continue; }
          const lines = splitCsvLines(text);
          if (lines.length < 2) continue;
          const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
          const ri = header.indexOf("result");
          const ni = header.indexOf("no");
          if (ri < 0 || ni < 0) continue;
          for (let i = 1; i < lines.length; i++) {
            const cells = parseCsvRow(lines[i]);
            const r = (cells[ri] || "").trim().toUpperCase();
            const no = (cells[ni] || "").trim();
            if (no && (r === "PASS" || r === "FAIL" || r === "BLOCKED")) ins.run(j.id, no, r);
          }
          filled++;
        }
        return filled;
      });
      const filled = backfill();
      if (filled > 0) console.log(`[db] tc_execution_runs 백필: ${filled}/${missing.length}개 과거 잡`);
    }
  } catch (e) {
    console.warn("[db] tc_execution_runs 백필 실패:", (e as Error).message);
  }

  // results/ 디렉터리 무제한 누적 방지 — 부팅 후 비동기 cleanup 예약
  scheduleMaintenance();

  global.__db = db;
}

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";
// v0.4b: 도메인 확장 — 멤버스/회원/3P + 7개 추가 (DOMAINS in lib/domains.ts)
export type Domain = string;
export type Platform = "web" | "mweb" | "app";

// platform 사용자 표시 라벨
export const PLATFORM_LABELS: Record<Platform, string> = {
  web: "Web (데스크톱)",
  mweb: "Mweb (모바일 웹)",
  app: "App (네이티브)",
};
export type RunMode = "mock" | "real";

export interface Job {
  id: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: JobStatus;
  domain: Domain;
  platform: Platform;
  qa_env: string;
  task_name: string | null;
  env: string;
  epic_key: string | null;
  tc_filename: string;
  tc_path: string;
  result_dir: string | null;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  current_index: number;
  error_message: string | null;
  requested_by: string | null;
  mode: RunMode;
  generated_prompt: string | null;
  cancel_requested: number;
  tc_filter: string | null;
  analyzer_summary: string | null;
  additional_instructions: string | null;
  parent_job_id: string | null;
  retry_type: "FAIL" | "BLOCKED" | "continue" | "extend" | null;
  // v1.0 분산 워커
  worker_name: string | null;       // 할당된 워커 이름
  assigned_at: string | null;       // 워커 할당 시각
  // v1.1 기획 문서 참조 (선택)
  spec_url: string | null;
  spec_filename: string | null;
  spec_text: string | null;
  // v1.2 다중 TC 파일 (JSON array 문자열)
  tc_paths: string | null;
  tc_filenames: string | null;
  // v1.3 애드혹 테스트
  job_type: "full" | "adhoc";
  adhoc_focus: string | null;
  claude_model: string | null;
  // F1 실행 시간(초) — 완료 시점에 계산
  duration_sec: number | null;
  // 기능테스트 inline 컨텍스트(admin이 Drive 동기화 기반 조립) — 워커가 로컬 파일 대신 사용
  inlined_context: string | null;
  // Phase 2 멀티 분할 수행 — 같은 chunk_group_id 의 잡들은 한 수행을 N등분한 청크. null=단일 수행
  chunk_group_id: string | null;
  chunk_index: number | null;   // 0..N-1
  chunk_total: number | null;   // N
}


export interface JobLog {
  id: number;
  job_id: string;
  ts: string;
  level: string;
  message: string;
}

export interface JiraSettings {
  id: number;
  name: string;
  host: string;
  email: string;
  api_token: string;
  default_project_key: string;
  default_issue_type: string;
  labels: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  claimed_at: string | null;       // 누가 "내 토큰" 으로 claim 한 시각
}

export interface JiraIssueRecord {
  id: number;
  job_id: string;
  tc_no: string | null;
  issue_key: string;
  issue_url: string;
  summary: string | null;
  created_at: string;
  created_by: string | null;
}

export type PendingMessageStatus = "pending" | "delivered" | "failed";

export interface PendingMessage {
  id: number;
  job_id: string;
  content: string;
  status: PendingMessageStatus;
  created_at: string;
  delivered_at: string | null;
}

export type PromptUploadAction = "upload" | "overwrite" | "delete" | "restore";

export interface PromptUpload {
  id: number;
  ts: string;
  action: PromptUploadAction;
  target_folder: string;
  filename: string;
  size_bytes: number | null;
  backup_path: string | null;
  uploaded_by: string | null;
  note: string | null;
}
