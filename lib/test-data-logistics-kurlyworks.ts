/**
 * 테스트 데이터(마스터 세팅) — 컬리웍스/컬리로 작업자 세팅  [컬리로/Kurlyworks 작업자 세팅]
 *
 * 원본: fulfillment_sqe_studio `pages/2_kurlyworks_setup.py` + `src/test_kurlyworks/kurlyworks_automation.py`(Selenium) 포팅.
 *   → 서버측 Playwright(chromium)로 어드민 UI를 자동 조작. 공개 API가 없어 브라우저 자동화 필수.
 *
 * ⚠️ 실험적/미검증: 라이브 어드민 UI 셀렉터에 의존하므로 UI 변경 시 깨질 수 있다. admin 계정 + (마스터 미존재) 환경에서만 검증 가능.
 *
 * 산출물:
 *   - 컬리웍스: 근무조 생성 → 버전(v1.0) 등록 → 전자계약 문서 3종 업로드·'사용' → 버전/기본정보 '사용' 승인
 *   - 컬리로: 센터 근무시간대 마스터 등록 (CC/센터/계약구분/업무파트/팀명/근무·휴게시간)
 */

import { readFileSync } from "fs";
import { join } from "path";

const WORKS_LOGIN = "https://kurlyworks-admin-qa.dev.kurly.services/login/login.htm";
const RO_LOGIN = "https://kurlyro-admin-qa.dev.kurlycorp.kr/#/login";

export interface KurlyworksInput {
  worksId: string;       // 컬리웍스 로그인 ID (admin00)
  worksPw: string;       // 컬리웍스 PW
  roId: string;          // 컬리로 로그인 ID (autoqa12)
  roPw: string;          // 컬리로 PW
  cc: string;            // "김포 CC" 등
  center: string;        // "김포상온"
  part: string;          // 업무파트 IB 등
  startHour?: string;    // "" 면 현재시각
  endHour?: string;      // "" 면 start+1h
  headless: boolean;
  runWorks: boolean;     // 컬리웍스 플로우 실행
  runKurlyro: boolean;   // 컬리로 플로우 실행
}
export interface KurlyworksProgress { type: "step"; ok: boolean; level: "info" | "ok" | "err"; message: string }
export interface KurlyworksResult { ok: boolean; error?: string; teamName?: string; shift?: string }

const DOC_DEFS: [string, string][] = [
  ["근로계약서", "kurlyworks_01.md"],
  ["개인정보동의서", "kurlyworks_02.md"],
  ["안전보건교육", "kurlyworks_03.md"],
];
function docContent(file: string): string {
  return readFileSync(join(process.cwd(), "lib", "logistics-data", "kurlyworks-docs", file), "utf-8");
}

// KST 기준 근무시간 계산 (원본 로직)
function computeShift(startHour?: string, endHour?: string): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!startHour || !startHour.trim()) {
    const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
    const sh = now.getUTCHours();
    const eh = (sh + 1) % 24;
    return { start: `${pad(sh)}:00`, end: `${pad(eh)}:00` };
  }
  const s = parseInt(startHour, 10);
  const e = endHour && endHour.trim() ? parseInt(endHour, 10) : (s + 1) % 24;
  return { start: `${pad(s)}:00`, end: `${pad(e)}:00` };
}

export async function runKurlyworksSetup(input: KurlyworksInput, onProgress?: (e: KurlyworksProgress) => void): Promise<KurlyworksResult> {
  const emit = (level: KurlyworksProgress["level"], message: string) => onProgress?.({ type: "step", ok: level !== "err", level, message });
  const { start: shiftStart, end: shiftEnd } = computeShift(input.startHour, input.endHour);
  const teamName = `근무조_${shiftStart} - ${shiftEnd}`;

  // playwright 동적 로드 (미설치/브라우저 미설치 시 친절한 에러)
  let chromium: any;
  try { ({ chromium } = await import("playwright")); }
  catch { return { ok: false, error: "playwright 미설치 — `npm i playwright` 필요" }; }

  let browser: any;
  try {
    browser = await chromium.launch({ headless: input.headless });
  } catch (e) {
    return { ok: false, error: `브라우저 실행 실패(chromium 미설치 시 \`npx playwright install chromium\`): ${e instanceof Error ? e.message : String(e)}` };
  }

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  // 모든 alert/confirm 자동 수락
  page.on("dialog", async (d: any) => { try { await d.accept(); } catch {} });

  const X = (xpath: string) => page.locator(`xpath=${xpath}`);

  try {
    // ───────────── 컬리웍스 ─────────────
    if (input.runWorks) {
      emit("info", `컬리웍스 로그인... (${input.worksId})`);
      await page.goto(WORKS_LOGIN, { waitUntil: "domcontentloaded" });
      await page.locator("input#userId, input[placeholder='아이디를 입력하세요']").first().fill(input.worksId);
      await page.locator("input#userPw, input[name='userPw']").first().fill(input.worksPw);
      // 로그인 버튼: <button class="btn sizeFull" onclick="loginSubmit()">로그인</button> (type 속성 없음 — submit 아님)
      await X("//button[normalize-space()='로그인']").first().click();
      await page.waitForTimeout(2000);
      emit("ok", "✅ 컬리웍스 로그인");

      // 메뉴 이동
      await X("//a[.//span[normalize-space()='계약서(근무조) 관리']]").first().click();
      await X("//li//li//a[contains(normalize-space(.), '계약서(근무조) 관리')]").first().click();
      await page.waitForTimeout(1000);

      // 근무조 생성
      emit("info", `근무조 생성: ${teamName}`);
      await X("(//button[contains(normalize-space(), '등록')])[1]").click();
      await page.waitForTimeout(800);
      // 업무파트(native select)
      const partSel = X("//select").first();
      await partSel.selectOption({ label: input.part }).catch(() => {});
      // 근무조명 / 계약시간 / 계약가능시간 / 종업 관련 (라벨/th 기반)
      await fillByLabel(page, "근무조명", teamName).catch(() => {});
      await fillPairByLabel(page, "계약시간", shiftStart, shiftEnd).catch(() => {});
      await fillPairByLabel(page, "계약가능시간", shiftStart, shiftEnd).catch(() => {});
      await fillByLabel(page, "종업체크 가능시간", "100").catch(() => {});
      await fillByLabel(page, "종업 후 시업 가능시간", "10").catch(() => {});
      await fillByLabel(page, "비고", `[Mode:${input.part}] ${teamName}`).catch(() => {});
      await X("(//button[contains(normalize-space(), '등록')])[1]").click();
      await page.waitForTimeout(1500);
      emit("ok", "✅ 근무조 등록");

      // 상세 진입
      const statusSel = page.locator("#searchStatusFlag");
      await statusSel.selectOption({ label: "중지" }).catch(() => {});
      await X("(//button[contains(normalize-space(), 'Search')])[1]").click().catch(() => {});
      await page.waitForTimeout(1000);
      await X(`//tbody[@id='data_list']//tr/td[3]//a[contains(normalize-space(.), '${teamName}')]`).first().click();
      await page.waitForTimeout(1000);

      // 버전 등록
      emit("info", "버전(v1.0) 등록");
      await X("(//button[contains(normalize-space(), '등록')])[1]").click();
      await page.waitForTimeout(800);
      await fillByLabel(page, "버전명", "v1.0").catch(() => {});
      await fillPairByLabel(page, "계약시간", shiftStart, shiftEnd).catch(() => {});
      await fillByLabel(page, "기타수당", "9000").catch(() => {});
      await X("(//button[contains(normalize-space(), '저장')])[last()]").click();
      await page.waitForTimeout(1500);
      emit("ok", "✅ 버전 등록");

      // 전자계약 문서 3종
      for (const [docName, file] of DOC_DEFS) {
        emit("info", `문서 등록: ${docName}`);
        await X("(//button[contains(normalize-space(), '등록')])[2]").click();
        await page.waitForTimeout(1000);
        await fillByLabel(page, "문서명", docName).catch(() => {});
        await fillByLabel(page, "CSS", ".page_%%documentSeq%% {line-height: 13.5px;}").catch(() => {});
        await smartEditorInject(page, "Content", docContent(file)).catch(() => {});
        await X("(//button[contains(normalize-space(), '등록')])[1]").click();
        await page.waitForTimeout(1200);
        emit("ok", `✅ ${docName} 등록`);
      }

      // 문서 상태 '사용'
      for (const [docName] of DOC_DEFS) {
        await X(`//tr//td//a[contains(normalize-space(), '${docName}')]`).first().click().catch(() => {});
        await page.waitForTimeout(1000);
        await selectByLabel(page, "상태", "사용").catch(() => {});
        await X("(//button[contains(normalize-space(), '수정')])[1]").click().catch(() => {});
        await page.waitForTimeout(1000);
        emit("ok", `✅ ${docName} [사용]`);
      }

      // 버전/기본정보 '사용' 승인
      emit("info", "버전/기본정보 [사용] 승인");
      await X("//a[contains(@href, 'fnEditVersion')]//i[contains(@class, 'fa-edit')]").first().click().catch(() => {});
      await page.waitForTimeout(800);
      const modalStatus = X("//th[contains(normalize-space(), '상태')]/following-sibling::td[1]//select").first();
      await modalStatus.selectOption({ label: "사용" }).catch(() => {});
      await X("(//button[contains(normalize-space(), '저장')])[last()]").click().catch(() => {});
      await page.waitForTimeout(1200);
      await X("//a[contains(normalize-space(), '기본정보')]").first().click().catch(() => {});
      await page.waitForTimeout(800);
      await selectByLabel(page, "상태", "사용").catch(() => {});
      await X("(//button[contains(normalize-space(), '수정')])[1]").click().catch(() => {});
      await page.waitForTimeout(1200);
      emit("ok", "✅ 컬리웍스 세팅 완료");
    }

    // ───────────── 컬리로 ─────────────
    if (input.runKurlyro) {
      emit("info", `컬리로 로그인... (${input.roId})`);
      await page.goto(RO_LOGIN, { waitUntil: "domcontentloaded" });
      await page.locator("input[id^='input-'][type='text']").first().fill(input.roId);
      await page.locator("input[id^='input-'][type='password']").first().fill(input.roPw);
      await page.locator("button[type='submit'].v-btn").first().click();
      await page.waitForTimeout(1500);
      await X("//button[contains(., '확인')]").first().click({ timeout: 3000 }).catch(() => {});
      emit("ok", "✅ 컬리로 로그인");

      // 메뉴
      await X("//button[contains(@class,'nav-item')]//span[contains(@class,'v-btn__content') and contains(normalize-space(), '마스터관리')]").first().click();
      await page.waitForTimeout(500);
      await X("//div[contains(@class,'v-list-item')]//div[contains(@class,'sub-nav-item-content') and contains(normalize-space(), '센터 근무시간대 관리')]").first().click();
      await page.waitForTimeout(1000);
      await X("//button[contains(normalize-space(.), '근무시간대 등록')]").first().click().catch(async () => {
        await X("//*[contains(normalize-space(text()), '근무시간대 등록')]").first().click();
      });
      await page.waitForTimeout(800);

      // Vuetify select/input
      emit("info", "근무시간대 마스터 입력");
      await vuetifySelect(page, "CC", input.cc);
      await vuetifySelect(page, "센터", input.center);
      await vuetifySelect(page, "계약구분", "아르바이트");
      await vuetifySelect(page, "업무파트", input.part);
      await vuetifyInput(page, "팀명", "풀필먼트SQE");
      await vuetify4Step(page, "근무시간대", shiftStart, shiftEnd);
      await vuetify4Step(page, "휴게시간", shiftStart, shiftEnd);

      await X("//button[contains(normalize-space(.), '등록')]").first().click().catch(async () => {
        await X("//*[contains(normalize-space(text()), '등록')]").first().click();
      });
      await page.waitForTimeout(800);
      await X("//div[contains(@class,'v-card__actions')]//button[contains(normalize-space(.), '확인')]").first().click().catch(() => {});
      emit("ok", "✅ 컬리로 근무시간대 등록 완료");
    }

    return { ok: true, teamName, shift: `${shiftStart} ~ ${shiftEnd}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit("err", `❌ 오류: ${msg}`);
    return { ok: false, error: msg, teamName, shift: `${shiftStart} ~ ${shiftEnd}` };
  } finally {
    try { await browser.close(); } catch {}
  }
}

// ── 라벨/th 기반 입력 헬퍼 (컬리웍스) ──
async function fillByLabel(page: any, label: string, value: string): Promise<void> {
  await page.locator(`xpath=//*[(self::label or self::th) and contains(normalize-space(), '${label}')]/following::*[self::input or self::textarea][1]`).first().fill(value);
}
async function fillPairByLabel(page: any, label: string, v1: string, v2: string): Promise<void> {
  const base = `//th[contains(normalize-space(), '${label}')]/following-sibling::td[1]`;
  await page.locator(`xpath=${base}//input[1]`).first().fill(v1);
  await page.locator(`xpath=${base}//input[2]`).first().fill(v2);
}
async function selectByLabel(page: any, label: string, optionText: string): Promise<void> {
  const sel = page.locator(`xpath=//th[contains(normalize-space(), '${label}')]/following-sibling::td[1]//select`).first();
  await sel.selectOption({ label: optionText });
}

// ── Smart Editor iframe 주입 (textarea.se2_input_htmlsrc) ──
async function smartEditorInject(page: any, labelName: string, content: string): Promise<void> {
  const iframeEl = page.locator(`xpath=//*[self::label or self::th][contains(normalize-space(), '${labelName}')]/following::iframe[1]`).first();
  const frame = await iframeEl.contentFrame();
  if (!frame) return;
  const ta = frame.locator("textarea.se2_input_htmlsrc");
  await ta.evaluate((el: any, c: string) => { el.value = c; el.dispatchEvent(new Event("change", { bubbles: true })); }, content);
}

// ── Vuetify v-select ──
async function vuetifySelect(page: any, label: string, value: string): Promise<void> {
  await page.locator(`xpath=//div[contains(@class,'v-subheader')][contains(normalize-space(.), '${label}')]/following::div[contains(@class,'v-select')][1]//div[@role='button']`).first().click();
  await page.waitForTimeout(300);
  await page.locator(`xpath=//div[contains(@class,'v-list-item__content')][contains(normalize-space(.), '${value}')]`).first().click();
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}
async function vuetifyInput(page: any, label: string, value: string): Promise<void> {
  await page.locator(`xpath=//div[contains(@class,'v-subheader')][contains(normalize-space(.), '${label}')]/following::input[1]`).first().fill(value);
}
// 시/분/시/분 4단계 드롭다운
async function vuetify4Step(page: any, label: string, sTime: string, eTime: string): Promise<void> {
  const [sh, sm] = sTime.split(":");
  const [eh, em] = eTime.split(":");
  const vals = [sh, sm, eh, em];
  const base = `//div[contains(@class,'v-subheader')][contains(normalize-space(.), '${label}')]`;
  for (let i = 0; i < vals.length; i++) {
    const field = page.locator(`xpath=(${base}/following::input[@type='text'])[${i + 1}]/ancestor::div[@role='button']`).first();
    await field.scrollIntoViewIfNeeded().catch(() => {});
    await field.click();
    await page.waitForSelector("xpath=//div[contains(@class,'menuable__content__active')]", { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { const m = document.querySelector(".menuable__content__active") as HTMLElement | null; if (m) m.scrollTop = m.scrollHeight; });
    await page.locator(`xpath=//div[contains(@class,'menuable__content__active')]//div[contains(@class,'v-list-item__title')][normalize-space(text())='${vals[i]}']`).first().click();
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }
}
