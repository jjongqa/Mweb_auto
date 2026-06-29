import fs from "node:fs";
import { getQaCoworkHome } from "@/lib/prompt-manager";
import { DrivePromptBrowser } from "./drive-prompt-browser";
import { DriveSyncCard } from "./drive-sync-card";

export const dynamic = "force-dynamic";

export default function PromptsPage() {
  const home = getQaCoworkHome();
  const exists = fs.existsSync(home);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">프롬프트 / 날리지</h1>
        <p className="mt-1 text-sm text-neutral-600">
          기능테스트 프롬프트·날리지, <strong>TC 스킬</strong>, <strong>마스터정책</strong>(커머스·물류) —
          이 파일들은 모두 <strong>팀 공유 드라이브에서 관리</strong>합니다. 아래는 Drive에 있는 파일을 그대로 보여줘요.
        </p>
      </div>

      {exists && <DriveSyncCard />}

      {/* Drive 중앙 목록 (읽기 전용 — 편집은 파일명 클릭 → Drive) */}
      <DrivePromptBrowser />

      <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>📂 이 목록은 Google Drive에 있는 파일을 그대로 보여줍니다.</strong>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-amber-800">
          <li><strong>편집은 Drive에서</strong> — 추가·수정·삭제는 파일명을 클릭해 Drive에서 하세요. (로컬에서 고치면 다음 동기화가 덮어씁니다)</li>
          <li><strong>따로 동기화할 필요 없어요</strong> — 작업(TC생성·QA설계·기능테스트·애드혹)을 시작하면, Drive에서 바뀐 내용이 자동으로 반영된 다음 실행됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
