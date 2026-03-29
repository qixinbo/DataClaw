from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from openai import OpenAI

from app.schemas.embedding_model import (
    EmbeddingModelConfig,
    EmbeddingModelConfigCreate,
    EmbeddingModelConfigUpdate,
    EmbeddingModelConnectionTestRequest
)
from app.services.embedding_model_store import embedding_model_store
from app.services.openai_compat import normalize_openai_base_url
from app.api.llm import get_admin_user, get_current_user, CurrentUser

router = APIRouter()

def _mask_api_key(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * (len(value) - 8)}{value[-4:]}"

@router.get("/embedding-models", response_model=List[EmbeddingModelConfig])
def list_embedding_models(current_user: CurrentUser = Depends(get_current_user)):
    models = embedding_model_store.list_models()
    for m in models:
        if not current_user.is_admin:
            m["api_key"] = None
    return models

@router.post("/embedding-models", response_model=EmbeddingModelConfig)
def create_embedding_model(payload: EmbeddingModelConfigCreate, _: CurrentUser = Depends(get_admin_user)):
    return embedding_model_store.create_model(payload.model_dump())

@router.get("/embedding-models/{model_id}", response_model=EmbeddingModelConfig)
def get_embedding_model(model_id: str, current_user: CurrentUser = Depends(get_current_user)):
    model = embedding_model_store.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Embedding model not found")
    if not current_user.is_admin:
        model["api_key"] = None
    return model

@router.put("/embedding-models/{model_id}", response_model=EmbeddingModelConfig)
def update_embedding_model(model_id: str, payload: EmbeddingModelConfigUpdate, _: CurrentUser = Depends(get_admin_user)):
    model = embedding_model_store.update_model(model_id, payload.model_dump(exclude_unset=True))
    if not model:
        raise HTTPException(status_code=404, detail="Embedding model not found")
    return model

@router.delete("/embedding-models/{model_id}")
def delete_embedding_model(model_id: str, _: CurrentUser = Depends(get_admin_user)):
    deleted = embedding_model_store.delete_model(model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Embedding model not found")
    return {"status": "success"}

@router.post("/embedding-models/test")
def test_embedding_model_connection(payload: EmbeddingModelConnectionTestRequest, _: CurrentUser = Depends(get_admin_user)):
    api_base = normalize_openai_base_url(payload.api_base or "")
    api_key = payload.api_key
    model_name = (payload.model or "").strip()

    if not api_base:
        raise HTTPException(status_code=400, detail="API Base is required")
    if not api_key:
        raise HTTPException(status_code=400, detail="API Key is required")
    if not model_name:
        raise HTTPException(status_code=400, detail="Model name is required")

    try:
        client = OpenAI(
            api_key=api_key,
            base_url=api_base,
        )
        embedding_resp = client.embeddings.create(
            model=model_name,
            input="connection test",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Embedding call failed: {exc}")

    dimension = None
    if getattr(embedding_resp, "data", None):
        first = embedding_resp.data[0]
        vector = getattr(first, "embedding", None)
        if isinstance(vector, list):
            dimension = len(vector)

    return {
        "success": True,
        "message": "Connection successful",
        "model_name": model_name,
        "embedding_dimension": dimension,
    }
