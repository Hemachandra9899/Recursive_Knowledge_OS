const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

export type ScrapedPage = {
  status: string;
  url: string;
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

export async function scrapePageWithScrapling(url: string): Promise<ScrapedPage> {
  const response = await fetch(`${MODEL_SERVICE_URL}/scrape/page`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Scrapling scrape failed: ${response.status} ${text}`);
  }

  return await response.json();
}
