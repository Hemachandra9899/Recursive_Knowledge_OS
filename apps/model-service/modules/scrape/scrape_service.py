from bs4 import BeautifulSoup
from markdownify import markdownify as html_to_markdown
from scrapling import Fetcher


def clean_html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
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


def scrape_page(url: str) -> dict:
    page = Fetcher.get(url)
    html = page.text
    markdown = clean_html_to_markdown(html)

    title = url
    try:
        soup = BeautifulSoup(html, "html.parser")
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
    except Exception:
        pass

    if not markdown.strip():
        raise ValueError("Scrapling returned empty markdown")

    return {
        "status": "ok",
        "url": url,
        "title": title,
        "markdown": markdown,
        "metadata": {
            "provider": "scrapling",
        },
    }
