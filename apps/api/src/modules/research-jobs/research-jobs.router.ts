import type { FastifyInstance } from "fastify";
import {
  createResearchJobSchema,
  getResearchJobParamsSchema,
  listProjectJobsParamsSchema,
} from "./research-jobs.schema.js";
import {
  createResearchJob,
  getResearchJob,
  getResearchJobStatus,
  listProjectJobs,
} from "./research-jobs.service.js";

export async function researchJobsRouter(app: FastifyInstance) {
  app.get("/projects/:id/jobs", async (req) => {
    const params = listProjectJobsParamsSchema.parse(req.params);
    return listProjectJobs(params.id);
  });

  app.post("/research-jobs", async (req) => {
    const input = createResearchJobSchema.parse(req.body);
    return createResearchJob(input);
  });

  app.get("/research-jobs/:id", async (req) => {
    const params = getResearchJobParamsSchema.parse(req.params);
    return getResearchJob(params.id);
  });

  app.get("/research-jobs/:id/status", async (req) => {
    const params = getResearchJobParamsSchema.parse(req.params);
    return getResearchJobStatus(params.id);
  });
}
