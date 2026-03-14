import sys
import os
import json
from pathlib import Path
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

# Add project root to sys.path to allow importing nanobot
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from nanobot.providers.litellm_provider import LiteLLMProvider
from app.connectors.postgres import postgres_connector
from app.connectors.clickhouse import clickhouse_connector
from app.api.llm import _load_data as load_llm_config

class NL2SQLRequest(BaseModel):
    query: str = Field(..., description="User's natural language query")
    source: str = Field(..., description="Data source to query (postgres, clickhouse)")

class NL2SQLResponse(BaseModel):
    sql: str
    result: List[Dict[str, Any]]
    error: Optional[str] = None

async def process_nl2sql(request: NL2SQLRequest) -> NL2SQLResponse:
    # 1. Get the connector and schema
    connector = None
    if request.source == "postgres":
        connector = postgres_connector
    elif request.source == "clickhouse":
        connector = clickhouse_connector
    else:
        return NL2SQLResponse(sql="", result=[], error=f"Unsupported data source: {request.source}")

    if not connector.test_connection():
         return NL2SQLResponse(sql="", result=[], error=f"Failed to connect to {request.source}")

    schema = connector.get_schema()
    schema_str = json.dumps(schema, indent=2)

    # 2. Get the active LLM config
    llm_configs = load_llm_config()
    active_config = next((c for c in llm_configs if c.get("is_active")), None)
    
    if not active_config:
        return NL2SQLResponse(sql="", result=[], error="No active LLM configuration found")

    # 3. Initialize Provider
    try:
        provider = LiteLLMProvider(
            api_key=active_config.get("api_key"),
            api_base=active_config.get("api_base"),
            default_model=active_config.get("model"),
            extra_headers=active_config.get("extra_headers")
        )
    except Exception as e:
        return NL2SQLResponse(sql="", result=[], error=f"Failed to initialize LLM provider: {e}")

    # 4. Construct Prompt
    prompt = f"""You are an expert SQL generator. 
Given the following database schema for a {request.source} database:
{schema_str}

Write a SQL query to answer the following question:
"{request.query}"

Return ONLY the SQL query. Do not include any markdown formatting, explanations, or code blocks. Just the raw SQL string.
"""

    # 5. Call LLM
    try:
        # provider.complete returns a string
        response = await provider.complete(prompt)
        sql_query = response.strip()
        # Remove potential markdown code blocks if the LLM ignores instructions
        if sql_query.startswith("```sql"):
            sql_query = sql_query[6:]
        if sql_query.startswith("```"):
            sql_query = sql_query[3:]
        if sql_query.endswith("```"):
            sql_query = sql_query[:-3]
        sql_query = sql_query.strip()
    except Exception as e:
        return NL2SQLResponse(sql="", result=[], error=f"LLM generation failed: {e}")

    # 6. Execute SQL
    try:
        results = connector.execute_query(sql_query)
        # Convert results to list of dicts if not already (Postgres returns list of dicts, ClickHouse returns list of tuples)
        formatted_results = []
        if request.source == "postgres":
             formatted_results = results
        elif request.source == "clickhouse":
            # ClickHouse returns list of tuples, we need column names
            # But execute_query in ClickHouseConnector just returns raw results from client.execute
            # client.execute(query, with_column_types=True) might be better but let's stick to simple for now
            # Actually, without column names it's hard to format as dict.
            # Let's assume we can just return the raw tuples for now or try to fetch column names.
            # For now, let's just return as list of lists/tuples if it's not a dict
            formatted_results = [list(row) for row in results]

        return NL2SQLResponse(sql=sql_query, result=formatted_results)
    except Exception as e:
        return NL2SQLResponse(sql=sql_query, result=[], error=f"SQL execution failed: {e}")
