from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


class KnowledgeDocumentBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class KnowledgeDocumentCreate(KnowledgeDocumentBase):
    pass


class KnowledgeDocumentUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, min_length=1)
    metadata: Optional[Dict[str, Any]] = None


class KnowledgeDocument(KnowledgeDocumentBase):
    id: str
    created_at: datetime
    updated_at: datetime


class KnowledgeBaseConfigBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    project_id: Optional[int] = None
    embedding_model: Optional[str] = None
    chunk_size: int = Field(default=512, ge=64, le=4096)
    chunk_overlap: int = Field(default=50, ge=0, le=512)
    top_k: int = Field(default=3, ge=1, le=20)
    is_active: bool = True


class KnowledgeBaseCreate(KnowledgeBaseConfigBase):
    pass


class KnowledgeBaseUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = None
    project_id: Optional[int] = None
    embedding_model: Optional[str] = None
    chunk_size: Optional[int] = Field(None, ge=64, le=4096)
    chunk_overlap: Optional[int] = Field(None, ge=0, le=512)
    top_k: Optional[int] = Field(None, ge=1, le=20)
    is_active: Optional[bool] = None


class KnowledgeBase(KnowledgeBaseConfigBase):
    id: str
    created_at: datetime
    updated_at: datetime
    documents: List[KnowledgeDocument] = Field(default_factory=list)


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: Optional[int] = Field(default=None, ge=1, le=20)


class KnowledgeSearchHit(BaseModel):
    doc_id: str
    title: str
    chunk: str
    score: float
    metadata: Dict[str, Any] = Field(default_factory=dict)


class KnowledgeSearchResponse(BaseModel):
    answer: str
    hits: List[KnowledgeSearchHit] = Field(default_factory=list)


class KnowledgeGlobalConfigUpdate(BaseModel):
    api_base: Optional[str] = None
    api_key: Optional[str] = None
    default_embedding_model: Optional[str] = None

    @field_validator("api_base")
    @classmethod
    def validate_api_base(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if not (normalized.startswith("http://") or normalized.startswith("https://")):
            raise ValueError("api_base must start with http:// or https://")
        return normalized.rstrip("/")

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if len(normalized) > 512:
            raise ValueError("api_key is too long")
        return normalized

    @field_validator("default_embedding_model")
    @classmethod
    def validate_default_embedding_model(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if len(normalized) > 200:
            raise ValueError("default_embedding_model is too long")
        return normalized


class KnowledgeGlobalConfig(BaseModel):
    api_base: Optional[str] = None
    api_key: Optional[str] = None
    api_key_masked: Optional[str] = None
    has_api_key: bool = False
    default_embedding_model: Optional[str] = None


class KnowledgeConnectionTestRequest(BaseModel):
    api_base: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None

    @field_validator("api_base")
    @classmethod
    def validate_test_api_base(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if not (normalized.startswith("http://") or normalized.startswith("https://")):
            raise ValueError("api_base must start with http:// or https://")
        return normalized.rstrip("/")

    @field_validator("api_key", "model_name")
    @classmethod
    def normalize_test_value(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class KnowledgeConnectionTestResponse(BaseModel):
    success: bool
    message: str
    model_name: Optional[str] = None
    embedding_dimension: Optional[int] = None
    resolved_api_base: Optional[str] = None
    available_models: List[str] = Field(default_factory=list)
