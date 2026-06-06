import { sanitizeGeneratedPython, truncateText } from "../utils/codeUtils.ts";
import { ModelClient } from "./modelClient.ts";
import { PythonSandbox } from "./pythonSandbox.ts";
import { ToolsClient } from "./toolsClient.ts";
import { StrategyAgent } from "./strategyAgent.ts";
import { AnswerSynthesizer } from "./answerSynthesizer.ts";
import { extractSources, isGenericOrRawAnswer } from "./answerUtils.ts";
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
You are running inside RLM Forge, a Recursive Language Model Python execution environment.

You must write Python code only.

Available async functions:
- await llm_query(prompt: str, context: dict = None)
- await crawl_url(url: str, max_pages: int = 1)
- await search_kb(query: str, top_k: int = 5)
- await web_research(query: str, max_results: int = 3)
- await query_graph(query: str, depth: int = 1)

Available sync functions:
- print(value)
- final(value)

Tool output rules:
- search_kb(query) returns a list of chunk objects.
- Each search result may contain: text, title, sourceUrl, score, retrieval, metadata.
- Do not expect an "answer" field from search_kb.
- Use result["text"] as evidence when available.
- crawl_url(url) returns a document ingestion summary.
- web_research(query) searches/scrapes the web and stores results into project knowledge.
- After web_research(...), call search_kb(...) again to read stored chunks.
- query_graph(query) returns entities and relations.

Python execution rules:
1. Return only executable Python code.
2. Do not use markdown.
3. Do not wrap code in triple backticks.
4. Do not explain outside code.
5. Do not use asyncio.run().
6. You are already inside an async function, so use await directly.
7. Always call final(...) when the task is complete.
8. final(...) must contain the actual user-facing answer.
9. Never call final("All questions have been answered.").
10. Never call final("Done.").
11. If the user asks multiple questions, answer each question clearly.
12. Prefer normal readable text in final(...), unless the user asks for JSON.
13. Use search_kb before answering from stored project knowledge.
14. If search_kb returns no results and the user asks about public docs, APIs, libraries, companies, products, or current external information, call web_research(...), then call search_kb(...) again.
15. Do not stop with "No project knowledge found" until web_research has been tried.
16. If the user says "mets graph api", treat it as "Meta Graph API".
17. For ads platform questions about Meta/Facebook, research "Meta Graph API Marketing API ads platform endpoints".
18. Never pass raw search_kb results directly to final().
19. Never expose chunkId, documentId, metadata, or raw result arrays to the user.
20. When using search_kb, synthesize the result["text"] fields into a normal answer.
21. At the end of the answer, include source titles/URLs if available.
22. If the answer is about an ads platform, prioritize actionable implementation areas.
`.trim();

function buildInitialMessages(
  query: string,
  depth: number,
  maxDepth: number
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `User task:`,
        query,
        ``,
        `Current recursion depth: ${depth}`,
        `Maximum recursion depth: ${maxDepth}`,
        ``,
        `Write the next Python code block to solve this task.`,
      ].join("\n"),
    },
  ];
}

function buildExecutionFeedback(step: RlmStep): string {
  return `
Execution result for step ${step.stepIndex}:

Code:
${step.generatedCode}

stdout:
${truncateText(step.stdout, 4000)}

error:
${step.error ?? "None"}

finalCalled:
${step.finalCalled}

final:
${JSON.stringify(step.final)}

If finalCalled is false and there is no fatal error, write the next Python code block.
If there is an error, fix it with the next code block.
`.trim();
}

function childRunId(
  parentRunId: string | undefined,
  depth: number
): string | undefined {
  if (!parentRunId) return undefined;
  return `${parentRunId}:child:${depth}:${crypto.randomUUID()}`;
}

export class RlmLoop {
  private readonly modelClient: ModelClient;
  private readonly sandbox: PythonSandbox;
  private readonly toolsClient: ToolsClient;
  private readonly strategyAgent: StrategyAgent;
  private readonly answerSynthesizer: AnswerSynthesizer;

  constructor(
    modelClient = new ModelClient(),
    sandbox = new PythonSandbox(),
    toolsClient = new ToolsClient(),
    strategyAgent = new StrategyAgent(modelClient),
    answerSynthesizer = new AnswerSynthesizer(modelClient)
  ) {
    this.modelClient = modelClient;
    this.sandbox = sandbox;
    this.toolsClient = toolsClient;
    this.strategyAgent = strategyAgent;
    this.answerSynthesizer = answerSynthesizer;
  }

  async run(req: ExecuteRequest): Promise<RlmRunResult> {
    const depth = Math.max(0, req.depth ?? 0);
    const maxDepth = Math.max(0, req.maxDepth ?? DEFAULT_MAX_DEPTH);
    const maxSteps = Math.max(1, Math.min(req.maxSteps ?? DEFAULT_MAX_STEPS, 10));

    const strategy = depth === 0
      ? await this.strategyAgent.plan(req.query)
      : {
          enabled: false,
          recommendedMethod: "direct_answer",
          bestMethod: "direct_answer",
          shouldUseTools: false,
          methods: [],
          reason: "Strategy skipped for child agent.",
        };

    const strategyText = strategy.enabled
      ? `

Answer strategy selected before execution:
${JSON.stringify(strategy, null, 2)}

Follow this strategy when writing Python.
Do not mention the strategy unless useful to the user.
`
      : "";

    const messages = buildInitialMessages(
      `${req.query}${strategyText}`,
      depth,
      maxDepth
    );
    const steps: RlmStep[] = [];

    const subAgentHandler: SubAgentHandler = async (prompt, context) => {
      if (depth >= maxDepth) {
        return {
          error: `Maximum recursion depth ${maxDepth} reached. Solve manually in the current agent.`,
        };
      }

      const childPrompt = [
        prompt,
        ``,
        `Parent context:`,
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

    const finalizeAnswer = async (final: unknown): Promise<{ final: unknown; sources: AnswerSource[] }> => {
      const sources = extractSources(final, steps);
      const lastStdout = [...steps]
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

        return { final: synthesized.answer, sources: synthesized.sources };
      } catch {
        return { final: lastStdout || final, sources };
      }
    };

    try {
      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
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

        messages.push({ role: "assistant", content: generatedCode });
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
        steps,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
