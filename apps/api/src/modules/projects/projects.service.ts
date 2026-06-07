import { prisma } from "@rlm-forge/database/prisma.js";
import type { CreateProjectInput } from "./projects.schema.js";

export function listProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export function createProject(input: CreateProjectInput) {
  return prisma.project.create({ data: input });
}
