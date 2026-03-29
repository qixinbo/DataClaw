import json
import uuid
import asyncio
from typing import List, Optional
from pathlib import Path
from contextlib import AsyncExitStack

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.sse import sse_client

from app.schemas.mcp import MCPServer, MCPServerCreate, MCPServerUpdate
from app.core.data_root import get_data_root

router = APIRouter()

def get_mcp_servers_file() -> Path:
    return get_data_root() / "mcp_servers.json"

def read_mcp_servers() -> List[dict]:
    file_path = get_mcp_servers_file()
    if not file_path.exists():
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return []

def write_mcp_servers(servers: List[dict]) -> None:
    file_path = get_mcp_servers_file()
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(servers, f, indent=2, ensure_ascii=False)

async def _check_single_mcp_health(server: dict) -> str:
    try:
        async with AsyncExitStack() as stack:
            server_type = server.get("type")
            if server_type == "stdio":
                params = StdioServerParameters(
                    command=server.get("command", ""),
                    args=server.get("args", []),
                    env=server.get("env")
                )
                read, write = await stack.enter_async_context(stdio_client(params))
            elif server_type in ["sse", "streamableHttp"]:
                read, write = await stack.enter_async_context(sse_client(server.get("url", "")))
            else:
                return "error: unsupported type"

            session = await stack.enter_async_context(ClientSession(read, write))
            await asyncio.wait_for(session.initialize(), timeout=5.0)
            return "connected"
    except Exception as e:
        err_msg = str(e)
        if "unhandled errors in a TaskGroup" in err_msg:
            return "error: connection refused"
        return f"error: {err_msg or 'unknown'}"

@router.get("/mcp", response_model=List[MCPServer])
async def list_mcp_servers(project_id: Optional[int] = None):
    servers = read_mcp_servers()
    if project_id is not None:
        servers = [s for s in servers if s.get("project_id") == project_id]
        
    if not servers:
        return []
        
    tasks = [_check_single_mcp_health(s) for s in servers]
    statuses = await asyncio.gather(*tasks, return_exceptions=True)
    
    needs_update = False
    for server, status in zip(servers, statuses):
        new_status = status if isinstance(status, str) else f"error: {str(status)}"
        if server.get("status") != new_status:
            server["status"] = new_status
            needs_update = True
            
    if needs_update:
        # Write back to persist the new statuses
        all_servers = read_mcp_servers()
        for s in all_servers:
            for checked_s in servers:
                if s.get("id") == checked_s.get("id"):
                    s["status"] = checked_s["status"]
        write_mcp_servers(all_servers)
        
    return servers

@router.post("/mcp", response_model=MCPServer)
def create_mcp_server(server_in: MCPServerCreate):
    servers = read_mcp_servers()
    
    server_data = server_in.dict()
    server_data["id"] = str(uuid.uuid4())
    if "status" not in server_data or not server_data["status"]:
        server_data["status"] = "disconnected"
        
    servers.append(server_data)
    write_mcp_servers(servers)
    return server_data

@router.get("/mcp/{server_id}", response_model=MCPServer)
def get_mcp_server(server_id: str):
    servers = read_mcp_servers()
    for server in servers:
        if server.get("id") == server_id:
            return server
    raise HTTPException(status_code=404, detail="MCP Server not found")

@router.put("/mcp/{server_id}", response_model=MCPServer)
def update_mcp_server(server_id: str, server_in: MCPServerUpdate):
    servers = read_mcp_servers()
    for i, server in enumerate(servers):
        if server.get("id") == server_id:
            update_data = server_in.dict(exclude_unset=True)
            for key, value in update_data.items():
                server[key] = value
            servers[i] = server
            write_mcp_servers(servers)
            return server
    raise HTTPException(status_code=404, detail="MCP Server not found")

@router.delete("/mcp/{server_id}")
def delete_mcp_server(server_id: str):
    servers = read_mcp_servers()
    filtered_servers = [s for s in servers if s.get("id") != server_id]
    
    if len(servers) == len(filtered_servers):
        raise HTTPException(status_code=404, detail="MCP Server not found")
        
    write_mcp_servers(filtered_servers)
    return {"status": "success"}
