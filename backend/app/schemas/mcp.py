from typing import List, Dict, Optional, Literal
from pydantic import BaseModel, Field

class MCPServerBase(BaseModel):
    name: str
    type: Literal["stdio", "sse", "streamableHttp"]
    command: Optional[str] = None
    args: Optional[List[str]] = Field(default_factory=list)
    env: Optional[Dict[str, str]] = Field(default_factory=dict)
    url: Optional[str] = None
    headers: Optional[Dict[str, str]] = Field(default_factory=dict)
    project_id: int
    status: str = "disconnected"

class MCPServerCreate(MCPServerBase):
    pass

class MCPServerUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[Literal["stdio", "sse", "streamableHttp"]] = None
    command: Optional[str] = None
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    url: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    project_id: Optional[int] = None
    status: Optional[str] = None

class MCPServer(MCPServerBase):
    id: str
