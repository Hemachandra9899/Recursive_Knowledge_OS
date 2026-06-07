import type { Job } from "bullmq";
import { prisma } from "@rlm-forge/database/prisma.js";
import type { ResearchJobPayload } from "@rlm-forge/queue";
import { executeResearchQuery } from "../services/runtime-executor.service.js";
import { saveResearchResult } from "../services/report-writer.service.js";

export async function processResearchJob(job: Job<ResearchJobPayload>) {
  const { researchJobId } = job.data;

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

  try {
    const result = await executeResearchQuery({
      runId: run.id,
      projectId: researchJob.projectId,
      query: researchJob.question,
    });

    await saveResearchResult({
      projectId: researchJob.projectId,
      jobId: researchJob.id,
      runId: run.id,
      query: researchJob.question,
      result,
    });

    const isCompleted = result.status === "completed";

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: isCompleted ? "COMPLETED" : "FAILED",
        finalOutput: result,
      },
    });

    await prisma.researchJob.update({
      where: { id: researchJob.id },
      data: {
        status: isCompleted ? "COMPLETED" : "FAILED",
        error: result.error ?? null,
      },
    });

    return { status: result.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finalOutput: { error: message } },
    });

    await prisma.researchJob.update({
      where: { id: researchJob.id },
      data: { status: "FAILED", error: message },
    });

    throw error;
  }
}
