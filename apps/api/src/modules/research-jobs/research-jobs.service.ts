import { prisma } from "@rlm-forge/database/prisma.js";
import { createResearchQueue } from "@rlm-forge/queue";
import type { CreateResearchJobInput } from "./research-jobs.schema.js";

export function listProjectJobs(projectId: string) {
  return prisma.researchJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
}

export async function createResearchJob(input: CreateResearchJobInput) {
  const job = await prisma.researchJob.create({
    data: {
      projectId: input.projectId,
      question: input.question,
      status: "QUEUED",
    },
  });

  const queueJob = await createResearchQueue().add("run-research", {
    researchJobId: job.id,
  });

  return {
    jobId: job.id,
    queueJobId: queueJob.id,
    status: job.status,
  };
}

export function getResearchJob(id: string) {
  return prisma.researchJob.findUnique({
    where: { id },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
}

export function getResearchJobStatus(id: string) {
  return prisma.researchJob.findUnique({
    where: { id },
    select: { id: true, status: true, error: true, updatedAt: true },
  });
}
