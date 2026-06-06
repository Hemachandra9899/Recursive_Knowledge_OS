import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { chunkText, preview } from "./text.js";
import { embedTexts } from "./modelService.js";
import { upsertChunkVectors, searchChunkVectors } from "./qdrant.js";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function embedAndUpsertChunks(input: {
  projectId: string;
  documentId: string;
}) {
  const chunks = await prisma.chunk.findMany({
    where: {
      documentId: input.documentId,
    },
    orderBy: {
      chunkIndex: "asc",
    },
  });

  if (chunks.length === 0) {
    return {
      embedded: 0,
      error: null,
    };
  }

  const texts = chunks.map((chunk) => chunk.chunkText);
  const embeddingResult = await embedTexts(texts);

  if (embeddingResult.vectors.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: got ${embeddingResult.vectors.length}, expected ${chunks.length}`
    );
  }

  await upsertChunkVectors(
    chunks.map((chunk, index) => ({
      id: chunk.id,
      vector: embeddingResult.vectors[index],
      payload: {
        projectId: input.projectId,
        documentId: chunk.documentId,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        text: preview(chunk.chunkText, 1600),
        embeddingModel: embeddingResult.model,
      },
    }))
  );

  await Promise.all(
    chunks.map((chunk) =>
      prisma.chunk.update({
        where: { id: chunk.id },
        data: {
          qdrantPointId: chunk.id,
        },
      })
    )
  );

  return {
    embedded: chunks.length,
    error: null,
  };
}

export async function ingestMarkdownDocument(input: {
  projectId: string;
  sourceUrl?: string;
  title?: string;
  markdown: string;
  metadata?: Record<string, unknown>;
}) {
  const contentHash = hashText(input.markdown);
  const chunks = chunkText(input.markdown);

  const existing = await prisma.document.findFirst({
    where: {
      projectId: input.projectId,
      contentHash,
    },
    include: {
      chunks: true,
    },
  });

  if (existing && existing.chunks.length > 0) {
    const missingVectors = existing.chunks.some((chunk) => !chunk.qdrantPointId);

    let embedding = {
      embedded: 0,
      error: null as string | null,
    };

    if (missingVectors) {
      try {
        embedding = await embedAndUpsertChunks({
          projectId: input.projectId,
          documentId: existing.id,
        });
      } catch (error) {
        embedding = {
          embedded: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      document: existing,
      chunksCreated: 0,
      chunksTotal: existing.chunks.length,
      deduped: true,
      embeddedChunks: embedding.embedded,
      embeddingError: embedding.error,
    };
  }

  const document =
    existing ||
    (await prisma.document.create({
      data: {
        projectId: input.projectId,
        sourceUrl: input.sourceUrl,
        title: input.title || input.sourceUrl || "Untitled document",
        markdown: input.markdown,
        contentHash,
        metadata: (input.metadata || {}) as any,
      },
    }));

  if (existing && existing.chunks.length === 0) {
    await prisma.chunk.deleteMany({
      where: {
        documentId: existing.id,
      },
    });
  }

  if (chunks.length > 0) {
    await prisma.chunk.createMany({
      data: chunks.map((chunk) => ({
        documentId: document.id,
        chunkIndex: chunk.index,
        chunkText: chunk.text,
        metadata: {
          startChar: chunk.startChar,
          endChar: chunk.endChar,
          preview: preview(chunk.text, 240),
        },
      })),
    });
  }

  let embedding = {
    embedded: 0,
    error: null as string | null,
  };

  try {
    embedding = await embedAndUpsertChunks({
      projectId: input.projectId,
      documentId: document.id,
    });
  } catch (error) {
    embedding = {
      embedded: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    document,
    chunksCreated: chunks.length,
    chunksTotal: chunks.length,
    deduped: false,
    embeddedChunks: embedding.embedded,
    embeddingError: embedding.error,
  };
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

export async function searchChunks(input: {
  projectId?: string;
  query: string;
  topK?: number;
}) {
  try {
    const semanticResults = await semanticSearchChunks(input);

    if (semanticResults.length > 0) {
      return {
        retrieval: "semantic",
        results: semanticResults,
        error: null,
      };
    }
  } catch (error) {
    const keywordResults = await keywordSearchChunks(input);

    return {
      retrieval: "keyword_fallback",
      results: keywordResults,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const keywordResults = await keywordSearchChunks(input);

  return {
    retrieval: "keyword_fallback",
    results: keywordResults,
    error: "No semantic results found.",
  };
}
