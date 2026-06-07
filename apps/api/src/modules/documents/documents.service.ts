import { prisma } from "@rlm-forge/database/prisma.js";
import { QDRANT_COLLECTION, qdrant } from "@rlm-forge/retrieval/qdrant/qdrant.client.js";

export function listProjectDocuments(projectId: string) {
  return prisma.document.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { chunks: true },
      },
    },
  });
}

export function listDocumentChunks(documentId: string) {
  return prisma.chunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
  });
}

export async function getVectorStatus() {
  try {
    const collection = await qdrant.getCollection(QDRANT_COLLECTION);
    return {
      status: "ok",
      collection: QDRANT_COLLECTION,
      details: collection,
    };
  } catch (error) {
    return {
      status: "error",
      collection: QDRANT_COLLECTION,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
