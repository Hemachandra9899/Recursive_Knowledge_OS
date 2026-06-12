import type { ChatMessage, ModelChatResponse } from "../types.ts";

const DEFAULT_MODEL_SERVICE_URL = "http://model-service:8100";

function fetchWithTimeout(url: string, options: RequestInit & { timeoutMs: number }): Promise<Response> {
  const { timeoutMs, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...fetchOpts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export class ModelClient {
  private readonly baseUrl: string;
  private readonly codingTimeoutMs: number;
  private readonly reasoningTimeoutMs: number;
  private readonly fastIntentTimeoutMs: number;

  constructor(
    baseUrl = Deno.env.get("MODEL_SERVICE_URL") || DEFAULT_MODEL_SERVICE_URL,
  ) {
    this.baseUrl = baseUrl;
    this.codingTimeoutMs = Number(Deno.env.get("RLM_CODING_TIMEOUT_MS") || 60000);
    this.reasoningTimeoutMs = Number(Deno.env.get("RLM_REASONING_TIMEOUT_MS") || 90000);
    this.fastIntentTimeoutMs = Number(Deno.env.get("RLM_FAST_INTENT_TIMEOUT_MS") || 10000);
  }

  async chatCoding(messages: ChatMessage[]): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "coding",
        messages,
        temperature: 0.2,
        top_p: 0.8,
        max_tokens: 2048,
      }),
      timeoutMs: this.codingTimeoutMs,
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

  async chatFastIntent(messages: ChatMessage[]): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}/chat`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ mode:"fast_intent", messages, temperature:0.0, top_p:0.1, max_tokens:512 }), timeoutMs: this.fastIntentTimeoutMs });
    if (!response.ok) throw new Error(`model-service /chat fast_intent failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as ModelChatResponse;
    if (!data.content?.trim()) throw new Error("model-service returned empty fast intent response");
    return data.content;
  }

  async chatReasoning(messages: ChatMessage[]): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "reasoning",
        messages,
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 4096,
      }),
      timeoutMs: this.reasoningTimeoutMs,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `model-service /chat reasoning failed: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as ModelChatResponse;

    if (!data.content || !data.content.trim()) {
      throw new Error("model-service returned empty reasoning response");
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
