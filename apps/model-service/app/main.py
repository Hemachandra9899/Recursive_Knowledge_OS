import os
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI
from pydantic import BaseModel
from langchain_nvidia_ai_endpoints import ChatNVIDIA, NVIDIAEmbeddings

app = FastAPI(title="RLM Forge Model Service")


class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    mode: Literal["reasoning", "coding"] = "reasoning"
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None


class EmbedRequest(BaseModel):
    texts: List[str]


@app.get("/health")
def health():
    return {"status": "ok", "service": "model-service"}


@app.post("/chat")
def chat(req: ChatRequest) -> Dict[str, Any]:
    if req.mode == "coding":
        model = os.getenv("NVIDIA_CODER_MODEL", "qwen/qwen3-coder-480b-a35b-instruct")
        client = ChatNVIDIA(
            model=model,
            api_key=os.getenv("NVIDIA_API_KEY"),
            temperature=req.temperature if req.temperature is not None else 0.7,
            top_p=req.top_p if req.top_p is not None else 0.8,
            max_tokens=req.max_tokens if req.max_tokens is not None else 4096,
        )
    else:
        model = os.getenv("NVIDIA_REASONING_MODEL", "meta/llama-3.3-70b-instruct")
        client = ChatNVIDIA(
            model=model,
            api_key=os.getenv("NVIDIA_API_KEY"),
            temperature=req.temperature if req.temperature is not None else 1.0,
            top_p=req.top_p if req.top_p is not None else 1.0,
            max_tokens=req.max_tokens if req.max_tokens is not None else 16384,
        )

    reasoning_parts = []
    content_parts = []

    for chunk in client.stream(req.messages):
        if chunk.additional_kwargs and "reasoning_content" in chunk.additional_kwargs:
            reasoning_parts.append(chunk.additional_kwargs["reasoning_content"])
        if chunk.content:
            content_parts.append(chunk.content)

    return {
        "model": model,
        "mode": req.mode,
        "reasoning": "".join(reasoning_parts),
        "content": "".join(content_parts),
    }


@app.post("/embed")
def embed(req: EmbedRequest) -> Dict[str, Any]:
    if not req.texts:
        return {
            "model": os.getenv("NVIDIA_EMBEDDING_MODEL", "nvidia/nv-embedqa-e5-v5"),
            "vectors": [],
            "dim": 0,
        }

    model = os.getenv("NVIDIA_EMBEDDING_MODEL", "nvidia/nv-embedqa-e5-v5")

    client = NVIDIAEmbeddings(
        model=model,
        api_key=os.getenv("NVIDIA_API_KEY"),
    )

    vectors = client.embed_documents(req.texts)
    dim = len(vectors[0]) if vectors else 0

    return {
        "model": model,
        "vectors": vectors,
        "dim": dim,
    }
