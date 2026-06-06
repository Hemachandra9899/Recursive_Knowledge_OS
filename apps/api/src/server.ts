import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { prisma } from "./db.js";
import { researchQueue } from "./queue.js";
import { scrapeUrl, searchWeb } from "./lib/firecrawl.js";
import { ingestMarkdownDocument, searchChunks } from "./lib/ingestion.js";
import { QDRANT_COLLECTION, qdrant } from "./lib/qdrant.js";
import { preview } from "./lib/text.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

await app.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

app.get("/health", async () => {
  return { status: "ok", service: "api" };
});

app.get("/health/deps", async () => {
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = "ok";
  } catch (e: any) {
    checks.postgres = `error: ${e.message}`;
  }

  try {
    await researchQueue.getJobCounts();
    checks.redis = "ok";
  } catch (e: any) {
    checks.redis = `error: ${e.message}`;
  }

  try {
    const resp = await fetch(`${process.env.QDRANT_URL}/healthz`);
    checks.qdrant = resp.ok ? "ok" : `status ${resp.status}`;
  } catch (e: any) {
    checks.qdrant = `error: ${e.message}`;
  }

  try {
    const resp = await fetch(`${process.env.RLM_RUNTIME_URL}/health`);
    checks.rlmRuntime = resp.ok ? "ok" : `status ${resp.status}`;
  } catch (e: any) {
    checks.rlmRuntime = `error: ${e.message}`;
  }

  return checks;
});

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

async function convertFileWithMarkItDown(input: {
  buffer: Buffer;
  filename: string;
  contentType?: string;
  sourceUrl?: string;
}) {
  const formData = new FormData();

  formData.append(
    "file",
    new Blob([new Uint8Array(input.buffer)], {
      type: input.contentType || "application/octet-stream",
    }),
    input.filename
  );

  if (input.sourceUrl) {
    formData.append("source_url", input.sourceUrl);
  }

  const response = await fetch(`${MODEL_SERVICE_URL}/convert/file`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`model-service /convert/file failed: ${response.status} ${text}`);
  }

  return await response.json();
}

app.post("/projects", async (req) => {
  const body = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }).parse(req.body);

  return prisma.project.create({ data: body });
});

app.get("/projects", async () => {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
  });
});

app.get("/projects/:id/jobs", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.researchJob.findMany({
    where: { projectId: params.id },
    orderBy: { createdAt: "desc" },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
});

app.post("/research-jobs", async (req) => {
  const body = z.object({
    projectId: z.string().uuid(),
    question: z.string().min(1),
  }).parse(req.body);

  const job = await prisma.researchJob.create({
    data: {
      projectId: body.projectId,
      question: body.question,
      status: "QUEUED",
    },
  });

  const queueJob = await researchQueue.add("run-research", {
    researchJobId: job.id,
  });

  return {
    jobId: job.id,
    queueJobId: queueJob.id,
    status: job.status,
  };
});

app.get("/research-jobs/:id", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.researchJob.findUnique({
    where: { id: params.id },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
});

app.post("/tools/crawl-url", async (req) => {
  const body = z.object({
    projectId: z.string().uuid(),
    url: z.string().url(),
    maxPages: z.number().int().min(1).max(20).optional(),
  }).parse(req.body);

  const scraped = await scrapeUrl(body.url);

  const ingested = await ingestMarkdownDocument({
    projectId: body.projectId,
    sourceUrl: scraped.url,
    title: scraped.title,
    markdown: scraped.markdown,
    metadata: scraped.metadata,
  });

  return {
    status: "ok",
    url: scraped.url,
    title: scraped.title,
    documentId: ingested.document.id,
    chunksCreated: ingested.chunksCreated,
    chunksTotal: ingested.chunksTotal,
    embeddedChunks: ingested.embeddedChunks,
    embeddingError: ingested.embeddingError,
    deduped: ingested.deduped,
    markdownPreview: preview(scraped.markdown, 2000),
  };
});

app.post("/tools/search-kb", async (req) => {
  const body = z.object({
    projectId: z.string().uuid().optional(),
    query: z.string().min(1),
    topK: z.number().int().min(1).max(20).optional(),
  }).parse(req.body);

  const search = await searchChunks({
    projectId: body.projectId,
    query: body.query,
    topK: body.topK ?? 5,
  });

  return {
    status: "ok",
    query: body.query,
    retrieval: search.retrieval,
    retrievalError: search.error,
    results: search.results,
  };
});

app.post("/tools/query-graph", async (req) => {
  const body = z.object({
    projectId: z.string().uuid().optional(),
    query: z.string().min(1),
    depth: z.number().int().min(1).max(3).optional(),
  }).parse(req.body);

  const entities = await prisma.entity.findMany({
    where: {
      ...(body.projectId ? { projectId: body.projectId } : {}),
      OR: [
        { name: { contains: body.query, mode: "insensitive" } },
        { description: { contains: body.query, mode: "insensitive" } },
      ],
    },
    take: 10,
  });

  const entityIds = entities.map((e: { id: string }) => e.id);
  const relations = entityIds.length
    ? await prisma.relation.findMany({
        where: {
          ...(body.projectId ? { projectId: body.projectId } : {}),
          OR: [
            { sourceEntityId: { in: entityIds } },
            { targetEntityId: { in: entityIds } },
          ],
        },
        take: 20,
      })
    : [];

  return { status: "ok", query: body.query, depth: body.depth ?? 1, entities, relations };
});

app.get("/projects/:id/documents", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.document.findMany({
    where: {
      projectId: params.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      _count: {
        select: {
          chunks: true,
        },
      },
    },
  });
});

app.get("/documents/:id/chunks", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.chunk.findMany({
    where: {
      documentId: params.id,
    },
    orderBy: {
      chunkIndex: "asc",
    },
  });
});

app.get("/knowledge/vector/status", async () => {
  try {
    const collection = await qdrant.getCollection(QDRANT_COLLECTION);
    return {
      status: "ok",
      collection: QDRANT_COLLECTION,
      details: collection,
    };
  } catch (error) {
    return {
      status: "error",
      collection: QDRANT_COLLECTION,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

function normalizeResearchQuery(query: string): string {
  return query
    .replace(/\bmets\s+graph\s+api\b/gi, "Meta Graph API")
    .replace(/\bmeta\s+ads\s+api\b/gi, "Meta Marketing API")
    .replace(/\bfacebook\s+ads\s+api\b/gi, "Meta Marketing API")
    .trim();
}

app.post("/tools/web-research", async (req) => {
  const body = z.object({
    projectId: z.string().uuid(),
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(5).optional(),
  }).parse(req.body);

  const normalizedQuery = normalizeResearchQuery(body.query);
  const maxResults = body.maxResults ?? 3;

  const results = await searchWeb(normalizedQuery, maxResults);
  const documents = [];

  for (const result of results) {
    if (!result.markdown || result.markdown.trim().length < 50) {
      continue;
    }

    const ingested = await ingestMarkdownDocument({
      projectId: body.projectId,
      sourceUrl: result.url,
      title: result.title,
      markdown: result.markdown,
      metadata: {
        ...result.metadata,
        originalQuery: body.query,
        normalizedQuery,
      },
    });

    documents.push({
      documentId: ingested.document.id,
      title: result.title,
      url: result.url,
      chunksCreated: ingested.chunksCreated,
      chunksTotal: ingested.chunksTotal,
      embeddedChunks: ingested.embeddedChunks,
      embeddingError: ingested.embeddingError,
      deduped: ingested.deduped,
    });
  }

  return {
    status: "ok",
    query: body.query,
    normalizedQuery,
    documents,
    results: results.map((result) => ({
      title: result.title,
      url: result.url,
      text: preview(result.markdown, 1200),
    })),
  };
});

app.post("/tools/ingest-file", async (req) => {
  const parts = req.parts();

  let projectId = "";
  let sourceUrl: string | undefined;
  let uploadedFile:
    | {
        buffer: Buffer;
        filename: string;
        contentType?: string;
      }
    | undefined;

  for await (const part of parts) {
    if (part.type === "field") {
      if (part.fieldname === "projectId") {
        projectId = String(part.value);
      }

      if (part.fieldname === "sourceUrl") {
        sourceUrl = String(part.value);
      }
    }

    if (part.type === "file") {
      const chunks: Buffer[] = [];

      for await (const chunk of part.file) {
        chunks.push(chunk);
      }

      uploadedFile = {
        buffer: Buffer.concat(chunks),
        filename: part.filename,
        contentType: part.mimetype,
      };
    }
  }

  const parsed = z.object({
    projectId: z.string().uuid(),
  }).parse({ projectId });

  if (!uploadedFile) {
    return {
      status: "error",
      error: "file is required",
    };
  }

  const converted = await convertFileWithMarkItDown({
    buffer: uploadedFile.buffer,
    filename: uploadedFile.filename,
    contentType: uploadedFile.contentType,
    sourceUrl,
  });

  const markdown = String(converted.markdown || "");

  if (!markdown.trim()) {
    return {
      status: "error",
      error: "Converted markdown is empty",
    };
  }

  const ingested = await ingestMarkdownDocument({
    projectId: parsed.projectId,
    sourceUrl: sourceUrl || uploadedFile.filename,
    title: converted.title || uploadedFile.filename,
    markdown,
    metadata: {
      provider: "markitdown",
      filename: uploadedFile.filename,
      contentType: uploadedFile.contentType,
      sourceUrl,
      conversionMetadata: converted.metadata || {},
    },
  });

  return {
    status: "ok",
    filename: uploadedFile.filename,
    title: converted.title || uploadedFile.filename,
    documentId: ingested.document.id,
    chunksCreated: ingested.chunksCreated,
    chunksTotal: ingested.chunksTotal,
    embeddedChunks: ingested.embeddedChunks,
    embeddingError: ingested.embeddingError,
    deduped: ingested.deduped,
    markdownPreview: preview(markdown, 2000),
  };
});

const port = Number(process.env.API_PORT || 8000);
await app.listen({ host: "0.0.0.0", port });
