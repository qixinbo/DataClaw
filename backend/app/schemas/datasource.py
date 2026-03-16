from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
from datetime import datetime

class DataSourceBase(BaseModel):
    name: str
    type: str  # sqlite, postgres, clickhouse, supabase, parquet
    config: Dict[str, Any]
    project_id: int

class DataSourceCreate(DataSourceBase):
    pass

class DataSourceUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

class DataSource(DataSourceBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DataSourceTestRequest(BaseModel):
    type: str
    config: Dict[str, Any]
