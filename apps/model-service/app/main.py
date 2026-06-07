from fastapi import FastAPI

from modules.chat.chat_router import router as chat_router
from modules.embeddings.embeddings_router import router as embeddings_router
from modules.convert.convert_router import router as convert_router
from modules.scrape.scrape_router import router as scrape_router

app = FastAPI(title="RLM Forge Model Service")


@app.get("/health")
def health():
    return {"status": "ok", "service": "model-service"}


app.include_router(chat_router)
app.include_router(embeddings_router)
app.include_router(convert_router)
app.include_router(scrape_router)
