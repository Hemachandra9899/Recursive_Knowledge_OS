import Fastify from "fastify";
import { registerCors } from "./plugins/cors.plugin.js";
import { registerMultipart } from "./plugins/multipart.plugin.js";
import { registerRequestLogger } from "./plugins/request-logger.plugin.js";

import { healthRouter } from "./modules/health/health.router.js";
import { projectsRouter } from "./modules/projects/projects.router.js";
import { researchJobsRouter } from "./modules/research-jobs/research-jobs.router.js";
import { documentsRouter } from "./modules/documents/documents.router.js";
import { toolsRouter } from "./modules/tools/tools.router.js";

function createLoggerConfig() {
  const level = process.env.LOG_LEVEL || "info";
  const pretty = process.env.LOG_PRETTY !== "false";

  if (!pretty) {
    return { level };
  }

  return {
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname,reqId,req,res,responseTime",
        messageFormat: "{msg}",
      },
    },
  };
}

export async function buildApp() {
  const app = Fastify({
    logger: createLoggerConfig(),
    disableRequestLogging: true,
  });

  await registerCors(app);
  await registerMultipart(app);
  await registerRequestLogger(app);

  await app.register(healthRouter);
  await app.register(projectsRouter);
  await app.register(researchJobsRouter);
  await app.register(documentsRouter);
  await app.register(toolsRouter);

  return app;
}
