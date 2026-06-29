import { NextRequest } from "next/server";
import { getJob } from "@/lib/jobs";
import { takeNextPendingMessage } from "@/lib/messages";

export const dynamic = "force-dynamic";

// 외부 워커 전용 — pending 메시지 1건을 꺼내고 delivered 마킹 후 반환.
// 내부 워커는 SQLite 직접 호출하지만 외부 워커는 이 endpoint 로 polling.
//
// 응답:
//   { ok: true, message: {id, content} | null }
//   - message=null 이면 큐 비어있음
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = getJob(id);
    if (!job) return Response.json({ error: "테스트 없음" }, { status: 404 });

    const msg = takeNextPendingMessage(id);
    if (!msg) return Response.json({ ok: true, message: null });

    return Response.json({
      ok: true,
      message: { id: msg.id, content: msg.content },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
