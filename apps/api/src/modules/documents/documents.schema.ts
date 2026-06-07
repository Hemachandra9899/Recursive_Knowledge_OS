import { z } from "zod";

export const listProjectDocumentsParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listDocumentChunksParamsSchema = z.object({
  id: z.string().uuid(),
});
