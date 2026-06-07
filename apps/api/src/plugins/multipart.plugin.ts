import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";

export async function registerMultipart(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
    },
  });
}
