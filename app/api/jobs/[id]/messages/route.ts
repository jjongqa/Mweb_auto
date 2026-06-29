import { NextRequest } from "next/server";
import { getJob } from "@/lib/jobs";
import { addPendingMessage, listMessagesForJob } from "@/lib/messages";

export const dynamic = "force-dynamic";

// GET — 잡의 메시지 큐 전체 (pending / delivered / failed)
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "테스트 없음" }, { status: 404 });
  const messages = listMessagesForJob(id);
  return Response.json({ messages });
}

// POST { content } — 진행 중 잡에 끼어들기 메시지 push
//   - 워커가 turn 사이마다 polling 으로 가져가서 Claude stdin 으로 전달
//   - 잡이 종료된 상태(succeeded/failed/canceled) 면 거부
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = getJob(id);
    if (!job) return Response.json({ error: "테스트 없음" }, { status: 404 });
    if (job.status !== "running" && job.status !== "pending") {
      return Response.json(
        { error: `이미 종료된 테스트 (${job.status}) — 끼어들기 불가` },
        { status: 400 }
      );
    }
    const body = await req.json();
    const content = String(body.content ?? "").trim();
    if (!content) return Response.json({ error: "메시지 내용 필요" }, { status: 400 });
    if (content.length > 4000) {
      return Response.json({ error: "메시지가 너무 깁니다 (최대 4000자)" }, { status: 400 });
    }
    const msg = addPendingMessage(id, content);
    return Response.json({ ok: true, message: msg });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
