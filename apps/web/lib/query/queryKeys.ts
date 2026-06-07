export const queryKeys = {
  healthDeps: ["health", "deps"] as const,

  projects: ["projects"] as const,

  projectJobs: (projectId: string) =>
    ["projects", projectId, "jobs"] as const,

  projectDocuments: (projectId: string) =>
    ["projects", projectId, "documents"] as const,

  researchJob: (jobId: string) =>
    ["research-jobs", jobId] as const,

  researchJobStatus: (jobId: string) =>
    ["research-jobs", jobId, "status"] as const,
};
