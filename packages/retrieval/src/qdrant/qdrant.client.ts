import { QdrantClient } from "@qdrant/js-client-rest";

export const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "rlm_chunks";
export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || 1024);

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || "http://qdrant:6333",
});
