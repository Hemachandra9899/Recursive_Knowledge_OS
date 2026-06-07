import tempfile
from pathlib import Path
from typing import Optional

from markitdown import MarkItDown


async def convert_file(file_content: bytes, filename: str, content_type: Optional[str] = None, source_url: Optional[str] = None) -> dict:
    suffix = Path(filename or "upload").suffix

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_content)
        tmp_path = tmp.name

    try:
        md = MarkItDown()
        result = md.convert(tmp_path)

        markdown = getattr(result, "text_content", "") or ""
        title = filename or "Uploaded file"

        if not markdown.strip():
            raise ValueError("MarkItDown returned empty markdown")

        return {
            "status": "ok",
            "filename": filename,
            "title": title,
            "sourceUrl": source_url,
            "markdown": markdown,
            "metadata": {
                "provider": "markitdown",
                "filename": filename,
                "contentType": content_type,
                "sizeBytes": len(file_content),
            },
        }
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass
