import { qdrant, QDRANT_COLLECTION, EMBEDDING_DIM } from "./qdrant.client.js";

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
