import { prisma } from "@rlm-forge/database/prisma.js";
import { createResearchQueue } from "@rlm-forge/queue";

export function checkHealth() {
  return { status: "ok", service: "api" };
}

export async function checkDeps() {
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = "ok";
  } catch (e: any) {
    checks.postgres = `error: ${e.message}`;
  }

  try {
    await createResearchQueue().getJobCounts();
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
}
