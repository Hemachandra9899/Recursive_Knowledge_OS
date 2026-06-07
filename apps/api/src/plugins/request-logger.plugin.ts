import type { FastifyInstance } from "fastify";

function shouldSkipLog(method: string, url: string) {
  if (method === "OPTIONS") return true;
  if (url === "/health") return true;
  return false;
}

export async function registerRequestLogger(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    if (shouldSkipLog(req.method, req.url)) return;

    req.log.info({
      event: "request:start",
      method: req.method,
      url: req.url,
    }, `→ ${req.method} ${req.url}`);
  });

  app.addHook("onResponse", async (req, reply) => {
    if (shouldSkipLog(req.method, req.url)) return;

    const ms = Math.round(reply.elapsedTime);

    req.log.info({
      event: "request:end",
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      durationMs: ms,
    }, `← ${reply.statusCode} ${req.method} ${req.url} ${ms}ms`);
  });

  app.addHook("onError", async (req, _reply, error) => {
    req.log.error({
      event: "request:error",
      method: req.method,
      url: req.url,
      error: error.message,
    }, `✕ ${req.method} ${req.url}: ${error.message}`);
  });
}
