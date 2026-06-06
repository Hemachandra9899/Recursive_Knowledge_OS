import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "./db.js";
import { redisConnection } from "./queue.js";

const runtimeUrl = process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

function readable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isGenericFinal(value: unknown): boolean {
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();

  return [
    "done",
    "completed",
    "all questions have been answered.",
    "all questions have been answered",
    "the task is complete.",
    "task complete",
  ].includes(normalized);
}

function lastUsefulStdout(result: any): string {
  const steps = Array.isArray(result?.steps) ? result.steps : [];

  for (const step of [...steps].reverse()) {
    const stdout = typeof step?.stdout === "string" ? step.stdout.trim() : "";

    if (stdout && !stdout.toLowerCase().includes("an error occurred: 0")) {
      return stdout;
    }
  }

  for (const step of [...steps].reverse()) {
    const stdout = typeof step?.stdout === "string" ? step.stdout.trim() : "";

    if (stdout) {
      return stdout;
    }
  }

  return "";
}

function extractUserAnswer(result: any): string {
  const finalValue = result?.final;

  if (finalValue !== undefined && finalValue !== null && !isGenericFinal(finalValue)) {
    return readable(finalValue);
  }

  const stdout = lastUsefulStdout(result);

  if (stdout) {
    return stdout;
  }

  if (result?.error) {
    return readable(result.error);
  }

  return readable(finalValue || result);
}

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

    try {
      const resp = await fetch(`${runtimeUrl}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: run.id,
          projectId: researchJob.projectId,
          query: researchJob.question,
          maxSteps: 5,
          maxDepth: 2,
        }),
      });

      const result = await resp.json();

      await prisma.agentStep.create({
        data: {
          runId: run.id,
          stepIndex: 0,
          stdout: readable(result),
          result,
        },
      });

      const answer = extractUserAnswer(result);

      await prisma.report.create({
        data: {
          projectId: researchJob.projectId,
          jobId: researchJob.id,
          title: "RLM Answer",
          content: answer,
          metadata: {
            result,
            sources: Array.isArray(result?.sources) ? result.sources : [],
          },
        },
      });

      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: result.status === "completed" ? "COMPLETED" : "FAILED",
          finalOutput: result,
        },
      });

      await prisma.researchJob.update({
        where: { id: researchJob.id },
        data: {
          status: result.status === "completed" ? "COMPLETED" : "FAILED",
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
  },
  { connection: redisConnection }
);

console.log("RLM Forge worker running...");
