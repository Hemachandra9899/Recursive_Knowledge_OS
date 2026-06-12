import os
from typing import Any, Dict

from fastapi import HTTPException
from langchain_nvidia_ai_endpoints import ChatNVIDIA

from modules.chat.chat_schema import ChatRequest


def _build_client(req: ChatRequest):
    if req.mode == "fast_intent":
        model = os.getenv("FAST_INTENT_MODEL", "deepseek-ai/deepseek-v4-flash")
        return model, ChatNVIDIA(
            model=model,
            api_key=os.getenv("NVIDIA_API_KEY"),
            temperature=req.temperature if req.temperature is not None else 0.0,
            top_p=req.top_p if req.top_p is not None else 0.1,
            max_tokens=req.max_tokens if req.max_tokens is not None else 512,
        )
    elif req.mode == "coding":
        model = os.getenv("NVIDIA_CODER_MODEL", "qwen/qwen3-coder-480b-a35b-instruct")
        return model, ChatNVIDIA(
            model=model,
            api_key=os.getenv("NVIDIA_API_KEY"),
            temperature=req.temperature if req.temperature is not None else 0.2,
            top_p=req.top_p if req.top_p is not None else 0.8,
            max_tokens=req.max_tokens if req.max_tokens is not None else 2048,
        )
    else:
        model = os.getenv("NVIDIA_REASONING_MODEL", "meta/llama-3.3-70b-instruct")
        return model, ChatNVIDIA(
            model=model,
            api_key=os.getenv("NVIDIA_API_KEY"),
            temperature=req.temperature if req.temperature is not None else 1.0,
            top_p=req.top_p if req.top_p is not None else 1.0,
            max_tokens=req.max_tokens if req.max_tokens is not None else 4096,
            extra_body={
                "chat_template_kwargs": {
                    "enable_thinking": True,
                    "clear_thinking": False,
                }
            },
        )


def chat_response(req: ChatRequest) -> Dict[str, Any]:
    try:
        model, client = _build_client(req)
    except Exception as e:
        raise HTTPException(status_code=502, detail={"error": f"Failed to initialize model client: {str(e)}", "mode": req.mode})

    reasoning_parts = []
    content_parts = []

    try:
        for chunk in client.stream(req.messages):
            if chunk.additional_kwargs and "reasoning_content" in chunk.additional_kwargs:
                reasoning_parts.append(chunk.additional_kwargs["reasoning_content"])
            if chunk.content:
                content_parts.append(chunk.content)
    except Exception as e:
        detail = str(e)
        status_code = 504 if "timeout" in detail.lower() or "gateway" in detail.lower() else 502
        raise HTTPException(status_code=status_code, detail={"error": detail, "mode": req.mode, "model": model})

    return {
        "model": model,
        "mode": req.mode,
        "reasoning": "".join(reasoning_parts),
        "content": "".join(content_parts),
    }


def list_available_models() -> list[dict]:
    try:
        return [{"id": getattr(m, "id", None)} for m in ChatNVIDIA.get_available_models()]
    except Exception:
        return []
