import { syncDrive, syncFunctionalPrompts, syncStdTcMaster, syncStdTcAnswerFiles, getLastSync, markFullSyncDone } from "@/lib/drive-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 마지막 동기화 상태
export async function GET() {
  return Response.json(getLastSync());
}

// 수동 전체 강제 동기화 (SSE 진행) — TC 스킬/정책 + 기능테스트 프롬프트 전부.
// 끝나면 markFullSyncDone() 로 자동 쿨다운(24h) 리셋 + /prompts 목록 캐시 무효화.
export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        send({ kind: "progress", event: { type: "phase", ok: true, message: "① TC 스킬 / 마스터정책 동기화…" } });
        const tc = await syncDrive((e) => send({ kind: "progress", event: e }));
        send({ kind: "progress", event: { type: "phase", ok: true, message: "② 기능테스트 프롬프트 동기화…" } });
        const fn = await syncFunctionalPrompts((e) => send({ kind: "progress", event: e }));
        send({ kind: "progress", event: { type: "phase", ok: true, message: "③ 표준TC사전 Master(하네스) 동기화…" } });
        const md = await syncStdTcMaster((e) => send({ kind: "progress", event: e }));
        send({ kind: "progress", event: { type: "phase", ok: md.status !== "failed", message: `표준TC사전 Master: ${md.note}` } });
        send({ kind: "progress", event: { type: "phase", ok: true, message: "④ 표준TC사전 정답파일 동기화…" } });
        const ad = await syncStdTcAnswerFiles((e) => send({ kind: "progress", event: e }));
        send({ kind: "progress", event: { type: "phase", ok: ad.ok, message: ad.note } });
        markFullSyncDone();
        send({ kind: "done", result: { synced: tc.synced + fn.synced + ad.synced, pruned: tc.pruned + fn.pruned, skipped: tc.skipped + fn.skipped + ad.skipped, failed: tc.failed + fn.failed + ad.failed, ok: tc.ok && fn.ok && ad.ok, masterSync: md.note, answerSync: ad.note } });
      } catch (err) {
        send({ kind: "fatal", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
