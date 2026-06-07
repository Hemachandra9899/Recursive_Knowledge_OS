import { Queue } from "bullmq";
import { createRedisConnection } from "./redis.connection.js";
import { RESEARCH_QUEUE_NAME, type ResearchJobPayload } from "./research.types.js";

let queue: Queue<ResearchJobPayload, any, string> | null = null;

export function createResearchQueue() {
  if (!queue) {
    queue = new Queue<ResearchJobPayload, any, string>(RESEARCH_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return queue;
}
