const MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL || "http://model-service:8100";

export async function embedTexts(texts: string[]): Promise<{
  model: string;
  vectors: number[][];
  dim: number;
}> {
  if (texts.length === 0) {
    return {
      model: process.env.NVIDIA_EMBEDDING_MODEL || "unknown",
      vectors: [],
      dim: 0,
    };
  }

  const response = await fetch(`${MODEL_SERVICE_URL}/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`model-service /embed failed: ${response.status} ${text}`);
  }

  const data = await response.json();

  return {
    model: data.model,
    vectors: data.vectors,
    dim: data.dim,
  };
}
