
import { ModelClient } from "./modelClient.ts";
import type { ChatMessage } from "../types.ts";

export type FastIntentName = "github_repo" | "news" | "web_research" | "kb" | "code" | "document" | "general";
export type FastIntent = {
  intent: FastIntentName;
  requiresFreshness: boolean;
  requiresWeb: boolean;
  requiresGithub: boolean;
  requiredTools: string[];
  answerMode: "fast" | "deep";
  reason: string;
};

const DEFAULT: FastIntent = {
  intent: "general",
  requiresFreshness: false,
  requiresWeb: false,
  requiresGithub: false,
  requiredTools: [],
  answerMode: "fast",
  reason: "No fast-intent rule matched.",
};

function githubRepo(query: string): string | null {
  const m = query.match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  return m ? `${m[1]}/${m[2].replace(/\.git$/i, "")}` : null;
}
function has(q: string, regs: RegExp[]) { return regs.some((r) => r.test(q)); }
function tools(v: unknown): string[] {
  const allowed = new Set(["search_kb","web_research","crawl_url","query_graph","github_repo"]);
  return Array.isArray(v) ? [...new Set(v.map(String).filter((x) => allowed.has(x)))] : [];
}
function parseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text.trim()) as Record<string, unknown>; } catch {}
  const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}
function normIntent(v: unknown): FastIntentName {
  const s = String(v ?? "");
  return (["github_repo","news","web_research","kb","code","document","general"] as string[]).includes(s) ? s as FastIntentName : "general";
}

export class FastIntentDetector {
  constructor(private readonly modelClient = new ModelClient()) {}
  async detect(query: string): Promise<FastIntent> {
    const hard = this.detectWithRules(query); if (hard) return hard;
    if (Deno.env.get("FAST_INTENT_DISABLE_MODEL") === "1") return DEFAULT;
    try {
      const raw = await this.modelClient.chatFastIntent(this.messages(query));
      const j = parseJson(raw); if (!j) return DEFAULT;
      const requiredTools = tools(j.requiredTools);
      return {
        intent: normIntent(j.intent),
        requiredTools,
        answerMode: j.answerMode === "deep" ? "deep" : "fast",
        requiresFreshness: Boolean(j.requiresFreshness),
        requiresWeb: Boolean(j.requiresWeb) || requiredTools.includes("web_research"),
        requiresGithub: Boolean(j.requiresGithub) || requiredTools.includes("github_repo"),
        reason: typeof j.reason === "string" ? j.reason : "Classified by fast intent model.",
      };
    } catch { return DEFAULT; }
  }
  private detectWithRules(query: string): FastIntent | null {
    const q = query.toLowerCase(); const repo = githubRepo(query);
    if (repo) return { intent:"github_repo", requiresFreshness:false, requiresWeb:true, requiresGithub:true, requiredTools:["github_repo"], answerMode:"fast", reason:`GitHub repo URL detected (${repo}); use github_repo, not crawl_url.` };
    if (has(q,[/\b(readme|about.*project|tell me about|what.*codebase|documentation page)\b/i])) return { intent:"kb", requiresFreshness:false, requiresWeb:false, requiresGithub:false, requiredTools:["search_kb"], answerMode:"fast", reason:"Project/README/documentation query; search_kb is appropriate." };
    if (has(q,[/\b(news|latest|current|today|recent|new update|breaking|announcement|announced)\b/i,/\bwhatsapp\b/i,/\bwhat'?s app\b/i])) return { intent:"news", requiresFreshness:true, requiresWeb:true, requiresGithub:false, requiredTools:["web_research"], answerMode:"fast", reason:"Current/news query; web_research is mandatory." };
    if (has(q,[/\b(api|sdk|docs?|documentation|oauth|auth|authentication|permission|rate limits?|integration|webhook|endpoint)\b/i,/\b(compare|comparison|versus|vs)\b/i])) return { intent:"web_research", requiresFreshness:true, requiresWeb:true, requiresGithub:false, requiredTools:["web_research"], answerMode:"fast", reason:"API/docs/research query; web_research is mandatory." };
    if (has(q,[/\b(uploaded|file|pdf|document|spreadsheet|csv|attachment|my doc|this doc)\b/i])) return { intent:"document", requiresFreshness:false, requiresWeb:false, requiresGithub:false, requiredTools:["search_kb"], answerMode:"fast", reason:"Uploaded/local document query." };
    if (has(q,[/\b(write code|debug|fix code|implement|refactor|script|function|class|typescript|python|sql)\b/i])) return { intent:"code", requiresFreshness:false, requiresWeb:false, requiresGithub:false, requiredTools:[], answerMode:"deep", reason:"Coding/sandbox query." };
    return null;
  }
  private messages(query: string): ChatMessage[] { return [
    { role:"system", content:'Return JSON only: {"intent":"github_repo|news|web_research|kb|code|document|general","requiresFreshness":boolean,"requiresWeb":boolean,"requiresGithub":boolean,"requiredTools":["search_kb"|"web_research"|"crawl_url"|"query_graph"|"github_repo"],"answerMode":"fast|deep","reason":string}' },
    { role:"user", content:query },
  ]; }
}
