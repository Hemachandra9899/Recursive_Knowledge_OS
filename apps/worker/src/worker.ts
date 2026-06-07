import "dotenv/config";
import { Worker } from "bullmq";
import { createRedisConnection, RESEARCH_QUEUE_NAME } from "@rlm-forge/queue";
import { processResearchJob } from "./processors/research-job.processor.js";

new Worker(RESEARCH_QUEUE_NAME, processResearchJob, {
  connection: createRedisConnection(),
});

console.log("Worker listening for research jobs...");
