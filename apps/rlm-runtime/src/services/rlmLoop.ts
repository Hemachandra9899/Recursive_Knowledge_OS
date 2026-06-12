import { sanitizeGeneratedPython, truncateText } from "../utils/codeUtils.ts";
import { ModelClient } from "./modelClient.ts";
import { PythonSandbox } from "./pythonSandbox.ts";
import { ToolsClient } from "./toolsClient.ts";
import { StrategyAgent } from "./strategyAgent.ts";
import { AnswerSynthesizer } from "./answerSynthesizer.ts";
import { extractSources, isGenericOrRawAnswer } from "./answerUtils.ts";
import { IntentDetector } from "./intentDetector.ts";
import { FastIntentDetector, type FastIntent } from "./fastIntentDetector.ts";
import { contextLimitMessage, isContextTooLarge } from "./contextGuard.ts";
import type {
  AnswerSource,
  ChatMessage,
  ExecuteRequest,
  RlmRunResult,
  RlmStep,
  SubAgentHandler,
  ToolHandler,
} from "../types.ts";

const DEFAULT_MAX_STEPS = 5;
const DEFAULT_MAX_DEPTH = 2;

const SYSTEM_PROMPT = `
You are Scout's async Python executor.

Return executable Python code only. No markdown wrappers. No explanations.

Async tools:
- await llm_query(prompt, context=None)
- await search_kb(query, top_k=5)
- await web_research(query, max_results=3)
- await crawl_url(url, max_pages=1)
- await query_graph(query, depth=1)
- await github_repo(url, mode="summary", max_files=30)

Sync tools:
- print(value)
- final(value)

Rules:
1. You are already inside async Python. Use await directly. Never use asyncio.run().
2. Always call final(...).
3. final(...) must contain the real user-facing answer.
4. Never final("Done") or final("All questions have been answered").
5. Use search_kb first for knowledge questions.
6. If KB is empty for public docs, APIs, products, companies, or current info, call web_research, then search_kb again.
7. search_kb returns a list of chunks. Use chunk["text"], chunk["title"], and chunk["sourceUrl"].
8. Never return raw tool results, arrays, chunk IDs, document IDs, or metadata.
9. Synthesize retrieved text into a clean answer.
10. Use sections/tables for comparisons or lists.
11. Add a "Sources" section when source titles/URLs are available.
12. Treat "mets graph api" as "Meta Graph API". For Meta ads, research "Meta Graph API Marketing API ads platform endpoints".
13. For API comparison questions, use official docs first and ignore weak sources like YouTube, Postman unless official docs are unavailable.
14. Do not use source titles as table rows. Rows should be actual products/APIs/entities.
15. If web_research returns an evidencePack, use evidencePack.evidence as the main evidence source. Do not ignore it.
16. For uploaded-document questions, always call search_kb with the quoted document title or filename first. If chunks are returned, answer from those chunks even if embeddings are unavailable. Never say the document is inaccessible unless search_kb returns no chunks.
17. If the search results from an uploaded document contain table data, analyze the table contents. Never output raw extracted table data or hundreds of numeric rows.
18. When dealing with uploaded documents that have extracted tables: describe the data, identify key metrics, note trends, and summarize findings. Do not dump the raw table values.
19. For uploaded-document questions asking about a date, row, section, or specific value, do not search only the filename. Search multiple targeted queries using the filename plus the target term, for example: "<filename> May 11", "May 11", "11 May", "May-11", and related variants.
20. If the first search does not find the requested row/date/value, retry with broader queries before finalizing.
21. Never conclude that a value/date is missing from an uploaded document after only one search_kb call.
22. For table-like uploaded documents, retrieve several relevant chunks and synthesize the row/period summary instead of doing exact string matching only.
23. If fast intent guidance lists requiredTools, you must call those tools before final(...).
24. For GitHub repository URLs, call github_repo(...), not crawl_url(...).
25. For current/news/latest questions, call web_research(...), not only search_kb(...).
26. Never call final(None). If a tool returns useful data, synthesize it into a real answer.
`.trim();

function buildInitialMessages(input: {
  query: string;
  guidance: string;
  depth: number;
  maxDepth: number;
  conversationContext?: Array<{ role: string; content: string }>;
  contextTruncated?: boolean;
}): ChatMessage[] {
  const preamble: string[] = [
    input.depth === 0 ? "" : `Depth: ${input.depth}/${input.maxDepth}`,
    input.guidance || undefined,
  ].filter(Boolean) as string[];

  const conversationText = input.conversationContext?.length
    ? [
        "Recent conversation context:",
        ...input.conversationContext.map(
          (m) => `${m.role.toUpperCase()}: ${m.content}`,
        ),
        input.contextTruncated
          ? "Note: older conversation messages were truncated due to context limit."
          : undefined,
      ]
        .filter(Boolean)
        .join("\n")
    : undefined;

  return [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "User task:",
        input.query,
        ...(preamble.length > 0 ? ["", ...preamble] : []),
        ...(conversationText ? ["", conversationText] : []),
        "",
        "Write the next Python code block.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

function buildExecutionFeedback(step: RlmStep): string {
  const finalText =
    step.final === null || step.final === undefined
      ? "None"
      : truncateText(JSON.stringify(step.final), 2500);

  return `
Step ${step.stepIndex} result:

stdout:
${truncateText(step.stdout, 2500)}

error:
${step.error ?? "None"}

finalCalled:
${step.finalCalled}

final:
${finalText}

Next:
- If finalCalled=true and error=None, stop only if runtime policy accepted the final answer. If runtime rejected the final answer, call the missing required tool and produce a real answer.
- If there is an error, fix it.
- If more work is needed, write the next Python code block.
`.trim();
}

function childRunId(
  parentRunId: string | undefined,
  depth: number
): string | undefined {
  if (!parentRunId) return undefined;
  return `${parentRunId}:child:${depth}:${crypto.randomUUID()}`;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function buildRunGuidance(input: {
  intent: unknown;
  strategy: unknown;
  fastIntent: FastIntent | null;
}): string {
  const intent = toRecord(input.intent);
  const strategy = toRecord(input.strategy);

  const lines: string[] = [];

  if (input.fastIntent) {
    lines.push(
      [
        "Fast intent guidance:",
        `- intent: ${input.fastIntent.intent}`,
        `- answerMode: ${input.fastIntent.answerMode}`,
        `- requiresWeb: ${input.fastIntent.requiresWeb}`,
        `- requiresGithub: ${input.fastIntent.requiresGithub}`,
        `- requiresFreshness: ${input.fastIntent.requiresFreshness}`,
        `- requiredTools: ${input.fastIntent.requiredTools.join(", ") || "none"}`,
        `- reason: ${input.fastIntent.reason}`,
      ].join("\n")
    );
  }

  if (Object.keys(intent).length > 0) {
    lines.push(
      [
        "Intent guidance:",
        `- kind: ${String(intent.kind ?? "unknown")}`,
        `- needsWebResearch: ${Boolean(intent.needsWebResearch)}`,
        `- needsKnowledgeSearch: ${Boolean(intent.needsKnowledgeSearch)}`,
        `- wantsTable: ${Boolean(intent.wantsTable)}`,
        `- wantsSources: ${Boolean(intent.wantsSources)}`,
      ].join("\n")
    );
  }

  if (strategy.enabled) {
    lines.push(
      [
        "Strategy guidance:",
        `- bestMethod: ${String(strategy.bestMethod ?? "unknown")}`,
        `- recommendedMethod: ${String(strategy.recommendedMethod ?? "unknown")}`,
        `- reason: ${String(strategy.reason ?? "")}`,
      ].join("\n")
    );
  }

  return lines.join("\n\n").trim();
}

function isEmptyFinalValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const s = String(value).trim().toLowerCase();
  return !s || s === "none" || s === "null" || s === "done" || s === "all questions have been answered" || s === "i have completed all tasks";
}

function validateFinalBeforeStop(input: { final: unknown; toolsCalled: string[]; fastIntent: FastIntent | null; depth: number }): string | null {
  const missing = (input.fastIntent?.requiredTools ?? []).filter((t) => !input.toolsCalled.includes(t));
  if (missing.length > 0) return [`You must call required tool(s) before final(): ${missing.join(", ")}.`, input.fastIntent?.requiresWeb ? `This query requires web_research.` : ``, input.fastIntent?.requiresGithub ? `This query requires github_repo.` : ``, `Call the tool(s) then call final() with a real answer.`].filter(Boolean).join("\n");
  if (isEmptyFinalValue(input.final)) return [`Your final answer was rejected because it was empty or generic.`, `Use tools and synthesize a real answer.`, input.fastIntent?.requiresWeb ? `This query requires web_research.` : ``, input.fastIntent?.requiresGithub ? `This query requires github_repo.` : ``, `Never call final(None).`].filter(Boolean).join("\n");
  return null;
}

function extractGithubUrl(query: string): string | null {
  const m = query.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[/?#][^\s]*)?/i);
  return m?.[0] ?? null;
}

async function tryToolFirstPath(input: {
  fastIntent: FastIntent;
  query: string;
  subAgentHandler: SubAgentHandler;
  toolHandler: ToolHandler;
  sandbox: PythonSandbox;
}): Promise<{ execution: PythonExecutionResult; step: RlmStep } | null> {
  let code = "";
  if (input.fastIntent.intent === "github_repo") {
    const url = extractGithubUrl(input.query);
    if (!url) return null;
    code = `result = await github_repo(${JSON.stringify(url)}, mode="summary", max_files=30)\nif isinstance(result, dict):\n    answer = result.get("answer") or result.get("repo") or str(result.get("status", ""))\nelse:\n    answer = str(result)\nfinal(answer)`;
  } else if (input.fastIntent.intent === "news" || input.fastIntent.intent === "web_research") {
    code = `research = await web_research(${JSON.stringify(input.query)}, max_results=3, max_pages_per_source=1, max_total_pages=5, max_depth=1)\nif isinstance(research, dict) and "ui" in research:\n    final(research["ui"].get("answerMarkdown") or research)\nelse:\n    final(research)`;
  } else {
    return null;
  }
  try {
    const execution = await input.sandbox.execute(code, input.subAgentHandler, input.toolHandler);
    if (execution.finalCalled && !execution.error && execution.final !== null) {
      return {
        execution,
        step: {
          stepIndex: 0,
          generatedCode: code,
          stdout: execution.stdout,
          final: execution.final,
          finalCalled: execution.finalCalled,
          error: execution.error,
          toolCalls: execution.toolCalls ?? [],
        },
      };
    }
    return null;
  } catch {
    return null;
  }
}

export class RlmLoop {
  private readonly modelClient: ModelClient;
  private readonly sandbox: PythonSandbox;
  private readonly toolsClient: ToolsClient;
  private readonly strategyAgent: StrategyAgent;
  private readonly answerSynthesizer: AnswerSynthesizer;
  private readonly intentDetector: IntentDetector;
  private readonly fastIntentDetector: FastIntentDetector;

  constructor(
    modelClient = new ModelClient(),
    sandbox = new PythonSandbox(),
    toolsClient = new ToolsClient(),
    strategyAgent = new StrategyAgent(modelClient),
    answerSynthesizer = new AnswerSynthesizer(modelClient),
    intentDetector = new IntentDetector(modelClient),
    fastIntentDetector = new FastIntentDetector(modelClient)
  ) {
    this.modelClient = modelClient;
    this.sandbox = sandbox;
    this.toolsClient = toolsClient;
    this.strategyAgent = strategyAgent;
    this.answerSynthesizer = answerSynthesizer;
    this.intentDetector = intentDetector;
    this.fastIntentDetector = fastIntentDetector;
  }

  async run(req: ExecuteRequest): Promise<RlmRunResult> {
    const depth = Math.max(0, req.depth ?? 0);
    const maxDepth = Math.max(0, req.maxDepth ?? DEFAULT_MAX_DEPTH);
    const maxSteps = Math.max(1, Math.min(req.maxSteps ?? DEFAULT_MAX_STEPS, 10));
    const steps: RlmStep[] = [];

    const fastIntent = depth === 0 ? await this.fastIntentDetector.detect(req.query) : null;

    const intent = depth === 0 && !fastIntent ? await this.intentDetector.detect(req.query) : null;

    const strategy =
      depth === 0 && !fastIntent
        ? await this.strategyAgent.plan(req.query)
        : {
            enabled: false,
            recommendedMethod: "direct_answer",
            bestMethod: "direct_answer",
            shouldUseTools: false,
            methods: [],
            reason: fastIntent ? "Strategy skipped for fast intent." : "Strategy skipped for child agent.",
          };

    const intentRecord = toRecord(intent);
    const normalizedQuery =
      typeof intentRecord.normalizedQuery === "string"
        ? intentRecord.normalizedQuery
        : req.query;

    const guidance = buildRunGuidance({ intent, strategy, fastIntent });

    const messages = buildInitialMessages({
      query: normalizedQuery,
      guidance,
      depth,
      maxDepth,
      conversationContext: req.conversationContext,
      contextTruncated: req.contextTruncated,
    });

    const subAgentHandler: SubAgentHandler = async (prompt, context) => {
      if (depth >= maxDepth) {
        return {
          error: `Maximum recursion depth ${maxDepth} reached. Solve manually in the current agent.`,
        };
      }

      const childPrompt = [
        prompt,
        "",
        "Parent context:",
        JSON.stringify(context ?? {}, null, 2),
      ].join("\n");

      const childResult = await this.run({
        runId: childRunId(req.runId, depth + 1),
        projectId: req.projectId,
        query: childPrompt,
        maxSteps,
        depth: depth + 1,
        maxDepth,
      });

      if (childResult.status !== "completed") {
        return {
          error:
            childResult.error ??
            `Child agent ended with status ${childResult.status}`,
          status: childResult.status,
        };
      }

      return childResult.final;
    };

    const toolHandler: ToolHandler = async (name, args) => {
      return this.toolsClient.callTool(name, args, {
        projectId: req.projectId,
      });
    };

    const finalizeAnswer = async (
      final: unknown
    ): Promise<{ final: unknown; sources: AnswerSource[] }> => {
      const sources = extractSources(final, steps);

      const lastStdout =
        [...steps]
          .reverse()
          .map((step) => step.stdout?.trim())
          .find(Boolean) || "";

      if (!isGenericOrRawAnswer(final)) {
        return { final, sources };
      }

      try {
        const synthesized = await this.answerSynthesizer.synthesize({
          query: req.query,
          rawFinal: final,
          stdout: lastStdout,
          sources,
        });

        return {
          final: synthesized.answer,
          sources: synthesized.sources,
        };
      } catch {
        return {
          final: lastStdout || final,
          sources,
        };
      }
    };

    const maxContextTokens = Number(
      Deno.env.get("MAX_CONTEXT_TOKENS") || 24000
    );

    try {
      const toolsCalled = new Set<string>();

      if (depth === 0 && fastIntent && fastIntent.answerMode === "fast") {
        const fastResult = await tryToolFirstPath({
          fastIntent,
          query: normalizedQuery,
          subAgentHandler,
          toolHandler,
          sandbox: this.sandbox,
        });
        if (fastResult) {
          const { execution, step } = fastResult;
          for (const t of execution.toolCalls ?? []) toolsCalled.add(String(t));
          steps.push(step);
          const finalRejection = validateFinalBeforeStop({ final: execution.final, toolsCalled: [...toolsCalled], fastIntent, depth });
          if (!finalRejection) {
            const finalized = await finalizeAnswer(execution.final);
            return {
              status: "completed",
              runId: req.runId,
              projectId: req.projectId,
              query: req.query,
              depth,
              maxDepth,
              final: finalized.final,
              sources: finalized.sources,
              steps,
              error: null,
            };
          }
          messages.push({ role: "assistant", content: step.generatedCode });
          messages.push({ role: "user", content: buildExecutionFeedback(step) + "\n\n" + finalRejection });
        }
      }

      for (let stepIndex = steps.length; stepIndex < maxSteps; stepIndex++) {
        if (isContextTooLarge(messages, maxContextTokens)) {
          return {
            status: "failed",
            runId: req.runId,
            projectId: req.projectId,
            query: req.query,
            depth,
            maxDepth,
            final: contextLimitMessage(maxContextTokens),
            sources: [],
            steps,
            error: "context_limit_reached",
          };
        }

        const rawCode = await this.modelClient.chatCoding(messages);
        const generatedCode = sanitizeGeneratedPython(rawCode);

        const execution = await this.sandbox.execute(
          generatedCode,
          subAgentHandler,
          toolHandler
        );

        for (const tool of execution.toolCalls ?? []) {
          toolsCalled.add(String(tool));
        }

        const step: RlmStep = {
          stepIndex,
          generatedCode,
          stdout: execution.stdout,
          final: execution.final,
          finalCalled: execution.finalCalled,
          error: execution.error,
          toolCalls: execution.toolCalls ?? [],
        };

        steps.push(step);

        messages.push({
          role: "assistant",
          content: generatedCode,
        });

        messages.push({
          role: "user",
          content: buildExecutionFeedback(step),
        });

        if (execution.finalCalled && !execution.error) {
          const finalRejection = validateFinalBeforeStop({ final: execution.final, toolsCalled: [...toolsCalled], fastIntent, depth });
          if (finalRejection) {
            messages.push({ role: "user", content: finalRejection });
            continue;
          }
          const finalized = await finalizeAnswer(execution.final);

          return {
            status: "completed",
            runId: req.runId,
            projectId: req.projectId,
            query: req.query,
            depth,
            maxDepth,
            final: finalized.final,
            sources: finalized.sources,
            steps,
            error: null,
          };
        }
      }

      const fallbackFinal = steps.at(-1)?.final ?? null;
      const finalized = await finalizeAnswer(fallbackFinal);

      return {
        status: "max_steps_reached",
        runId: req.runId,
        projectId: req.projectId,
        query: req.query,
        depth,
        maxDepth,
        final: finalized.final,
        sources: finalized.sources,
        steps,
        error: "RLM loop reached maxSteps before final() completed successfully.",
      };
    } catch (error) {
      return {
        status: "failed",
        runId: req.runId,
        projectId: req.projectId,
        query: req.query,
        depth,
        maxDepth,
        final: null,
        sources: [],
        steps,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}