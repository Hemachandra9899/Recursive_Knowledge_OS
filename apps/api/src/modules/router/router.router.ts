import type { FastifyInstance } from "fastify";
import { routerAnswerSchema } from "./router.schema.js";
import { answerWithRouter } from "./router.service.js";

export async function routerRouter(app: FastifyInstance) {
  app.post("/router/answer", async (req) => {
    const input = routerAnswerSchema.parse(req.body);

    if (!input.query?.trim()) {
      return { error: "query is required" };
    }

    return answerWithRouter({
      projectId: input.projectId ?? "default-project",
      userId: input.userId,
      query: input.query,
    });
  });
}
