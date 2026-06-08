export type ScoutMemoryScope =
  | "user"
  | "project"
  | "session"
  | "agent"
  | "source";

export type ScoutMemoryKind =
  | "preference"
  | "fact"
  | "durable_fact"
  | "source_quality"
  | "source_failure"
  | "decision"
  | "task_trace";

export type ScoutMemory = {
  id: string;
  projectId: string;
  userId?: string | null;
  scope: ScoutMemoryScope;
  kind: ScoutMemoryKind;
  text: string;
  entities: string[];
  sourceUrls: string[];
  confidence: number;
  eventTime?: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type ScoutMemoryDraft = {
  projectId: string;
  userId?: string;
  scope: ScoutMemoryScope;
  kind: ScoutMemoryKind;
  text: string;
  entities?: string[];
  sourceUrls?: string[];
  confidence?: number;
  eventTime?: Date;
  metadata?: Record<string, unknown>;
};

export type ScoutMemorySearchInput = {
  projectId: string;
  userId?: string;
  query: string;
  limit?: number;
  scopes?: ScoutMemoryScope[];
  kinds?: ScoutMemoryKind[];
};
