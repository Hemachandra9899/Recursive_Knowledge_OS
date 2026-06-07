import type { ConnectionOptions } from "bullmq";

export function createRedisConnection(): ConnectionOptions {
  return {
    url: process.env.REDIS_URL || "redis://redis:6379",
    maxRetriesPerRequest: null,
  };
}
