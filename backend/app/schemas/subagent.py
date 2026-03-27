from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class SubagentBase(BaseModel):
    name: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    model: Optional[str] = None

class SubagentCreate(SubagentBase):
    pass

class SubagentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    model: Optional[str] = None

class Subagent(SubagentBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
