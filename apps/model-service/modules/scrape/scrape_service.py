from bs4 import BeautifulSoup
from markdownify import markdownify as html_to_markdown
from urllib.parse import urljoin, urlparse, urldefrag

from modules.scrape.scrape_schema import CrawlRequest

try:
    from scrapling.fetchers import DynamicFetcher, Fetcher, StealthyFetcher
except Exception:
    from scrapling import Fetcher
    DynamicFetcher = None
    StealthyFetcher = None


NOISE_SELECTORS = [
    "script",
    "style",
    "noscript",
    "svg",
    "iframe",
    "template",
    "nav",
    "footer",
    "header",
    "[aria-hidden='true']",
]


def _normalize_url(url: str) -> str:
    clean, _fragment = urldefrag(url)
    return clean.rstrip("/")


def _same_domain(left: str, right: str) -> bool:
    return urlparse(left).netloc == urlparse(right).netloc


def _extract_html(page) -> str:
    return getattr(page, "html_content", None) or getattr(page, "content", "") or str(page)


def clean_html_to_markdown(html: str, ai_targeted: bool = True) -> str:
    soup = BeautifulSoup(html, "html.parser")

    selectors = NOISE_SELECTORS if ai_targeted else ["script", "style", "noscript", "svg", "iframe"]
    for selector in selectors:
        for tag in soup.select(selector):
            tag.decompose()

    main = (
        soup.find("main")
        or soup.find("article")
        or soup.find("div", {"role": "main"})
        or soup.body
        or soup
    )

    markdown = html_to_markdown(str(main), heading_style="ATX")
    lines = [line.rstrip() for line in markdown.splitlines()]
    markdown = "\n".join(lines)

    while "\n\n\n\n" in markdown:
        markdown = markdown.replace("\n\n\n\n", "\n\n\n")

    return markdown.strip()


def _fetch_static(url: str):
    return Fetcher.get(url)


def _fetch_dynamic(url: str):
    if DynamicFetcher is None:
        return _fetch_static(url)
    return DynamicFetcher.fetch(
        url,
        headless=True,
        network_idle=True,
        timeout=30000,
    )


def _fetch_stealth(url: str):
    if StealthyFetcher is None:
        return _fetch_dynamic(url)
    return StealthyFetcher.fetch(
        url,
        headless=True,
        network_idle=True,
        timeout=30000,
    )


def fetch_page(url: str, mode: str = "auto"):
    if mode == "static":
        return _fetch_static(url), "static"

    if mode == "dynamic":
        return _fetch_dynamic(url), "dynamic"

    if mode == "stealth":
        return _fetch_stealth(url), "stealth"

    # Auto mode: start cheap, then progressively try heavier fetchers.
    try:
        page = _fetch_static(url)
        html = _extract_html(page)
        if len(html) > 500:
            return page, "static"
    except Exception:
        pass

    try:
        page = _fetch_dynamic(url)
        html = _extract_html(page)
        if len(html) > 500:
            return page, "dynamic"
    except Exception:
        pass

    return _fetch_stealth(url), "stealth"


def _extract_title(html: str, fallback_url: str) -> str:
    try:
        soup = BeautifulSoup(html, "html.parser")
        if soup.title and soup.title.string:
            return soup.title.string.strip()
    except Exception:
        pass
    return fallback_url


def extract_links(html: str, base_url: str, same_domain_only: bool = True) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links: list[str] = []

    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href")
        if not href:
            continue

        absolute = _normalize_url(urljoin(base_url, href))
        parsed = urlparse(absolute)

        if parsed.scheme not in {"http", "https"}:
            continue

        if same_domain_only and not _same_domain(base_url, absolute):
            continue

        lowered = absolute.lower()
        if any(
            blocked in lowered
            for blocked in [
                "/login",
                "/signin",
                "/signup",
                "/cart",
                "/checkout",
                "utm_",
                "mailto:",
            ]
        ):
            continue

        links.append(absolute)

    return list(dict.fromkeys(links))


def scrape_page(url: str, mode: str = "auto", ai_targeted: bool = True) -> dict:
    page, fetch_mode = fetch_page(url, mode=mode)
    html = _extract_html(page)
    markdown = clean_html_to_markdown(html, ai_targeted=ai_targeted)

    title = _extract_title(html, url)

    if not markdown.strip():
        raise ValueError("Scrapling returned empty markdown")

    return {
        "status": "ok",
        "url": url,
        "title": title,
        "markdown": markdown,
        "metadata": {
            "provider": "scrapling",
            "fetch_mode": fetch_mode,
            "ai_targeted": ai_targeted,
        },
    }


def crawl_site(req: CrawlRequest) -> dict:
    root_url = _normalize_url(req.root_url)
    queue: list[tuple[str, int, str | None]] = [(root_url, 0, None)]
    seen: set[str] = set()
    pages: list[dict] = []
    failed_urls: list[dict] = []

    max_pages = max(1, min(req.max_pages, 25))
    max_depth = max(0, min(req.max_depth, 3))

    while queue and len(pages) < max_pages:
        url, depth, parent_url = queue.pop(0)
        url = _normalize_url(url)

        if url in seen:
            continue

        seen.add(url)

        try:
            page, fetch_mode = fetch_page(url, mode=req.mode)
            html = _extract_html(page)
            markdown = clean_html_to_markdown(html, ai_targeted=req.ai_targeted)

            if not markdown.strip():
                raise ValueError("Scrapling returned empty markdown")

            pages.append(
                {
                    "status": "ok",
                    "url": url,
                    "title": _extract_title(html, url),
                    "markdown": markdown,
                    "depth": depth,
                    "parentUrl": parent_url,
                    "metadata": {
                        "provider": "scrapling",
                        "fetch_mode": fetch_mode,
                        "ai_targeted": req.ai_targeted,
                    },
                }
            )

            if depth < max_depth:
                for link in extract_links(
                    html,
                    url,
                    same_domain_only=req.same_domain_only,
                ):
                    if link not in seen:
                        queue.append((link, depth + 1, url))
        except Exception as exc:
            failed_urls.append({"url": url, "reason": str(exc)})

    return {
        "status": "ok" if pages else "error",
        "rootUrl": root_url,
        "pages": pages,
        "failedUrls": failed_urls,
        "metadata": {
            "provider": "scrapling",
            "mode": req.mode,
            "max_pages": max_pages,
            "max_depth": max_depth,
            "same_domain_only": req.same_domain_only,
        },
    }
