import { QdrantClient } from "@qdrant/js-client-rest";

export const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "rlm_chunks";
export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || 1024);

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || "http://qdrant:6333",
});

export async function ensureChunkCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (collection) => collection.name === QDRANT_COLLECTION
  );

  if (exists) return;

  await qdrant.createCollection(QDRANT_COLLECTION, {
    vectors: {
      size: EMBEDDING_DIM,
      distance: "Cosine",
    },
  });
}

export async function upsertChunkVectors(points: Array<{
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}>) {
  if (points.length === 0) return;

  await ensureChunkCollection();

  await qdrant.upsert(QDRANT_COLLECTION, {
    wait: true,
    points: points.map((point) => ({
      id: point.id,
      vector: point.vector,
      payload: point.payload,
    })),
  });
}

export async function searchChunkVectors(input: {
  vector: number[];
  projectId?: string;
  limit?: number;
}) {
  await ensureChunkCollection();

  return qdrant.search(QDRANT_COLLECTION, {
    vector: input.vector,
    limit: input.limit ?? 5,
    with_payload: true,
    filter: input.projectId
      ? {
          must: [
            {
              key: "projectId",
              match: {
                value: input.projectId,
              },
            },
          ],
        }
      : undefined,
  });
}
