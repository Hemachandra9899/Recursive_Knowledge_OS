import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { prisma } from "./db.js";
import { researchQueue } from "./queue.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/health", async () => {
  return { status: "ok", service: "api" };
});

app.get("/health/deps", async () => {
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = "ok";
  } catch (e: any) {
    checks.postgres = `error: ${e.message}`;
  }

  try {
    await researchQueue.getJobCounts();
    checks.redis = "ok";
  } catch (e: any) {
    checks.redis = `error: ${e.message}`;
  }

  try {
    const resp = await fetch(`${process.env.QDRANT_URL}/healthz`);
    checks.qdrant = resp.ok ? "ok" : `status ${resp.status}`;
  } catch (e: any) {
    checks.qdrant = `error: ${e.message}`;
  }

  try {
    const resp = await fetch(`${process.env.RLM_RUNTIME_URL}/health`);
    checks.rlmRuntime = resp.ok ? "ok" : `status ${resp.status}`;
  } catch (e: any) {
    checks.rlmRuntime = `error: ${e.message}`;
  }

  return checks;
});

app.post("/projects", async (req) => {
  const body = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }).parse(req.body);

  return prisma.project.create({ data: body });
});

app.get("/projects", async () => {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
  });
});

app.post("/research-jobs", async (req) => {
  const body = z.object({
    projectId: z.string().uuid(),
    question: z.string().min(1),
  }).parse(req.body);

  const job = await prisma.researchJob.create({
    data: {
      projectId: body.projectId,
      question: body.question,
      status: "QUEUED",
    },
  });

  const queueJob = await researchQueue.add("run-research", {
    researchJobId: job.id,
  });

  return {
    jobId: job.id,
    queueJobId: queueJob.id,
    status: job.status,
  };
});

app.get("/research-jobs/:id", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.researchJob.findUnique({
    where: { id: params.id },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
});

const port = Number(process.env.API_PORT || 8000);
await app.listen({ host: "0.0.0.0", port });
