import { z } from "zod";

export const listProjectJobsParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createResearchJobSchema = z.object({
  projectId: z.string().uuid(),
  question: z.string().min(1),
});

export const getResearchJobParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateResearchJobInput = z.infer<typeof createResearchJobSchema>;
