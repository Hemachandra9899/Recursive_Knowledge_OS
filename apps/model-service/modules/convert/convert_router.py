from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile

from modules.convert.convert_service import convert_file

router = APIRouter()


@router.post("/convert/file")
async def convert_file_endpoint(
    file: UploadFile = File(...),
    source_url: Optional[str] = Form(default=None),
):
    content = await file.read()
    return await convert_file(
        file_content=content,
        filename=file.filename or "upload",
        content_type=file.content_type,
        source_url=source_url,
    )
