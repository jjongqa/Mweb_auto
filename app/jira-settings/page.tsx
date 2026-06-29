import { getAllSettings, publicSettings } from "@/lib/jira";
import { JiraSettingsList } from "./form";

export const dynamic = "force-dynamic";

export default function JiraSettingsPage() {
  const all = getAllSettings().map(publicSettings);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">🪲 Jira 자동 등록 설정 (실행자별 토큰)</h1>
        <p className="mt-1 text-sm text-neutral-600">
          팀원별로 본인 Atlassian 토큰을 등록하세요. 잡 만들 때 <code className="rounded bg-neutral-100 px-1 text-xs">실행자(requested_by)</code> 가 등록된 이름과 일치하면 그 사람의 토큰으로 Confluence 본문 fetch + Jira 이슈 등록(=reporter 본인) 자동 처리.
        </p>
        <div className="mt-3 rounded border-l-4 border-emerald-400 bg-emerald-50 p-3 text-xs text-emerald-900">
          <strong>🔒 API 토큰은 AES-256-GCM 으로 암호화 저장됩니다.</strong> (키: <code className="rounded bg-white px-1">~/.config/kurly-qa/master.key</code>, 0600)
          <br />
          사내망 한정 도구 — STG / 테스트 계정 토큰 권장. 토큰 발급: <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" className="underline">id.atlassian.com → API tokens</a>
        </div>
      </div>
      <JiraSettingsList initial={all} />
    </div>
  );
}
