import { PromptUploader } from "./uploader";
import { listUploads } from "@/lib/prompt-manager";

export const dynamic = "force-dynamic";

export default function PromptUploadPage() {
  const recent = listUploads(20);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">프롬프트 업로드</h1>
          <p className="mt-1 text-sm text-neutral-600">
            드래그앤드롭으로 .md 파일을 QA-Cowork 폴더에 업로드합니다.
          </p>
        </div>
        <span className="badge bg-rose-100 text-rose-700">⚠ 관리자 전용</span>
      </div>

      <div className="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>안전 정책</strong>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
          <li>같은 이름의 파일이 이미 있으면 자동으로 <code className="rounded bg-white/60 px-1">_backup/</code> 폴더에 백업 후 덮어쓰기 (덮어쓰기 시 명시적 확인 필요)</li>
          <li>삭제는 즉시 삭제가 아닌 <code className="rounded bg-white/60 px-1">_backup/</code>으로 이동 (복구 가능)</li>
          <li>.md 파일만 허용 / 5MB 이하 / 화이트리스트 폴더만</li>
          <li>모든 업로드/삭제는 이력으로 기록됨</li>
        </ul>
      </div>

      <PromptUploader />

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-neutral-500">최근 업로드 이력</h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">아직 업로드 기록이 없습니다.</p>
        ) : (
          <table className="mt-3 w-full text-xs">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="pb-2">시각</th>
                <th className="pb-2">동작</th>
                <th className="pb-2">폴더</th>
                <th className="pb-2">파일명</th>
                <th className="pb-2">크기</th>
                <th className="pb-2">백업</th>
                <th className="pb-2">업로더</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {recent.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 font-mono">{new Date(u.ts + "Z").toLocaleString("ko-KR")}</td>
                  <td className="py-2"><ActionBadge action={u.action} /></td>
                  <td className="py-2 font-mono text-neutral-600">{u.target_folder}</td>
                  <td className="py-2 font-mono">{u.filename}</td>
                  <td className="py-2 font-mono text-neutral-500">
                    {u.size_bytes ? `${(u.size_bytes / 1024).toFixed(1)}KB` : "-"}
                  </td>
                  <td className="py-2 font-mono text-[10px] text-neutral-500">
                    {u.backup_path ? "✓" : "-"}
                  </td>
                  <td className="py-2 text-neutral-600">{u.uploaded_by ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <a href="/prompts" className="inline-block text-sm text-kurly-500 hover:underline">
        ← 프롬프트 목록으로
      </a>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    upload: "bg-emerald-100 text-emerald-700",
    overwrite: "bg-amber-100 text-amber-700",
    delete: "bg-rose-100 text-rose-700",
    restore: "bg-blue-100 text-blue-700",
  };
  const labels: Record<string, string> = {
    upload: "신규",
    overwrite: "덮어쓰기",
    delete: "삭제",
    restore: "복구",
  };
  return <span className={`badge ${styles[action] ?? ""}`}>{labels[action] ?? action}</span>;
}
