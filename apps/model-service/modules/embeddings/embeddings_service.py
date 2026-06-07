import os

from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings

from modules.embeddings.embeddings_schema import EmbedRequest


def embed_texts(req: EmbedRequest) -> dict:
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
