import type { ChatMessage, ModelChatResponse } from "./types.ts";

const DEFAULT_MODEL_SERVICE_URL = "http://model-service:8100";

export class ModelClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl = Deno.env.get("MODEL_SERVICE_URL") || DEFAULT_MODEL_SERVICE_URL,
  ) {
    this.baseUrl = baseUrl;
  }

  async chatCoding(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "coding",
        messages,
        temperature: 0.2,
        top_p: 0.8,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `model-service /chat failed: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as ModelChatResponse;

    if (!data.content || !data.content.trim()) {
      throw new Error("model-service returned empty coding response");
    }

    return data.content;
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
