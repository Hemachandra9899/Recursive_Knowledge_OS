import { qdrant, QDRANT_COLLECTION } from "./qdrant.client.js";
import { ensureChunkCollection } from "./qdrant.collection.js";

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
