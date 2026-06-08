import { Prisma } from "@prisma/client";
import { prisma } from "@rlm-forge/database/prisma.js";
import type {
  ScoutMemory,
  ScoutMemoryDraft,
  ScoutMemorySearchInput,
} from "./memory-types.js";
import type { EvidencePack } from "../research/source-types.js";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toScoutMemory(row: any): ScoutMemory {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    scope: row.scope,
    kind: row.kind,
    text: row.text,
    entities: asStringArray(row.entities),
    sourceUrls: asStringArray(row.sourceUrls),
    confidence: row.confidence ?? 0.7,
    eventTime: row.eventTime,
    metadata: asRecord(row.metadata),
    createdAt: row.createdAt,
  };
}

function scoreMemory(query: string, memory: ScoutMemory): number {
  const q = query.toLowerCase();
  const text = memory.text.toLowerCase();
  const entityScore = memory.entities.some((entity) =>
    q.includes(entity.toLowerCase())
  )
    ? 25
    : 0;

  const keywordScore = q
    .split(/\s+/)
    .filter((token) => token.length > 3 && text.includes(token)).length;

  const recencyScore = Math.max(
    0,
    10 -
      Math.floor(
        (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
  );

  return memory.confidence * 50 + entityScore + keywordScore * 3 + recencyScore;
}

export class MemoryManager {
  async addMany(drafts: ScoutMemoryDraft[]): Promise<number> {
    if (drafts.length === 0) return 0;

    await prisma.memory.createMany({
      data: drafts.map((draft) => ({
        projectId: draft.projectId,
        userId: draft.userId,
        scope: draft.scope,
        kind: draft.kind,
        text: draft.text,
        entities: (draft.entities ?? []) as unknown as Prisma.InputJsonValue,
        sourceUrls: (draft.sourceUrls ?? []) as unknown as Prisma.InputJsonValue,
        confidence: draft.confidence ?? 0.7,
        eventTime: draft.eventTime,
        metadata: (draft.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      })),
    });

    return drafts.length;
  }

  async search(input: ScoutMemorySearchInput): Promise<ScoutMemory[]> {
    const limit = input.limit ?? 8;
    const rows = await prisma.memory.findMany({
      where: {
        projectId: input.projectId,
        ...(input.userId
          ? {
              OR: [{ userId: input.userId }, { userId: null }],
            }
          : {}),
        ...(input.scopes?.length ? { scope: { in: input.scopes } } : {}),
        ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(limit * 5, 25),
    });

    return rows
      .map(toScoutMemory)
      .sort((a, b) => scoreMemory(input.query, b) - scoreMemory(input.query, a))
      .slice(0, limit);
  }

  buildSourceMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    const drafts: ScoutMemoryDraft[] = [];

    for (const item of input.evidencePack.evidence) {
      if (!item.url) continue;

      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "source",
        kind: "source_quality",
        text: `Source "${item.title}" was used for query "${input.evidencePack.query}" and ranked as ${item.tier}.`,
        sourceUrls: [item.url],
        entities: [item.product, item.domain].filter(Boolean) as string[],
        confidence:
          item.tier === "official_docs" || item.tier === "trusted_docs"
            ? 0.9
            : 0.65,
        metadata: {
          title: item.title,
          tier: item.tier,
          reason: item.reason,
          query: input.evidencePack.query,
        },
      });
    }

    return drafts;
  }
}
