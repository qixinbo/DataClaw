import json
import os
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
from pydantic import BaseModel, Field
from app.core.security import SECRET_KEY, ALGORITHM
from app.core.data_root import get_data_root
from litellm import completion

router = APIRouter()
security = HTTPBearer()

DATA_FILE = str(get_data_root() / "llm_config.json")


class CurrentUser(BaseModel):
    id: int
    username: str
    is_admin: bool = False

class LLMConfig(BaseModel):
    id: str = Field(..., description="Unique identifier for the LLM configuration")
    name: Optional[str] = Field(None, description="Display name")
    provider: str = Field(..., description="Provider name (e.g., openai, azure, anthropic)")
    model: str = Field(..., description="Model name (e.g., gpt-4, claude-3-opus)")
    api_key: Optional[str] = Field(None, description="API Key for the provider")
    api_base: Optional[str] = Field(None, description="Base URL for the API")
    extra_headers: Optional[Dict[str, str]] = Field(None, description="Extra headers for the request")
    is_active: bool = Field(True, description="Whether this configuration is active")

class LLMConfigCreate(BaseModel):
    id: str
    name: Optional[str] = None
    provider: str
    model: str
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    extra_headers: Optional[Dict[str, str]] = None
    is_active: bool = True

class LLMConfigUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    extra_headers: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None

class TestConnectionRequest(BaseModel):
    provider: str
    model: str
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    extra_headers: Optional[Dict[str, str]] = None


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> CurrentUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise unauthorized
    user_id = payload.get("id")
    username = payload.get("sub")
    is_admin = bool(payload.get("is_admin", False))
    if user_id is None or username is None:
        raise unauthorized
    return CurrentUser(id=user_id, username=username, is_admin=is_admin)


def get_admin_user(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")
    return current_user

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


def _sanitize_config(item: Dict[str, Any], is_admin: bool) -> Dict[str, Any]:
    config = item.copy()
    if not is_admin:
        config["api_key"] = None
    return config

@router.get("/llm", response_model=List[LLMConfig])
def list_llm_configs(current_user: CurrentUser = Depends(get_current_user)):
    data = _load_data()
    return [LLMConfig(**_sanitize_config(item, current_user.is_admin)) for item in data]

@router.get("/llm/{config_id}", response_model=LLMConfig)
def get_llm_config(config_id: str, current_user: CurrentUser = Depends(get_current_user)):
    data = _load_data()
    for item in data:
        if item["id"] == config_id:
            return LLMConfig(**_sanitize_config(item, current_user.is_admin))
    raise HTTPException(status_code=404, detail="LLM configuration not found")

@router.post("/llm", response_model=LLMConfig)
def create_llm_config(config: LLMConfigCreate, _: CurrentUser = Depends(get_admin_user)):
    data = _load_data()
    if any(item["id"] == config.id for item in data):
        raise HTTPException(status_code=400, detail="LLM configuration with this ID already exists")

    new_config = config.dict()
    if new_config.get("is_active"):
        for item in data:
            item["is_active"] = False
    data.append(new_config)
    _save_data(data)
    return LLMConfig(**new_config)

@router.put("/llm/{config_id}", response_model=LLMConfig)
def update_llm_config(config_id: str, config: LLMConfigUpdate, _: CurrentUser = Depends(get_admin_user)):
    data = _load_data()
    for i, item in enumerate(data):
        if item["id"] == config_id:
            updated_item = item.copy()
            update_data = config.dict(exclude_unset=True)
            if update_data.get("is_active"):
                for j in range(len(data)):
                    data[j]["is_active"] = False
            updated_item.update(update_data)
            data[i] = updated_item
            _save_data(data)
            return LLMConfig(**updated_item)
    raise HTTPException(status_code=404, detail="LLM configuration not found")

@router.delete("/llm/{config_id}")
def delete_llm_config(config_id: str, _: CurrentUser = Depends(get_admin_user)):
    data = _load_data()
    initial_len = len(data)
    data = [item for item in data if item["id"] != config_id]
    if len(data) == initial_len:
        raise HTTPException(status_code=404, detail="LLM configuration not found")
    _save_data(data)
    return {"message": "LLM configuration deleted successfully"}

@router.post("/llm/test")
def test_connection(request: TestConnectionRequest, _: CurrentUser = Depends(get_admin_user)):
    try:
        # Use litellm to test connection
        # litellm handles many providers
        kwargs = {
            "model": request.model,
            "messages": [{"role": "user", "content": "Hello"}],
            "max_tokens": 5
        }
        
        if request.api_key:
            kwargs["api_key"] = request.api_key
        
        if request.api_base:
            kwargs["api_base"] = request.api_base
            
        if request.extra_headers:
            kwargs["extra_headers"] = request.extra_headers

        # For OpenAI-compatible endpoints that are not standard OpenAI (like Local, vLLM etc)
        # usually user sets provider to "openai" and api_base to their custom URL.
        # litellm usually works well if we pass custom_llm_provider="openai" if provider is openai but custom url
        
        # If provider is "local" or "openai", we generally use "openai" format
        if request.provider == "local":
            kwargs["custom_llm_provider"] = "openai"
        elif request.provider:
            kwargs["custom_llm_provider"] = request.provider

        # If user explicitly selected provider in UI, we might want to respect that
        # But litellm completion main arg is 'model'. 
        # If the UI 'model' input doesn't have prefix, we might need to add it or pass custom_llm_provider.
        
        # Simple heuristic: if provider is set, try to pass it if litellm supports it or just rely on env vars/args
        # For this simple test, we just try to call it.
        
        try:
            response = completion(**kwargs)
        except Exception as first_error:
            error_text = str(first_error)
            if request.provider and "Provider NOT provided" in error_text and "/" not in request.model:
                retry_kwargs = kwargs.copy()
                retry_kwargs["model"] = f"{request.provider}/{request.model}"
                response = completion(**retry_kwargs)
            else:
                raise first_error
        return {"success": True, "message": "Connection successful", "details": str(response)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")
