import { sanitizeGeneratedPython, truncateText } from "../utils/codeUtils.ts";
import { ModelClient } from "./modelClient.ts";
import { PythonSandbox } from "./pythonSandbox.ts";
import { ToolsClient } from "./toolsClient.ts";
import { StrategyAgent } from "./strategyAgent.ts";
import { AnswerSynthesizer } from "./answerSynthesizer.ts";
import { extractSources, isGenericOrRawAnswer } from "./answerUtils.ts";
import { IntentDetector } from "./intentDetector.ts";
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
- If finalCalled=true and error=None, stop.
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
}): string {
  const intent = toRecord(input.intent);
  const strategy = toRecord(input.strategy);

  const lines: string[] = [];

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

export class RlmLoop {
  private readonly modelClient: ModelClient;
  private readonly sandbox: PythonSandbox;
  private readonly toolsClient: ToolsClient;
  private readonly strategyAgent: StrategyAgent;
  private readonly answerSynthesizer: AnswerSynthesizer;
  private readonly intentDetector: IntentDetector;

  constructor(
    modelClient = new ModelClient(),
    sandbox = new PythonSandbox(),
    toolsClient = new ToolsClient(),
    strategyAgent = new StrategyAgent(modelClient),
    answerSynthesizer = new AnswerSynthesizer(modelClient),
    intentDetector = new IntentDetector(modelClient)
  ) {
    this.modelClient = modelClient;
    this.sandbox = sandbox;
    this.toolsClient = toolsClient;
    this.strategyAgent = strategyAgent;
    this.answerSynthesizer = answerSynthesizer;
    this.intentDetector = intentDetector;
  }

  async run(req: ExecuteRequest): Promise<RlmRunResult> {
    const depth = Math.max(0, req.depth ?? 0);
    const maxDepth = Math.max(0, req.maxDepth ?? DEFAULT_MAX_DEPTH);
    const maxSteps = Math.max(1, Math.min(req.maxSteps ?? DEFAULT_MAX_STEPS, 10));
    const steps: RlmStep[] = [];

    const intent = depth === 0 ? await this.intentDetector.detect(req.query) : null;

    const strategy =
      depth === 0
        ? await this.strategyAgent.plan(req.query)
        : {
            enabled: false,
            recommendedMethod: "direct_answer",
            bestMethod: "direct_answer",
            shouldUseTools: false,
            methods: [],
            reason: "Strategy skipped for child agent.",
          };

    const intentRecord = toRecord(intent);
    const normalizedQuery =
      typeof intentRecord.normalizedQuery === "string"
        ? intentRecord.normalizedQuery
        : req.query;

    const guidance = buildRunGuidance({ intent, strategy });

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
      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
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

        const step: RlmStep = {
          stepIndex,
          generatedCode,
          stdout: execution.stdout,
          final: execution.final,
          finalCalled: execution.finalCalled,
          error: execution.error,
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