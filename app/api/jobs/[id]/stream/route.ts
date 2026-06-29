import { NextRequest } from "next/server";
import { getJob, getLogs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastLogId = since;
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const tick = () => {
        const job = getJob(id);
        if (!job) {
          send("update", { error: "not found" });
          controller.close();
          closed = true;
          return false;
        }
        const newLogs = getLogs(id, lastLogId, 200);
        if (newLogs.length > 0) lastLogId = newLogs.at(-1)!.id;
        send("update", { job, logs: newLogs });
        if (["succeeded", "failed", "canceled"].includes(job.status)) {
          // 종료 후 한 번 더 보내고 마무리
          setTimeout(() => {
            if (!closed) {
              controller.close();
              closed = true;
            }
          }, 500);
          return false;
        }
        return true;
      };

      tick();
      const interval = setInterval(() => {
        if (!tick()) clearInterval(interval);
      }, 1000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        if (!closed) {
          controller.close();
          closed = true;
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
