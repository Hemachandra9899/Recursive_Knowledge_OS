import { ModelClient } from "./modelClient.ts";
import { readable } from "./answerUtils.ts";
import type { AnswerSource, ChatMessage, SynthesizedAnswer } from "../types.ts";

function sourceListText(sources: AnswerSource[]): string {
  if (!sources.length) return "No explicit sources extracted.";

  return sources
    .map((source, index) => {
      return `${index + 1}. ${source.title || "Untitled source"} - ${source.url || "no url"}`;
    })
    .join("\n");
}

export class AnswerSynthesizer {
  constructor(private readonly modelClient = new ModelClient()) {}

  async synthesize(input: {
    query: string;
    rawFinal: unknown;
    stdout: string;
    sources: AnswerSource[];
  }): Promise<SynthesizedAnswer> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "You are the RLM Forge answer synthesizer.",
          "",
          "Convert raw tool outputs into a normal readable user-facing answer.",
          "",
          "Rules:",
          "1. Do not output JSON.",
          "2. Do not expose chunkId, documentId, metadata, embeddings, scores, or raw arrays.",
          "3. Write a helpful answer in plain text or markdown.",
          "4. If the user asks what can I implement, organize the answer into sections.",
          "5. Use the raw retrieved text as evidence.",
          "6. Put source links only in a final Sources section.",
          "7. Do not invent sources.",
          "8. If evidence is weak, say what is missing.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `User question:`,
          input.query,
          "",
          "Raw final:",
          readable(input.rawFinal),
          "",
          "Execution stdout:",
          input.stdout,
          "",
          "Extracted sources:",
          sourceListText(input.sources),
          "",
          "Write the final answer now.",
        ].join("\n"),
      },
    ];

    const answer = await this.modelClient.chatReasoning(messages);

    return {
      answer,
      sources: input.sources,
    };
  }
}