import type { FastifyInstance } from "fastify";
import { createProjectSchema } from "./projects.schema.js";
import { createProject, listProjects } from "./projects.service.js";

export async function projectsRouter(app: FastifyInstance) {
  app.get("/projects", async () => {
    return listProjects();
  });

  app.post("/projects", async (req) => {
    const input = createProjectSchema.parse(req.body);
    return createProject(input);
  });
}
