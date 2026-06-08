from fastapi import APIRouter

from modules.scrape.scrape_schema import CrawlRequest, ScrapePageRequest
from modules.scrape.scrape_service import crawl_site, scrape_page

router = APIRouter()


@router.post("/scrape/page")
def scrape_page_endpoint(req: ScrapePageRequest):
    return scrape_page(req.url, mode=req.mode, ai_targeted=req.ai_targeted)


@router.post("/scrape/crawl")
def crawl_endpoint(req: CrawlRequest):
    return crawl_site(req)
