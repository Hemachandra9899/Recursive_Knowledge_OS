"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/query/queryKeys";

export function useProjectJobs(projectId?: string) {
  return useQuery({
    queryKey: queryKeys.projectJobs(projectId || ""),
    queryFn: () => api.listProjectJobs(projectId!),
    enabled: Boolean(projectId),
  });
}
