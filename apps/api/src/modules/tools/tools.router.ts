import type { FastifyInstance } from "fastify";
import {
  crawlUrlSchema,
  ingestFileSchema,
  queryGraphSchema,
  searchKbSchema,
  webResearchSchema,
} from "./tools.schema.js";
import {
  crawlUrl,
  ingestFile,
  queryGraph,
  searchKnowledgeBase,
  webResearch,
} from "./tools.service.js";
import { preview } from "@rlm-forge/knowledge";

export async function toolsRouter(app: FastifyInstance) {
  app.post("/tools/crawl-url", async (req) => {
    const input = crawlUrlSchema.parse(req.body);
    return crawlUrl(input);
  });

  app.post("/tools/web-research", async (req) => {
    const input = webResearchSchema.parse(req.body);
    return webResearch(input);
  });

  app.post("/tools/search-kb", async (req) => {
    const input = searchKbSchema.parse(req.body);
    return searchKnowledgeBase(input);
  });

  app.post("/tools/query-graph", async (req) => {
    const input = queryGraphSchema.parse(req.body);
    return queryGraph(input);
  });

  app.post("/tools/ingest-file", async (req) => {
    const parts = req.parts();

    let projectId = "";
    let sourceUrl: string | undefined;
    let uploadedFile:
      | {
          buffer: Buffer;
          filename: string;
          contentType?: string;
        }
      | undefined;

    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "projectId") {
          projectId = String(part.value);
        }

        if (part.fieldname === "sourceUrl") {
          sourceUrl = String(part.value);
        }
      }

      if (part.type === "file") {
        const chunks: Buffer[] = [];

        for await (const chunk of part.file) {
          chunks.push(chunk);
        }

        uploadedFile = {
          buffer: Buffer.concat(chunks),
          filename: part.filename,
          contentType: part.mimetype,
        };
      }
    }

    const parsed = ingestFileSchema.parse({ projectId });

    if (!uploadedFile) {
      return {
        status: "error",
        error: "file is required",
      };
    }

    return ingestFile({
      projectId: parsed.projectId,
      uploadedFile,
      sourceUrl,
    });
  });
}
