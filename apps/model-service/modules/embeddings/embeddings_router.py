from fastapi import APIRouter

from modules.embeddings.embeddings_schema import EmbedRequest
from modules.embeddings.embeddings_service import embed_texts

router = APIRouter()


@router.post("/embed")
def embed(req: EmbedRequest):
    return embed_texts(req)
