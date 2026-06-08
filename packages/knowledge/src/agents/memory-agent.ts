import type { AgentContext, AgentResult } from "./types.js";
import { okAgentResult } from "./types.js";
import { MemoryManager } from "../memory/memory-manager.js";
import type { ScoutMemory, ScoutMemoryDraft } from "../memory/memory-types.js";
import type { EvidencePack } from "../research/source-types.js";

export type MemoryAgentOutput = {
  retrieved: ScoutMemory[];
  written: number;
};

export class MemoryAgent {
  constructor(private readonly memoryManager = new MemoryManager()) {}

  async retrieveForRun(context: AgentContext): Promise<AgentResult<MemoryAgentOutput>> {
    const retrieved = await this.memoryManager.search({
      projectId: context.projectId,
      userId: context.userId,
      query: context.query,
      limit: 8,
    });

    return okAgentResult("memory", {
      retrieved,
      written: 0,
    });
  }

  buildSourceMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    return this.memoryManager.buildSourceMemoriesFromEvidencePack(input);
  }

  async writeRunMemories(
    context: AgentContext,
    drafts: ScoutMemoryDraft[]
  ): Promise<AgentResult<MemoryAgentOutput>> {
    if (drafts.length === 0) {
      return okAgentResult("memory", {
        retrieved: [],
        written: 0,
      });
    }

    const written = await this.memoryManager.addMany(
      drafts.map((draft) => ({
        ...draft,
        projectId: context.projectId,
        userId: draft.userId ?? context.userId,
      }))
    );

    return okAgentResult("memory", {
      retrieved: [],
      written,
    });
  }
}
