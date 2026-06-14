import { z } from "zod";

export const routerAnswerSchema = z.object({
  projectId: z.string().min(1).optional(),
  userId: z.string().optional(),
  query: z.string().min(1),
});

export type RouterAnswerInput = z.infer<typeof routerAnswerSchema>;
