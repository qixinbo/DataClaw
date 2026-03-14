import json
import os
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel, Field

router = APIRouter()

DATA_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "llm_config.json")

class LLMConfig(BaseModel):
    id: str = Field(..., description="Unique identifier for the LLM configuration")
    provider: str = Field(..., description="Provider name (e.g., openai, azure, anthropic)")
    model: str = Field(..., description="Model name (e.g., gpt-4, claude-3-opus)")
    api_key: Optional[str] = Field(None, description="API Key for the provider")
    api_base: Optional[str] = Field(None, description="Base URL for the API")
    extra_headers: Optional[Dict[str, str]] = Field(None, description="Extra headers for the request")
    is_active: bool = Field(True, description="Whether this configuration is active")

class LLMConfigCreate(BaseModel):
    id: str
    provider: str
    model: str
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    extra_headers: Optional[Dict[str, str]] = None
    is_active: bool = True

class LLMConfigUpdate(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    extra_headers: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None

def _load_data() -> List[Dict[str, Any]]:
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return []

def _save_data(data: List[Dict[str, Any]]):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

@router.get("/llm", response_model=List[LLMConfig])
def list_llm_configs():
    data = _load_data()
    return [LLMConfig(**item) for item in data]

@router.get("/llm/{config_id}", response_model=LLMConfig)
def get_llm_config(config_id: str):
    data = _load_data()
    for item in data:
        if item["id"] == config_id:
            return LLMConfig(**item)
    raise HTTPException(status_code=404, detail="LLM configuration not found")

@router.post("/llm", response_model=LLMConfig)
def create_llm_config(config: LLMConfigCreate):
    data = _load_data()
    if any(item["id"] == config.id for item in data):
        raise HTTPException(status_code=400, detail="LLM configuration with this ID already exists")
    
    new_config = config.dict()
    data.append(new_config)
    _save_data(data)
    return LLMConfig(**new_config)

@router.put("/llm/{config_id}", response_model=LLMConfig)
def update_llm_config(config_id: str, config: LLMConfigUpdate):
    data = _load_data()
    for i, item in enumerate(data):
        if item["id"] == config_id:
            updated_item = item.copy()
            update_data = config.dict(exclude_unset=True)
            updated_item.update(update_data)
            data[i] = updated_item
            _save_data(data)
            return LLMConfig(**updated_item)
    raise HTTPException(status_code=404, detail="LLM configuration not found")

@router.delete("/llm/{config_id}")
def delete_llm_config(config_id: str):
    data = _load_data()
    initial_len = len(data)
    data = [item for item in data if item["id"] != config_id]
    if len(data) == initial_len:
        raise HTTPException(status_code=404, detail="LLM configuration not found")
    _save_data(data)
    return {"message": "LLM configuration deleted successfully"}
