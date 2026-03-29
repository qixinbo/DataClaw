from typing import Optional
from pydantic import BaseModel, Field

class EmbeddingModelConfigBase(BaseModel):
    name: str = Field(..., description="Display name for the model configuration")
    provider: str = Field("openai", description="Provider type (e.g. openai)")
    model: str = Field(..., description="Model name (e.g. text-embedding-3-small)")
    api_base: Optional[str] = None
    api_key: Optional[str] = None

class EmbeddingModelConfigCreate(EmbeddingModelConfigBase):
    pass

class EmbeddingModelConfigUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    api_base: Optional[str] = None
    api_key: Optional[str] = None

class EmbeddingModelConfig(EmbeddingModelConfigBase):
    id: str

class EmbeddingModelConnectionTestRequest(BaseModel):
    provider: str = Field("openai")
    model: str = Field(...)
    api_base: Optional[str] = None
    api_key: Optional[str] = None
