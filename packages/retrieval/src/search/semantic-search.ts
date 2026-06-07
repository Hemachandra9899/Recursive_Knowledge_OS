import { prisma } from "@rlm-forge/database/prisma.js";
import { embedTexts } from "@rlm-forge/clients/model-service.client.js";
import { searchChunkVectors } from "../qdrant/qdrant.points.js";

export function preview(text: string, maxChars = 1200): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

export async function semanticSearchChunks(input: {
  projectId?: string;
  query: string;
  topK?: number;
}) {
  const topK = input.topK ?? 5;
  const embeddingResult = await embedTexts([input.query]);
  const queryVector = embeddingResult.vectors[0];

  if (!queryVector) {
    throw new Error("No query embedding returned");
  }

  const results = await searchChunkVectors({
    vector: queryVector,
    projectId: input.projectId,
    limit: topK,
  });

  const chunkIds = results
    .map((result) => String(result.payload?.chunkId || result.id))
    .filter(Boolean);

  const chunks = chunkIds.length
    ? await prisma.chunk.findMany({
        where: {
          id: {
            in: chunkIds,
          },
        },
        include: {
          document: true,
        },
      })
    : [];

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  return results.map((result) => {
    const chunkId = String(result.payload?.chunkId || result.id);
    const chunk = chunkById.get(chunkId);

    return {
      chunkId,
      documentId: String(result.payload?.documentId || chunk?.documentId || ""),
      chunkIndex: Number(result.payload?.chunkIndex ?? chunk?.chunkIndex ?? 0),
      title: chunk?.document.title ?? null,
      sourceUrl: chunk?.document.sourceUrl ?? null,
      text: String(result.payload?.text || (chunk ? preview(chunk.chunkText, 1400) : "")),
      score: result.score,
      retrieval: "semantic",
      metadata: chunk?.metadata ?? {},
    };
  });
}
