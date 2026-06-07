from fastapi import APIRouter

from modules.scrape.scrape_schema import ScrapePageRequest
from modules.scrape.scrape_service import scrape_page

router = APIRouter()


@router.post("/scrape/page")
def scrape_page_endpoint(req: ScrapePageRequest):
    return scrape_page(req.url)
