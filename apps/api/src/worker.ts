import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "./db.js";
import { redisConnection } from "./queue.js";

const runtimeUrl = process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

new Worker(
  "research-jobs",
  async (job) => {
    const { researchJobId } = job.data as { researchJobId: string };

    const researchJob = await prisma.researchJob.update({
      where: { id: researchJobId },
      data: { status: "RUNNING" },
    });

    const run = await prisma.agentRun.create({
      data: {
        projectId: researchJob.projectId,
        jobId: researchJob.id,
        query: researchJob.question,
        depth: 0,
        status: "RUNNING",
      },
    });

    const resp = await fetch(`${runtimeUrl}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: run.id,
        projectId: researchJob.projectId,
        query: researchJob.question,
      }),
    });

    const result = await resp.json();

    await prisma.agentStep.create({
      data: {
        runId: run.id,
        stepIndex: 0,
        stdout: JSON.stringify(result),
        result,
      },
    });

    await prisma.report.create({
      data: {
        projectId: researchJob.projectId,
        jobId: researchJob.id,
        title: "Initial RLM Forge Report",
        content: "RLM Forge minimal pipeline is connected. Real recursive runtime comes next.",
        metadata: { result },
      },
    });

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        finalOutput: result,
      },
    });

    await prisma.researchJob.update({
      where: { id: researchJob.id },
      data: { status: "COMPLETED" },
    });

    return { status: "completed" };
  },
  { connection: redisConnection }
);

console.log("RLM Forge worker running...");
