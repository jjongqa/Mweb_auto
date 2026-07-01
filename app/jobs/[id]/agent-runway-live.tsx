"use client";

import { useEffect, useState } from "react";
import { AgentRunwayView, type RunwayAgent } from "@/app/_components/agent-runway-view";

type JobProgress = {
  status: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
};

function progressOf(job: JobProgress) {
  const done = job.passed + job.failed + job.blocked;
  if (job.total > 0) return Math.max(8, Math.min(96, (done / job.total) * 100));
  return job.status === "running" ? 35 : 10;
}

export function AgentRunwayLive({
  jobId,
  initialJob,
  agents,
}: {
  jobId: string;
  initialJob: JobProgress;
  agents: RunwayAgent[];
}) {
  const [job, setJob] = useState(initialJob);

  useEffect(() => {
    if (!["pending", "running"].includes(initialJob.status)) return;
    const es = new EventSource(`/api/jobs/${jobId}/stream?since=0`);
    es.addEventListener("update", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      if (data.job) {
        setJob({
          status: data.job.status,
          total: data.job.total ?? 0,
          passed: data.job.passed ?? 0,
          failed: data.job.failed ?? 0,
          blocked: data.job.blocked ?? 0,
        });
      }
      if (["succeeded", "failed", "canceled"].includes(data.job?.status)) es.close();
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId, initialJob.status]);

  if (!["pending", "running"].includes(job.status)) return null;

  return (
    <AgentRunwayView
      agents={agents}
      progress={progressOf(job)}
      phase="exec"
      status={job.status === "pending" ? "pending" : "running"}
    />
  );
}
