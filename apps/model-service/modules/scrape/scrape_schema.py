from pydantic import BaseModel


class ScrapePageRequest(BaseModel):
    url: str
