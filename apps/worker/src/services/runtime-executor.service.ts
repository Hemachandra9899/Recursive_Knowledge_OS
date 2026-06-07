const runtimeUrl = process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

export async function executeResearchQuery(input: {
  runId: string;
  projectId: string;
  query: string;
}) {
  const resp = await fetch(`${runtimeUrl}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: input.runId,
      projectId: input.projectId,
      query: input.query,
      maxSteps: 5,
      maxDepth: 2,
    }),
  });

  return await resp.json();
}
