import { loadPyodide } from "pyodide";
import type {
  PythonExecutionResult,
  SubAgentHandler,
  ToolHandler,
} from "../types.ts";

let pyodidePromise: Promise<any> | null = null;

async function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide();
  }
  return pyodidePromise;
}

export class PythonSandbox {
  async execute(
    code: string,
    subAgentHandler: SubAgentHandler,
    toolHandler: ToolHandler
  ): Promise<PythonExecutionResult> {
    const pyodide = await getPyodide();

    pyodide.globals.set(
      "_rlm_query_js",
      async (prompt: string, context: unknown) => {
        return await subAgentHandler(String(prompt), context);
      }
    );

    pyodide.globals.set(
      "_rlm_tool_js",
      async (name: string, args: unknown) => {
        return await toolHandler(String(name), args as Record<string, unknown>);
      }
    );

    const wrappedCode = `
import sys
import io
import json
import traceback
from pyodide.ffi import to_js

_rlm_stdout = io.StringIO()
_rlm_final_called = False
_rlm_final_value = None
_rlm_error = None

def _to_py(value):
    try:
        return value.to_py()
    except Exception:
        return value

async def llm_query(prompt, context=None):
    result = await _rlm_query_js(prompt, to_js(context or {}))
    return _to_py(result)

async def crawl_url(url, max_pages=1):
    result = await _rlm_tool_js("crawl_url", to_js({
        "url": url,
        "maxPages": max_pages
    }))
    return _to_py(result)

async def search_kb(query, top_k=5):
    result = await _rlm_tool_js("search_kb", to_js({
        "query": query,
        "topK": top_k
    }))

    data = _to_py(result)

    if isinstance(data, dict) and "results" in data:
        return data["results"]

    return data

async def web_research(query, max_results=3):
    result = await _rlm_tool_js("web_research", to_js({
        "query": query,
        "maxResults": max_results
    }))
    return _to_py(result)

async def query_graph(query, depth=1):
    result = await _rlm_tool_js("query_graph", to_js({
        "query": query,
        "depth": depth
    }))

    data = _to_py(result)

    if isinstance(data, dict):
        return {
            "entities": data.get("entities", []),
            "relations": data.get("relations", []),
            "raw": data,
        }

    return data

def final(value=None):
    global _rlm_final_called, _rlm_final_value
    _rlm_final_called = True
    _rlm_final_value = value

def _rlm_to_jsonable(value):
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)

async def _rlm_user_main():
${this.indent(code)}

_old_stdout = sys.stdout
sys.stdout = _rlm_stdout

try:
    await _rlm_user_main()
except Exception:
    _rlm_error = traceback.format_exc()
finally:
    sys.stdout = _old_stdout

json.dumps({
    "stdout": _rlm_stdout.getvalue(),
    "final": _rlm_to_jsonable(_rlm_final_value),
    "finalCalled": _rlm_final_called,
    "error": _rlm_error
})`;

    try {
      const raw = await pyodide.runPythonAsync(wrappedCode);
      const parsed = JSON.parse(String(raw));

      return {
        stdout: String(parsed.stdout ?? ""),
        final: parsed.final ?? null,
        finalCalled: Boolean(parsed.finalCalled),
        error: parsed.error ?? null,
      };
    } catch (error) {
      return {
        stdout: "",
        final: null,
        finalCalled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private indent(code: string): string {
    return code
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
  }
}
