import type { FastifyInstance } from "fastify";
import { checkHealth, checkDeps } from "./health.service.js";

export async function healthRouter(app: FastifyInstance) {
  app.get("/health", async () => {
    return checkHealth();
  });

  app.get("/health/deps", async () => {
    return checkDeps();
  });
}
