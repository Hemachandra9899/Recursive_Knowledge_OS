import { ModelClient } from "./services/modelClient.ts";
import { RlmLoop } from "./services/rlmLoop.ts";
import type { ExecuteRequest } from "./types.ts";

const modelClient = new ModelClient();
const rlmLoop = new RlmLoop(modelClient);

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function parseJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

Deno.serve({ port: 8787 }, async (req: Request) => {
  const url = new URL(req.url);

  try {
    if (url.pathname === "/health") {
      const modelServiceOk = await modelClient.health();

      return json({
        status: "ok",
        service: "rlm-runtime",
        modelServiceOk,
        features: {
          pyodideExecution: true,
          rlmLoop: true,
          recursiveLlmQuery: true,
        },
      });
    }

    if (url.pathname === "/execute" && req.method === "POST") {
      const body = await parseJson<ExecuteRequest>(req);

      if (!body.query || !body.query.trim()) {
        return json({ error: "query is required" }, 400);
      }

      const result = await rlmLoop.run({
        runId: body.runId,
        projectId: body.projectId,
        query: body.query,
        maxSteps: body.maxSteps,
        depth: body.depth,
        maxDepth: body.maxDepth,
      });

      return json(result);
    }

    return json({ error: "not found" }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
