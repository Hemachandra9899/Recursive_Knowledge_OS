import type { FastifyInstance } from "fastify";
import {
  listDocumentChunksParamsSchema,
  listProjectDocumentsParamsSchema,
} from "./documents.schema.js";
import {
  getVectorStatus,
  listDocumentChunks,
  listProjectDocuments,
} from "./documents.service.js";

export async function documentsRouter(app: FastifyInstance) {
  app.get("/projects/:id/documents", async (req) => {
    const params = listProjectDocumentsParamsSchema.parse(req.params);
    return listProjectDocuments(params.id);
  });

  app.get("/documents/:id/chunks", async (req) => {
    const params = listDocumentChunksParamsSchema.parse(req.params);
    return listDocumentChunks(params.id);
  });

  app.get("/knowledge/vector/status", async () => {
    return getVectorStatus();
  });
}
