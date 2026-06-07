import { prisma } from "@rlm-forge/database/prisma.js";

export function preview(text: string, maxChars = 1200): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

export async function keywordSearchChunks(input: {
  projectId?: string;
  query: string;
  topK?: number;
}) {
  const topK = input.topK ?? 5;

  const chunks = await prisma.chunk.findMany({
    where: {
      chunkText: {
        contains: input.query,
        mode: "insensitive",
      },
      ...(input.projectId
        ? {
            document: {
              projectId: input.projectId,
            },
          }
        : {}),
    },
    include: {
      document: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: topK,
  });

  return chunks.map((chunk) => ({
    chunkId: chunk.id,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    title: chunk.document.title,
    sourceUrl: chunk.document.sourceUrl,
    text: preview(chunk.chunkText, 1400),
    score: null,
    retrieval: "keyword",
    metadata: chunk.metadata,
  }));
}
