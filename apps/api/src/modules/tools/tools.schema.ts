import { z } from "zod";

export const crawlUrlSchema = z.object({
  projectId: z.string().uuid(),
  url: z.string().url(),
  maxPages: z.number().int().min(1).max(20).optional(),
});

export const webResearchSchema = z.object({
  projectId: z.string().uuid(),
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(5).optional(),
});

export const searchKbSchema = z.object({
  projectId: z.string().uuid().optional(),
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).optional(),
});

export const queryGraphSchema = z.object({
  projectId: z.string().uuid().optional(),
  query: z.string().min(1),
  depth: z.number().int().min(1).max(3).optional(),
});

export const ingestFileSchema = z.object({
  projectId: z.string().uuid(),
});

export type CrawlUrlInput = z.infer<typeof crawlUrlSchema>;
export type WebResearchInput = z.infer<typeof webResearchSchema>;
export type SearchKbInput = z.infer<typeof searchKbSchema>;
export type QueryGraphInput = z.infer<typeof queryGraphSchema>;
export type IngestFileInput = z.infer<typeof ingestFileSchema>;
