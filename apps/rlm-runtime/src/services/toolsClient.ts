export type ToolContext = {
  projectId?: string;
};

export class ToolsClient {
  private readonly apiUrl: string;

  constructor(apiUrl = Deno.env.get("API_URL") || "http://api:8000") {
    this.apiUrl = apiUrl;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<unknown> {
    const path = this.pathForTool(name);

    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: context.projectId, ...args }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { status: "error", error: `${name} failed: ${response.status} ${text}` };
    }

    return await response.json();
  }

  private pathForTool(name: string): string {
    switch (name) {
      case "crawl_url":
        return "/tools/crawl-url";
      case "search_kb":
        return "/tools/search-kb";
      case "query_graph":
        return "/tools/query-graph";
      case "web_research":
        return "/tools/web-research";
      case "github_repo":
        return "/tools/github-repo";
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
