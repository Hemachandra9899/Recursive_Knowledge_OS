import { loadPyodide, type PyodideInterface } from "pyodide";
import type { PythonExecutionResult } from "./types.ts";

let pyodidePromise: Promise<PyodideInterface> | null = null;

async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide();
  }
  return pyodidePromise;
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class PythonSandbox {
  async execute(code: string): Promise<PythonExecutionResult> {
    const pyodide = await getPyodide();

    const wrappedCode = `
import sys
import io
import json
import traceback

_rlm_stdout = io.StringIO()
_rlm_final_called = False
_rlm_final_value = None
_rlm_error = None

def final(value=None):
    global _rlm_final_called, _rlm_final_value
    _rlm_final_called = True
    _rlm_final_value = value

_old_stdout = sys.stdout
sys.stdout = _rlm_stdout

try:
${indent(code)}
except Exception:
    _rlm_error = traceback.format_exc()
finally:
    sys.stdout = _old_stdout

def _rlm_to_jsonable(value):
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)

json.dumps({
    "stdout": _rlm_stdout.getvalue(),
    "final": _rlm_to_jsonable(_rlm_final_value),
    "finalCalled": _rlm_final_called,
    "error": _rlm_error
})
`;

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
}

function indent(code: string): string {
  return code
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
