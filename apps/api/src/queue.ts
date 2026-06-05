import { Queue } from "bullmq";
import IORedis from "ioredis";

export const redisConnection = new IORedis(
  process.env.REDIS_URL || "redis://redis:6379",
  { maxRetriesPerRequest: null }
);

export const researchQueue = new Queue("research-jobs", {
  connection: redisConnection,
});
