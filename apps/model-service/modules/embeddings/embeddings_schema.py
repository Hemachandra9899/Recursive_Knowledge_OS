from pydantic import BaseModel


class EmbedRequest(BaseModel):
    texts: list[str]
