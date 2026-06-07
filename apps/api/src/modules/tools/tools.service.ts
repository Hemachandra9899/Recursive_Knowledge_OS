import { scrapeUrl, searchWeb } from "@rlm-forge/knowledge/scrapers/firecrawl.scraper.js";
import { scrapePageWithScrapling } from "@rlm-forge/knowledge/scrapers/scrapling.scraper.js";
import { planOfficialDocs } from "@rlm-forge/knowledge/research/official-docs-planner.js";
import { keepHighQualitySources } from "@rlm-forge/knowledge/research/source-quality.js";
import { ingestMarkdownDocument } from "@rlm-forge/knowledge/ingestion/ingest-markdown-document.js";
import { preview } from "@rlm-forge/knowledge/text/chunk-text.js";
import { searchKnowledgeBase as retrievalSearch } from "@rlm-forge/retrieval";
import { prisma } from "@rlm-forge/database/prisma.js";
import type {
  CrawlUrlInput,
  QueryGraphInput,
  SearchKbInput,
  WebResearchInput,
} from "./tools.schema.js";

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

export async function crawlUrl(input: CrawlUrlInput) {
  const scraped = await scrapeUrl(input.url);

  const ingested = await ingestMarkdownDocument({
    projectId: input.projectId,
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
}

export async function searchKnowledgeBase(input: SearchKbInput) {
  const search = await retrievalSearch({
    projectId: input.projectId,
    query: input.query,
    topK: input.topK ?? 5,
  });

  return {
    status: "ok",
    query: input.query,
    retrieval: search.retrieval,
    retrievalError: search.error,
    results: search.results,
  };
}

function normalizeResearchQuery(query: string): string {
  return query
    .replace(/\bmets\s+graph\s+api\b/gi, "Meta Graph API")
    .replace(/\bmeta\s+ads\s+api\b/gi, "Meta Marketing API")
    .replace(/\bfacebook\s+ads\s+api\b/gi, "Meta Marketing API")
    .trim();
}

export async function webResearch(input: WebResearchInput) {
  const normalizedQuery = normalizeResearchQuery(input.query);
  const maxResults = input.maxResults ?? 5;

  const officialTargets = planOfficialDocs(normalizedQuery).slice(0, maxResults);
  const documents = [];
  const results = [];

  for (const target of officialTargets) {
    try {
      const scraped = await scrapePageWithScrapling(target.url);

      const ingested = await ingestMarkdownDocument({
        projectId: input.projectId,
        sourceUrl: scraped.url,
        title: scraped.title || target.title,
        markdown: scraped.markdown,
        metadata: {
          ...scraped.metadata,
          originalQuery: input.query,
          normalizedQuery,
          plannedReason: target.reason,
          targetProvider: target.provider,
          sourceType: "official_docs",
        },
      });

      documents.push({
        documentId: ingested.document.id,
        title: scraped.title || target.title,
        url: scraped.url,
        chunksCreated: ingested.chunksCreated,
        chunksTotal: ingested.chunksTotal,
        embeddedChunks: ingested.embeddedChunks,
        embeddingError: ingested.embeddingError,
        deduped: ingested.deduped,
        provider: target.provider,
        scrapeProvider: "scrapling",
      });

      results.push({
        title: scraped.title || target.title,
        url: scraped.url,
        text: preview(scraped.markdown, 1200),
        provider: target.provider,
        scrapeProvider: "scrapling",
      });
    } catch (error) {
      try {
        const scraped = await scrapeUrl(target.url);

        const ingested = await ingestMarkdownDocument({
          projectId: input.projectId,
          sourceUrl: scraped.url,
          title: scraped.title || target.title,
          markdown: scraped.markdown,
          metadata: {
            ...scraped.metadata,
            originalQuery: input.query,
            normalizedQuery,
            plannedReason: target.reason,
            targetProvider: target.provider,
            sourceType: "official_docs_fallback",
          },
        });

        documents.push({
          documentId: ingested.document.id,
          title: scraped.title || target.title,
          url: scraped.url,
          chunksCreated: ingested.chunksCreated,
          chunksTotal: ingested.chunksTotal,
          embeddedChunks: ingested.embeddedChunks,
          embeddingError: ingested.embeddingError,
          deduped: ingested.deduped,
          provider: target.provider,
          scrapeProvider: "firecrawl_fallback",
        });

        results.push({
          title: scraped.title || target.title,
          url: scraped.url,
          text: preview(scraped.markdown, 1200),
          provider: target.provider,
          scrapeProvider: "firecrawl_fallback",
        });
      } catch (fallbackError) {
        results.push({
          title: target.title,
          url: target.url,
          provider: target.provider,
          scrapeProvider: "error",
          text: `Failed to scrape with Scrapling and Firecrawl fallback. Scrapling error: ${
            error instanceof Error ? error.message : String(error)
          }. Fallback error: ${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`,
        });
      }
    }
  }

  if (officialTargets.length === 0) {
    const rawResults = await searchWeb(normalizedQuery, maxResults);
    const webResults = keepHighQualitySources(rawResults);

    for (const result of webResults) {
      if (!result.markdown || result.markdown.trim().length < 50) continue;

      const ingested = await ingestMarkdownDocument({
        projectId: input.projectId,
        sourceUrl: result.url,
        title: result.title,
        markdown: result.markdown,
        metadata: {
          ...result.metadata,
          originalQuery: input.query,
          normalizedQuery,
          sourceType: "search_result",
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
        provider: "firecrawl_search",
      });

      results.push({
        title: result.title,
        url: result.url,
        text: preview(result.markdown, 1200),
        provider: "firecrawl_search",
      });
    }
  }

  return {
    status: "ok",
    query: input.query,
    normalizedQuery,
    strategy: officialTargets.length > 0 ? "official_docs_first" : "search_fallback",
    documents,
    results,
  };
}

export async function queryGraph(input: QueryGraphInput) {

  const entities = await prisma.entity.findMany({
    where: {
      ...(input.projectId ? { projectId: input.projectId } : {}),
      OR: [
        { name: { contains: input.query, mode: "insensitive" } },
        { description: { contains: input.query, mode: "insensitive" } },
      ],
    },
    take: 10,
  });

  const entityIds = entities.map((e: { id: string }) => e.id);
  const relations = entityIds.length
    ? await prisma.relation.findMany({
        where: {
          ...(input.projectId ? { projectId: input.projectId } : {}),
          OR: [
            { sourceEntityId: { in: entityIds } },
            { targetEntityId: { in: entityIds } },
          ],
        },
        take: 20,
      })
    : [];

  return { status: "ok", query: input.query, depth: input.depth ?? 1, entities, relations };
}

export async function convertFileWithMarkItDown(input: {
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

export async function ingestFile(args: {
  projectId: string;
  uploadedFile: {
    buffer: Buffer;
    filename: string;
    contentType?: string;
  };
  sourceUrl?: string;
}) {
  const converted = await convertFileWithMarkItDown({
    buffer: args.uploadedFile.buffer,
    filename: args.uploadedFile.filename,
    contentType: args.uploadedFile.contentType,
    sourceUrl: args.sourceUrl,
  });

  const markdown = String(converted.markdown || "");

  if (!markdown.trim()) {
    return {
      status: "error",
      error: "Converted markdown is empty",
    };
  }

  const ingested = await ingestMarkdownDocument({
    projectId: args.projectId,
    sourceUrl: args.sourceUrl || args.uploadedFile.filename,
    title: converted.title || args.uploadedFile.filename,
    markdown,
    metadata: {
      provider: "markitdown",
      filename: args.uploadedFile.filename,
      contentType: args.uploadedFile.contentType,
      sourceUrl: args.sourceUrl,
      conversionMetadata: converted.metadata || {},
    },
  });

  return {
    status: "ok",
    filename: args.uploadedFile.filename,
    title: converted.title || args.uploadedFile.filename,
    documentId: ingested.document.id,
    chunksCreated: ingested.chunksCreated,
    chunksTotal: ingested.chunksTotal,
    embeddedChunks: ingested.embeddedChunks,
    embeddingError: ingested.embeddingError,
    deduped: ingested.deduped,
    markdownPreview: preview(markdown, 2000),
  };
}
