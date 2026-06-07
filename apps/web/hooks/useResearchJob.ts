"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/query/queryKeys";

function isTerminalStatus(status?: string) {
  return status === "COMPLETED" || status === "FAILED";
}

export function useCreateResearchJob(projectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (question: string) => {
      if (!projectId) {
        throw new Error("projectId is required");
      }

      return api.createResearchJob({
        projectId,
        question,
      });
    },
    onSuccess: () => {
      if (!projectId) return;

      queryClient.invalidateQueries({
        queryKey: queryKeys.projectJobs(projectId),
      });
    },
  });
}

export function useResearchJobStatus(jobId?: string) {
  return useQuery({
    queryKey: queryKeys.researchJobStatus(jobId || ""),
    queryFn: () => api.getResearchJobStatus(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;

      if (!status || isTerminalStatus(status)) {
        return false;
      }

      return 2500;
    },
  });
}

export function useResearchJob(jobId?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.researchJob(jobId || ""),
    queryFn: () => api.getResearchJob(jobId!),
    enabled: Boolean(jobId) && enabled,
    staleTime: 0,
  });
}

export function isTerminalJobStatus(status?: string) {
  return isTerminalStatus(status);
}
