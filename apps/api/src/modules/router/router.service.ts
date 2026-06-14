import {
  webResearch,
  searchKnowledgeBase,
  githubRepo,
} from "../tools/tools.service.js";
import { evaluateFaithfulness } from "./faithfulness-critic.js";

export type RouterTier = 1 | 2 | 3;

export type RouterDecision = {
  tier: RouterTier;
  route: "direct_tool" | "research_orchestrator" | "sandbox" | "direct_model";
  tool: "search_kb" | "github_repo" | "web_research" | "sandbox" | "direct_model";
  reason: string;
};

export type RouterAnswerInput = {
  projectId: string;
  userId?: string;
  query: string;
};

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

const RLM_RUNTIME_URL =
  process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

const ROUTER_RESEARCH_MAX_RESULTS = Number(
  process.env.ROUTER_RESEARCH_MAX_RESULTS || 3,
);
const ROUTER_RESEARCH_MAX_PAGES_PER_SOURCE = Number(
  process.env.ROUTER_RESEARCH_MAX_PAGES_PER_SOURCE || 1,
);
const ROUTER_RESEARCH_MAX_TOTAL_PAGES = Number(
  process.env.ROUTER_RESEARCH_MAX_TOTAL_PAGES || 4,
);
const ROUTER_RESEARCH_MAX_DEPTH = Number(
  process.env.ROUTER_RESEARCH_MAX_DEPTH || 1,
);
const ROUTER_RESEARCH_TIMEOUT_MS = Number(
  process.env.ROUTER_RESEARCH_TIMEOUT_MS || 120_000,
);
const ROUTER_FAITHFULNESS_THRESHOLD = Number(
  process.env.ROUTER_FAITHFULNESS_THRESHOLD || 0.7,
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableModelError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);

  return (
    text.includes("ResourceExhausted") ||
    text.includes("workers are busy") ||
    text.includes("Service Unavailable") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("504") ||
    text.toLowerCase().includes("timeout")
  );
}

function modelCandidatesForMode(
  mode: "coding" | "reasoning",
): Array<string | undefined> {
  const values =
    mode === "coding"
      ? [
          process.env.ROUTER_CODER_MODEL,
          process.env.ROUTER_CODER_FALLBACK_MODEL,
          process.env.ROUTER_CODER_FALLBACK_MODEL_2,
        ]
      : [
          process.env.ROUTER_REASONING_MODEL,
          process.env.ROUTER_REASONING_FALLBACK_MODEL,
          process.env.ROUTER_REASONING_FALLBACK_MODEL_2,
        ];

  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered : [undefined];
}

function hasGithubRepoUrl(query: string): boolean {
  return /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(query);
}

function extractGithubRepoUrl(query: string): string | null {
  return (
    query.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[/?#][^\s]*)?/i)?.[0] ??
    null
  );
}

function includesAny(query: string, terms: string[]): boolean {
  const q = query.toLowerCase();
  return terms.some((term) => q.includes(term.toLowerCase()));
}

function isClearlyInsufficientEvidenceQuery(query: string): boolean {
  const q = query.toLowerCase();

  return (
    q.includes("non-uploaded") ||
    q.includes("private salary") ||
    q.includes("unreleased api endpoint") ||
    q.includes("exact unreleased") ||
    q.includes("will launch next month")
  );
}

export function routeScoutQuery(query: string): RouterDecision {
  const q = query.toLowerCase();

  if (isClearlyInsufficientEvidenceQuery(query)) {
    return {
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      reason:
        "Query asks for private/unreleased information; verify KB first and return insufficient evidence if unavailable.",
    };
  }

  if (hasGithubRepoUrl(query)) {
    return {
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      reason: "GitHub repository URL detected; use github_repo instead of sandbox codegen.",
    };
  }

  if (
    includesAny(q, [
      "latest",
      "news",
      "current",
      "recent",
      "today",
      "this week",
      "api",
      "docs",
      "documentation",
      "auth",
      "authenticate",
      "authentication",
      "rate limit",
      "quota",
      "compare",
      "comparison",
      "versus",
      " vs ",
    ])
  ) {
    return {
      tier: 2,
      route: "research_orchestrator",
      tool: "web_research",
      reason: "Research/current/API/comparison query; use ResearchOrchestrator as default.",
    };
  }

  if (
    includesAny(q, [
      "uploaded",
      "document",
      "pdf",
      "readme",
      "knowledge base",
      "kb",
      "project knowledge",
      "from the file",
      "from uploaded",
    ])
  ) {
    return {
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      reason: "Document/KB lookup; use search_kb directly.",
    };
  }

  if (
    includesAny(q, [
      "sort",
      "remove duplicates",
      "mean",
      "median",
      "group by",
      "aggregate",
      "chart",
      "parse",
      "calculate",
      "compute",
      "last 100 commits",
      "frequency",
    ])
  ) {
    return {
      tier: 3,
      route: "sandbox",
      tool: "sandbox",
      reason: "Query needs explicit computation or data transformation; use sandbox.",
    };
  }

  if (
    includesAny(q, [
      "code",
      "function",
      "leetcode",
      "linked list",
      "algorithm",
      "time complexity",
      "space complexity",
      "implement",
      "debug",
      "typescript",
      "javascript",
      "python",
    ])
  ) {
    return {
      tier: 1,
      route: "direct_model",
      tool: "direct_model",
      reason: "Pure coding question; use direct coding model without web research.",
    };
  }

  return {
    tier: 2,
    route: "research_orchestrator",
    tool: "web_research",
    reason: "Defaulting unknown information request to evidence-first ResearchOrchestrator.",
  };
}

function extractAnswerText(value: unknown): string {
  if (!value) return "";

  const data = value as Record<string, unknown>;

  if (typeof data === "string") return data;
  if (typeof (data as any)?.ui?.answerMarkdown === "string") return (data as any).ui.answerMarkdown;
  if (typeof (data as any)?.answer?.markdown === "string") return (data as any).answer.markdown;
  if (typeof (data as any)?.answer?.answer === "string") return (data as any).answer.answer;
  if (typeof (data as any)?.answer === "string") return data.answer as string;
  if (typeof (data as any)?.final === "string") return data.final as string;

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function extractCitations(value: unknown): Array<{ title?: string | null; url?: string | null }> {
  const data = value as any;
  return (
    data?.ui?.citations ??
    data?.answer?.citations ??
    data?.sources ??
    []
  );
}

function extractEvidenceCoverage(value: unknown): Record<string, unknown> {
  const data = value as any;
  return (
    data?.ui?.evidenceCoverage ??
    data?.evidencePack?.coverage ??
    data?.answer?.evidencePack?.coverage ??
    {}
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function callModelServiceOnce(
  mode: "coding" | "reasoning",
  query: string,
  model?: string,
): Promise<string> {
  const response = await fetch(`${MODEL_SERVICE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      ...(model ? { model } : {}),
      messages: [{ role: "user", content: query }],
      temperature: mode === "coding" ? 0.2 : 0.4,
      top_p: 0.8,
      max_tokens: mode === "coding" ? 1200 : 900,
    }),
  });

  const text = await response.text();

  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { rawText: text };
  }

  if (!response.ok) {
    throw new Error(`model-service failed: ${response.status} ${text}`);
  }

  return String(data.content ?? "");
}

async function callModelService(
  mode: "coding" | "reasoning",
  query: string,
): Promise<string> {
  let lastError: unknown = null;

  for (const model of modelCandidatesForMode(mode)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callModelServiceOnce(mode, query, model);
      } catch (error) {
        lastError = error;

        if (!isRetryableModelError(error)) {
          throw error;
        }

        await sleep(1_000 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

async function callRlmRuntime(input: RouterAnswerInput): Promise<unknown> {
  const response = await fetch(`${RLM_RUNTIME_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      query: input.query,
      maxSteps: 5,
      maxDepth: 2,
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`rlm-runtime failed: ${response.status} ${text}`);
  }

  return data;
}

function notEnoughEvidenceAnswer(query: string): string {
  return [
    "I do not have enough evidence to answer this confidently.",
    "",
    `Query: ${query}`,
    "",
    "I could not find a relevant uploaded document or reliable source in the available project context.",
  ].join("\n");
}

function partialResearchTimeoutResponse(
  decision: RouterDecision,
  error: unknown,
  query: string,
) {
  const reason = error instanceof Error ? error.message : String(error);
  const answerMarkdown = [
    "I could not complete web research within the time limit.",
    "",
    "I do not have enough evidence to answer this confidently.",
    "",
    `Reason: ${reason}`,
  ].join("\n");

  const critic = evaluateFaithfulness({
    query,
    answerMarkdown,
    threshold: ROUTER_FAITHFULNESS_THRESHOLD,
  });

  return {
    status: "partial",
    route: decision,
    critic,
    ui: {
      answerMarkdown,
      citations: [],
      evidenceCoverage: {
        hasEvidence: false,
        claimCount: 0,
        supportedClaimCount: 0,
        weakClaimCount: 0,
        unsupportedClaimCount: 0,
        missing: [reason],
      },
      faithfulness: critic,
    },
    answer: answerMarkdown,
    error: reason,
  };
}

export async function answerWithRouter(input: RouterAnswerInput) {
  const decision = routeScoutQuery(input.query);

  if (decision.tool === "github_repo") {
    const url = extractGithubRepoUrl(input.query);
    if (!url) throw new Error("GitHub URL was expected but not found.");

    const result = await githubRepo({
      projectId: input.projectId,
      url,
      mode: "summary",
      maxFiles: 30,
    });

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown: result.answer,
      toolPreviews: [{ tool: "github_repo", preview: result.answer, sources: result.sources ?? [] }],
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown: result.answer,
        citations: result.sources ?? [],
        evidenceCoverage: {},
        faithfulness: critic,
      },
      answer: result.answer,
      sources: result.sources ?? [],
      rawToolResult: result,
    };
  }

  if (decision.tool === "web_research") {
    try {
      let result = await withTimeout(
        webResearch({
          projectId: input.projectId,
          query: input.query,
          maxResults: ROUTER_RESEARCH_MAX_RESULTS,
          maxPagesPerSource: ROUTER_RESEARCH_MAX_PAGES_PER_SOURCE,
          maxTotalPages: ROUTER_RESEARCH_MAX_TOTAL_PAGES,
          maxDepth: ROUTER_RESEARCH_MAX_DEPTH,
          useOrchestrator: true,
        }),
        ROUTER_RESEARCH_TIMEOUT_MS,
        "web_research",
      );

      let answerMarkdown = extractAnswerText(result);
      let evidenceCoverage = extractEvidenceCoverage(result);

      let critic = evaluateFaithfulness({
        query: input.query,
        answerMarkdown,
        evidencePack: (result as any).evidencePack,
        threshold: ROUTER_FAITHFULNESS_THRESHOLD,
      });

      if (critic.verdict === "retry") {
        const focusedQuery = [
          input.query,
          "",
          critic.fixHint,
          "Answer directly and explicitly. Do not return unrelated content.",
        ].join("\n");

        result = await withTimeout(
          webResearch({
            projectId: input.projectId,
            query: focusedQuery,
            maxResults: ROUTER_RESEARCH_MAX_RESULTS,
            maxPagesPerSource: ROUTER_RESEARCH_MAX_PAGES_PER_SOURCE,
            maxTotalPages: ROUTER_RESEARCH_MAX_TOTAL_PAGES,
            maxDepth: ROUTER_RESEARCH_MAX_DEPTH,
            useOrchestrator: true,
          }),
          ROUTER_RESEARCH_TIMEOUT_MS,
          "web_research_retry",
        );

        answerMarkdown = extractAnswerText(result);
        evidenceCoverage = extractEvidenceCoverage(result);

        critic = evaluateFaithfulness({
          query: input.query,
          answerMarkdown,
          evidencePack: (result as any).evidencePack,
          threshold: ROUTER_FAITHFULNESS_THRESHOLD,
        });
      }

      if (!critic.passed) {
        return {
          ...result,
          status: "partial",
          route: decision,
          critic,
          ui: {
            ...(result as any).ui,
            answerMarkdown: [
              "I found some evidence, but I do not have enough confidence that it fully answers the query.",
              "",
              answerMarkdown,
            ].join("\n"),
            citations: extractCitations(result),
            evidenceCoverage,
            faithfulness: critic,
          },
        };
      }

      return {
        ...result,
        route: decision,
        critic,
        ui: {
          ...(result as any).ui,
          answerMarkdown,
          citations: extractCitations(result),
          evidenceCoverage,
          faithfulness: critic,
        },
      };
    } catch (error) {
      return partialResearchTimeoutResponse(decision, error, input.query);
    }
  }

  if (decision.tool === "search_kb") {
    const result = await searchKnowledgeBase({
      projectId: input.projectId,
      query: input.query,
      topK: 8,
    });

    const results = Array.isArray((result as any).results)
      ? (result as any).results
      : [];

    if (results.length === 0) {
      const answerMarkdown = notEnoughEvidenceAnswer(input.query);
      const critic = evaluateFaithfulness({
        query: input.query,
        answerMarkdown,
        threshold: ROUTER_FAITHFULNESS_THRESHOLD,
      });
      return {
        status: "ok",
        route: decision,
        critic,
        ui: { answerMarkdown, citations: [], evidenceCoverage: {}, faithfulness: critic },
        answer: answerMarkdown,
        rawToolResult: result,
      };
    }

    const context = results.slice(0, 5).map((item: any, index: number) => {
      const title = item.title || item.documentTitle || `Source ${index + 1}`;
      const text = item.text || item.content || item.chunk || "";
      return `[${index + 1}] ${title}\n${String(text).slice(0, 2000)}`;
    }).join("\n\n---\n\n");

    const prompt = [
      "You are a research assistant. Answer the user's question based ONLY on the knowledge base results below.",
      "If the results do NOT contain the information needed to answer the question, say you do not have enough evidence.",
      "Do not make up facts. Do not guess.",
      "",
      `QUESTION: ${input.query}`,
      "",
      "KNOWLEDGE BASE RESULTS:",
      context,
      "",
      "ANSWER:",
    ].join("\n");

    let answerMarkdown: string;
    try {
      answerMarkdown = await callModelService("reasoning", prompt);
    } catch {
      answerMarkdown = results.length > 0
        ? [
            `I found ${results.length} relevant knowledge-base result(s) but could not synthesize them.`,
            "",
            ...results.slice(0, 5).map((item: any, index: number) => {
              const title = item.title || item.documentTitle || item.sourceUrl || `Result ${index + 1}`;
              const text = item.text || item.content || item.chunk || "";
              return `### ${index + 1}. ${title}\n${String(text).slice(0, 900)}`;
            }),
          ].join("\n\n")
        : notEnoughEvidenceAnswer(input.query);
    }

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown,
      toolPreviews: [
        {
          tool: "search_kb",
          preview: answerMarkdown,
          sources: results
            .map((item: any) => ({
              title: item.title ?? item.documentTitle ?? null,
              url: item.sourceUrl ?? item.url ?? null,
            }))
            .filter((item: any) => item.title || item.url),
        },
      ],
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown,
        citations: results
          .map((item: any) => ({
            title: item.title ?? item.documentTitle ?? null,
            url: item.sourceUrl ?? item.url ?? null,
          }))
          .filter((item: any) => item.title || item.url),
        evidenceCoverage: {},
        faithfulness: critic,
      },
      answer: answerMarkdown,
      rawToolResult: result,
    };
  }

  if (decision.tool === "direct_model") {
    let answerMarkdown: string;
    try {
      answerMarkdown = await callModelService("coding", input.query);
    } catch {
      answerMarkdown = `I encountered a temporary issue processing your coding request. Please try again.\n\nQuery: ${input.query}`;
    }

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown,
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown,
        citations: [],
        evidenceCoverage: {},
        faithfulness: critic,
      },
      answer: answerMarkdown,
    };
  }

  if (decision.tool === "sandbox") {
    const result = await callRlmRuntime(input);

    const answerMarkdown = extractAnswerText(result);
    const evidenceCoverage = extractEvidenceCoverage(result);

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown,
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      ...(result as Record<string, unknown>),
      route: decision,
      critic,
      ui: {
        ...(result as any).ui,
        answerMarkdown,
        citations: extractCitations(result),
        evidenceCoverage,
        faithfulness: critic,
      },
    };
  }

  throw new Error(`Unhandled router tool: ${decision.tool}`);
}
