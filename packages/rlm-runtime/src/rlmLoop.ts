import { sanitizeGeneratedPython, truncateText } from "./codeUtils.ts";
import { ModelClient } from "./modelClient.ts";
import { PythonSandbox } from "./pythonSandbox.ts";
import type {
  ChatMessage,
  ExecuteRequest,
  RlmRunResult,
  RlmStep,
} from "./types.ts";

const DEFAULT_MAX_STEPS = 5;

const SYSTEM_PROMPT = `
You are running inside RLM Forge, a Recursive Language Model Python execution environment.

You must write Python code only.

Available functions:
- print(value): inspect intermediate values
- final(value): return the final answer and stop execution

Rules:
1. Return only executable Python code.
2. Do not use markdown.
3. Do not wrap code in triple backticks.
4. Do not explain.
5. Always call final(...) when the task is complete.
6. Keep code simple.
7. Use only Python standard library unless the task clearly does not need imports.
`.trim();

function buildInitialMessages(query: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `User task:\n${query}\n\nWrite the next Python code block to solve this task.`,
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

export class RlmLoop {
  private readonly modelClient: ModelClient;
  private readonly sandbox: PythonSandbox;

  constructor(
    modelClient = new ModelClient(),
    sandbox = new PythonSandbox(),
  ) {
    this.modelClient = modelClient;
    this.sandbox = sandbox;
  }

  async run(req: ExecuteRequest): Promise<RlmRunResult> {
    const maxSteps = Math.max(
      1,
      Math.min(req.maxSteps ?? DEFAULT_MAX_STEPS, 10),
    );
    const messages = buildInitialMessages(req.query);
    const steps: RlmStep[] = [];

    try {
      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
        const rawCode = await this.modelClient.chatCoding(messages);
        const generatedCode = sanitizeGeneratedPython(rawCode);
        const execution = await this.sandbox.execute(generatedCode);

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
          return {
            status: "completed",
            runId: req.runId,
            projectId: req.projectId,
            query: req.query,
            final: execution.final,
            steps,
            error: null,
          };
        }
      }

      return {
        status: "max_steps_reached",
        runId: req.runId,
        projectId: req.projectId,
        query: req.query,
        final: steps.at(-1)?.final ?? null,
        steps,
        error:
          "RLM loop reached maxSteps before final() completed successfully.",
      };
    } catch (error) {
      return {
        status: "failed",
        runId: req.runId,
        projectId: req.projectId,
        query: req.query,
        final: null,
        steps,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
