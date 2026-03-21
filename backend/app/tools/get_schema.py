import json
import logging
from typing import Any
import asyncio

from nanobot.agent.tools.base import Tool
from app.context import current_data_source, current_file_url, current_progress_callback
from app.connectors.postgres import postgres_connector
from app.connectors.clickhouse import clickhouse_connector
from app.connectors.factory import get_connector
from app.database import SessionLocal
from app.models.datasource import DataSource

# Import schema logic from nl2sql
from app.agent.nl2sql import (
    _get_cached_schema,
    _set_cached_schema,
    _check_connection_with_cache,
    _get_upload_payload
)

logger = logging.getLogger(__name__)

class GetDatabaseSchemaTool(Tool):
    """
    Tool for fetching the database schema directly without SQL generation.
    """

    @property
    def name(self) -> str:
        return "get_database_schema"

    @property
    def description(self) -> str:
        return (
            "Get the structural schema of the currently connected database or data source. "
            "Use this tool when the user asks questions about metadata, such as 'what tables are there', "
            "'show me the database structure', 'what are the columns in table X', etc. "
            "It directly returns the schema without generating SQL."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {},
            "required": [],
        }

    async def execute(self, **kwargs: Any) -> str:
        source = current_data_source.get()
        file_url = current_file_url.get()
        on_progress = current_progress_callback.get()

        async def emit_progress(msg: str):
            if on_progress:
                await on_progress(msg)

        await emit_progress("正在获取数据源结构...")

        connector = None
        schema = {}

        if not source:
            return "Error: No data source connected."

        if source == "postgres":
            connector = postgres_connector
        elif source == "clickhouse":
            connector = clickhouse_connector
        elif source == "upload":
            try:
                payload = await asyncio.to_thread(_get_upload_payload, file_url)
                schema = payload["schema"]
                await emit_progress("文件 Schema 获取完成")
            except Exception as e:
                return f"Failed to get upload schema: {e}"
        elif source.startswith("ds:"):
            try:
                ds_id = int(source.split(":")[1])
                def _get_ds_connector():
                    db = SessionLocal()
                    try:
                        ds = db.query(DataSource).filter(DataSource.id == ds_id).first()
                        if not ds: return None
                        return get_connector(ds)
                    finally:
                        db.close()
                connector = await asyncio.to_thread(_get_ds_connector)
                if not connector:
                    return f"Data source not found: {source}"
            except Exception as e:
                return f"Failed to load data source: {e}"
        else:
            return f"Unsupported data source: {source}"

        if connector:
            cached_schema = _get_cached_schema(source, connector)
            if cached_schema is not None:
                schema = cached_schema
                await emit_progress(f"命中缓存，成功获取 {len(schema)} 张表结构")
            else:
                if not await _check_connection_with_cache(source, connector):
                    return f"Failed to connect to {source}"
                
                try:
                    schema = await asyncio.wait_for(
                        asyncio.to_thread(connector.get_schema),
                        timeout=120.0
                    )
                    _set_cached_schema(source, connector, schema)
                    await emit_progress(f"成功获取 {len(schema)} 张表结构")
                except asyncio.TimeoutError:
                    return "Failed to fetch schema: Timeout after 120 seconds."
                except Exception as e:
                    return f"Failed to fetch schema: {e}"

        # Format the output for the LLM to make it readable and token-efficient
        lines = []
        for table_name, table_info in schema.items():
            if isinstance(table_info, list):
                # Clickhouse/Upload format: [{"name": "col", "type": "type"}]
                cols = ", ".join([f"{c['name']} ({c['type']})" for c in table_info])
                lines.append(f"Table: {table_name}\n  Columns: {cols}")
            elif isinstance(table_info, dict):
                # Postgres format: {"columns": [...], "primary_keys": [...], "foreign_keys": [...]}
                cols = ", ".join([f"{c['name']} ({c['type']})" for c in table_info.get("columns", [])])
                pks = ", ".join(table_info.get("primary_keys", []))
                lines.append(f"Table: {table_name}\n  Columns: {cols}\n  Primary Keys: {pks}")
        
        return "\n\n".join(lines) if lines else "No tables found in schema."
