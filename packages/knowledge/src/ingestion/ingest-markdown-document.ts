import { prisma } from "@rlm-forge/database/prisma.js";
import { embedTexts } from "@rlm-forge/clients/model-service.client.js";
import { upsertChunkVectors } from "@rlm-forge/retrieval/qdrant/qdrant.points.js";
import { chunkText, hashText, preview } from "../text/chunk-text.js";

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


