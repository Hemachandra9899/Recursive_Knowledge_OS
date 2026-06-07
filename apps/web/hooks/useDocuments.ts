"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/query/queryKeys";

export function useProjectDocuments(projectId?: string) {
  return useQuery({
    queryKey: queryKeys.projectDocuments(projectId || ""),
    queryFn: () => api.listProjectDocuments(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useUploadFile(projectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => {
      if (!projectId) {
        throw new Error("projectId is required");
      }

      return api.ingestFile({
        projectId,
        file,
      });
    },
    onSuccess: () => {
      if (!projectId) return;

      queryClient.invalidateQueries({
        queryKey: queryKeys.projectDocuments(projectId),
      });
    },
  });
}
