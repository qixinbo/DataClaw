from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.llm import get_current_user, get_admin_user, CurrentUser
from app.services.web_search_config_store import get_web_search_config, save_web_search_config

router = APIRouter()

class WebSearchConfigModel(BaseModel):
    provider: str = Field(default="duckduckgo", description="Web search provider (brave, tavily, duckduckgo, searxng, jina)")
    api_key: Optional[str] = Field(default="", description="API Key for the provider")
    base_url: Optional[str] = Field(default="", description="Base URL for SearXNG")
    max_results: int = Field(default=5, description="Maximum number of search results")

def _sanitize_config(config: Dict[str, Any], is_admin: bool) -> Dict[str, Any]:
    sanitized = config.copy()
    if not is_admin:
        sanitized["api_key"] = None
    return sanitized

@router.get("/web-search/config", response_model=WebSearchConfigModel)
def get_config(current_user: CurrentUser = Depends(get_current_user)):
    config = get_web_search_config()
    return WebSearchConfigModel(**_sanitize_config(config, current_user.is_admin))

@router.put("/web-search/config", response_model=WebSearchConfigModel)
def update_config(config: WebSearchConfigModel, _: CurrentUser = Depends(get_admin_user)):
    config_dict = config.dict()
    save_web_search_config(config_dict)
    return WebSearchConfigModel(**config_dict)
