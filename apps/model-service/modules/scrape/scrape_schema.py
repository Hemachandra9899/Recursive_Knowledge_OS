from pydantic import BaseModel
from typing import Literal


ScrapeMode = Literal["auto", "static", "dynamic", "stealth"]


class ScrapePageRequest(BaseModel):
    url: str
    mode: ScrapeMode = "auto"
    ai_targeted: bool = True


class CrawlRequest(BaseModel):
    root_url: str
    max_pages: int = 5
    max_depth: int = 1
    mode: ScrapeMode = "auto"
    ai_targeted: bool = True
    same_domain_only: bool = True
