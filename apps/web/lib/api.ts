const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Project = {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
};

export type AgentStep = {
  id: string;
  stepIndex: number;
  code?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  result?: unknown;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  query: string;
  status: string;
  depth: number;
  finalOutput?: unknown;
  steps: AgentStep[];
};

export type Report = {
  id: string;
  title: string;
  content: string;
  metadata?: unknown;
  createdAt: string;
};

export type ResearchJob = {
  id: string;
  projectId: string;
  question: string;
  status: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  reports?: Report[];
  agentRuns?: AgentRun[];
};

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export type ProjectDocument = {
  id: string;
  projectId: string;
  sourceUrl?: string | null;
  title?: string | null;
  markdown: string;
  contentHash?: string | null;
  metadata?: unknown;
  createdAt: string;
  _count?: {
    chunks: number;
  };
};

export type IngestFileResponse = {
  status: string;
  filename: string;
  title: string;
  documentId: string;
  chunksCreated: number;
  chunksTotal: number;
  embeddedChunks: number;
  embeddingError?: string | null;
  deduped: boolean;
  markdownPreview: string;
};

export const api = {
  health: () => request<{ status: string; service: string }>("/health"),
  deps: () => request<Record<string, string>>("/health/deps"),
  listProjects: () => request<Project[]>("/projects"),
  createProject: (body: { name: string; description?: string }) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
  listProjectJobs: (projectId: string) =>
    request<ResearchJob[]>(`/projects/${projectId}/jobs`),
  createResearchJob: (body: { projectId: string; question: string }) =>
    request<{ jobId: string; queueJobId: string; status: string }>(
      "/research-jobs", { method: "POST", body: JSON.stringify(body) },
    ),
  getResearchJob: (jobId: string) =>
    request<ResearchJob>(`/research-jobs/${jobId}`),

  listProjectDocuments: (projectId: string) =>
    request<ProjectDocument[]>(`/projects/${projectId}/documents`),

  listDocumentChunks: (documentId: string) =>
    request<any[]>(`/documents/${documentId}/chunks`),

  ingestFile: async (body: {
    projectId: string;
    file: File;
    sourceUrl?: string;
  }) => {
    const formData = new FormData();
    formData.append("projectId", body.projectId);
    formData.append("file", body.file);

    if (body.sourceUrl) {
      formData.append("sourceUrl", body.sourceUrl);
    }

    const res = await fetch(`${API_URL}/tools/ingest-file`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }

    return res.json() as Promise<IngestFileResponse>;
  },
};
