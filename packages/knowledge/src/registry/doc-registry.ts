export type SourceTier =
  | "official_docs"
  | "trusted_docs"
  | "reference_examples"
  | "community"
  | "media"
  | "unknown";

export type DocTarget = {
  id: string;
  product: string;
  domain: string;
  title: string;
  url: string;
  tier: SourceTier;
  topics: string[];
  keywords: string[];
  priority: number;
};

export const DOC_REGISTRY: DocTarget[] = [
  // Ads / Marketing APIs
  {
    id: "meta-marketing-api",
    product: "Meta Marketing API",
    domain: "ads",
    title: "Meta Marketing API",
    url: "https://developers.facebook.com/docs/marketing-api/",
    tier: "official_docs",
    topics: ["ads", "api", "campaigns", "insights", "audiences"],
    keywords: ["meta", "facebook", "marketing api", "graph api", "ads api"],
    priority: 100,
  },
  {
    id: "meta-insights-api",
    product: "Meta Marketing API",
    domain: "ads",
    title: "Meta Ad Insights API",
    url: "https://developers.facebook.com/docs/marketing-api/insights/",
    tier: "official_docs",
    topics: ["ads", "reporting", "insights", "metrics"],
    keywords: ["meta insights", "facebook insights", "ads reporting"],
    priority: 95,
  },
  {
    id: "google-ads-api",
    product: "Google Ads API",
    domain: "ads",
    title: "Google Ads API",
    url: "https://developers.google.com/google-ads/api/docs/start",
    tier: "official_docs",
    topics: ["ads", "api", "campaigns", "reporting"],
    keywords: ["google ads", "google ads api", "google advertising"],
    priority: 100,
  },
  {
    id: "google-ads-reporting",
    product: "Google Ads API",
    domain: "ads",
    title: "Google Ads API Reporting",
    url: "https://developers.google.com/google-ads/api/docs/reporting/overview",
    tier: "official_docs",
    topics: ["ads", "reporting", "metrics", "gaql"],
    keywords: ["google ads reporting", "gaql", "google ads metrics"],
    priority: 95,
  },
  {
    id: "tiktok-business-api",
    product: "TikTok API for Business",
    domain: "ads",
    title: "TikTok API for Business",
    url: "https://business-api.tiktok.com/portal/docs",
    tier: "official_docs",
    topics: ["ads", "api", "campaigns", "reporting"],
    keywords: ["tiktok", "tiktok ads", "tiktok business api"],
    priority: 100,
  },

  // AI / LLM APIs
  {
    id: "openai-api",
    product: "OpenAI API",
    domain: "ai",
    title: "OpenAI API Docs",
    url: "https://platform.openai.com/docs",
    tier: "official_docs",
    topics: ["ai", "llm", "api", "models"],
    keywords: ["openai", "gpt", "openai api", "chatgpt api"],
    priority: 100,
  },
  {
    id: "anthropic-api",
    product: "Anthropic Claude API",
    domain: "ai",
    title: "Anthropic API Docs",
    url: "https://docs.anthropic.com/",
    tier: "official_docs",
    topics: ["ai", "llm", "api", "claude"],
    keywords: ["anthropic", "claude", "claude api"],
    priority: 100,
  },
  {
    id: "nvidia-ai-endpoints",
    product: "NVIDIA AI Endpoints",
    domain: "ai",
    title: "NVIDIA AI Endpoints",
    url: "https://docs.api.nvidia.com/",
    tier: "official_docs",
    topics: ["ai", "llm", "embedding", "api"],
    keywords: ["nvidia", "nvidia ai", "nvidia api", "nvidia embeddings"],
    priority: 90,
  },

  // Databases / Retrieval
  {
    id: "qdrant-docs",
    product: "Qdrant",
    domain: "database",
    title: "Qdrant Documentation",
    url: "https://qdrant.tech/documentation/",
    tier: "official_docs",
    topics: ["vector database", "retrieval", "search", "embeddings"],
    keywords: ["qdrant", "vector db", "vector database", "semantic search"],
    priority: 100,
  },
  {
    id: "supabase-docs",
    product: "Supabase",
    domain: "database",
    title: "Supabase Documentation",
    url: "https://supabase.com/docs",
    tier: "official_docs",
    topics: ["postgres", "database", "auth", "storage"],
    keywords: ["supabase", "postgres", "supabase auth", "supabase database"],
    priority: 100,
  },
  {
    id: "postgres-docs",
    product: "PostgreSQL",
    domain: "database",
    title: "PostgreSQL Documentation",
    url: "https://www.postgresql.org/docs/",
    tier: "official_docs",
    topics: ["postgres", "database", "sql"],
    keywords: ["postgres", "postgresql", "sql"],
    priority: 95,
  },
  {
    id: "redis-docs",
    product: "Redis",
    domain: "infra",
    title: "Redis Documentation",
    url: "https://redis.io/docs/latest/",
    tier: "official_docs",
    topics: ["redis", "cache", "queue"],
    keywords: ["redis", "cache", "bullmq", "queue"],
    priority: 95,
  },

  // Web / App frameworks
  {
    id: "nextjs-docs",
    product: "Next.js",
    domain: "web",
    title: "Next.js Documentation",
    url: "https://nextjs.org/docs",
    tier: "official_docs",
    topics: ["nextjs", "react", "frontend", "app router"],
    keywords: ["nextjs", "next.js", "react app router"],
    priority: 100,
  },
  {
    id: "tanstack-query-docs",
    product: "TanStack Query",
    domain: "web",
    title: "TanStack Query Documentation",
    url: "https://tanstack.com/query/latest/docs/framework/react/overview",
    tier: "official_docs",
    topics: ["react", "query", "cache", "polling"],
    keywords: ["tanstack query", "react query", "polling", "cache"],
    priority: 100,
  },
  {
    id: "fastify-docs",
    product: "Fastify",
    domain: "backend",
    title: "Fastify Documentation",
    url: "https://fastify.dev/docs/latest/",
    tier: "official_docs",
    topics: ["backend", "node", "api", "server"],
    keywords: ["fastify", "node api", "fastify server"],
    priority: 95,
  },
  {
    id: "prisma-docs",
    product: "Prisma",
    domain: "database",
    title: "Prisma Documentation",
    url: "https://www.prisma.io/docs",
    tier: "official_docs",
    topics: ["orm", "database", "postgres"],
    keywords: ["prisma", "orm", "prisma client", "prisma migrate"],
    priority: 95,
  },

  // Scraping / Conversion
  {
    id: "scrapling-docs",
    product: "Scrapling",
    domain: "scraping",
    title: "Scrapling GitHub",
    url: "https://github.com/D4Vinci/Scrapling",
    tier: "official_docs",
    topics: ["scraping", "crawler", "html extraction"],
    keywords: ["scrapling", "scraper", "web scraping", "fetcher"],
    priority: 90,
  },
  {
    id: "markitdown-docs",
    product: "MarkItDown",
    domain: "document-processing",
    title: "Microsoft MarkItDown",
    url: "https://github.com/microsoft/markitdown",
    tier: "official_docs",
    topics: ["document conversion", "markdown", "pdf", "docx"],
    keywords: ["markitdown", "pdf to markdown", "docx to markdown"],
    priority: 90,
  },
];
