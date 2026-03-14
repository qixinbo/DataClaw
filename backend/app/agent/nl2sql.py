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
from app.schemas.chart import ChartGenerationResponse
from app.agent.chart import generate_chart

class NL2SQLRequest(BaseModel):
    query: str = Field(..., description="User's natural language query")
    source: str = Field(..., description="Data source to query (postgres, clickhouse)")

class NL2SQLResponse(BaseModel):
    sql: str
    result: List[Dict[str, Any]]
    error: Optional[str] = None
    chart: Optional[ChartGenerationResponse] = None

# WrenAI-inspired SQL Rules
DEFAULT_TEXT_TO_SQL_RULES = """
### SQL RULES ###
- ONLY USE SELECT statements, NO DELETE, UPDATE OR INSERT etc. statements that might change the data in the database.
- ONLY USE the tables and columns mentioned in the database schema.
- ONLY USE "*" if the user query asks for all the columns of a table.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- DON'T INCLUDE comments in the generated SQL query.
- YOU MUST USE "JOIN" if you choose columns from multiple tables!
- PREFER USING CTEs over subqueries.
- When generating SQL query, always:
    - Put double quotes around column and table names.
    - Put single quotes around string literals.
    - Never quote numeric literals.
    For example: SELECT "customers"."customer_name" FROM "customers" WHERE "customers"."city" = 'Taipei' and "customers"."year" = 1992;
- YOU MUST USE "lower(<table_name>.<column_name>) like lower(<value>)" function or "lower(<table_name>.<column_name>) = lower(<value>)" function for case-insensitive comparison!
    - Use "lower(<table_name>.<column_name>) LIKE lower(<value>)" when:
        - The user requests a pattern or partial match.
        - The value is not specific enough to be a single, exact value.
        - Wildcards (%) are needed to capture the pattern.
    - Use "lower(<table_name>.<column_name>) = lower(<value>)" when:
        - The user requests an exact, specific value.
        - There is no ambiguity or pattern in the value.
- If the column is date/time related field, and it is a INT/BIGINT/DOUBLE/FLOAT type, please use the appropriate function mentioned in the SQL FUNCTIONS section to cast the column to "TIMESTAMP" type first before using it in the query
- ALWAYS CAST the date/time related field to "TIMESTAMP WITH TIME ZONE" type when using them in the query
- If the user asks for a specific date, please give the date range in SQL query
- Aggregate functions are not allowed in the WHERE clause. Instead, they belong in the HAVING clause, which is used to filter after aggregation.
- You can only add "ORDER BY" and "LIMIT" to the final "UNION" result.
- For the ranking problem, you must use the ranking function, `DENSE_RANK()` to rank the results and then use `WHERE` clause to filter the results.
- For the ranking problem, you must add the ranking column to the final SELECT clause.
"""

SQL_GENERATION_SYSTEM_PROMPT = f"""
You are a helpful assistant that converts natural language queries into ANSI SQL queries.

Given user's question, database schema, etc., you should think deeply and carefully and generate the SQL query based on the given reasoning plan step by step.

### GENERAL RULES ###

1. YOU MUST FOLLOW the instructions strictly to generate the SQL query if the section of USER INSTRUCTIONS is available in user's input.
2. YOU MUST FOLLOW SQL Rules if they are not contradicted with instructions.

{DEFAULT_TEXT_TO_SQL_RULES}

### FINAL ANSWER FORMAT ###
The final answer must be a ANSI SQL query in JSON format:

{{
    "reasoning": <STEP_BY_STEP_REASONING_PLAN>,
    "sql": <SQL_QUERY_STRING>
}}
"""

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
            extra_headers=active_config.get("extra_headers") or {},
            provider_name=active_config.get("provider")
        )
    except Exception as e:
        return NL2SQLResponse(sql="", result=[], error=f"Failed to initialize LLM provider: {e}")

    # 4. Construct Prompt
    user_prompt = f"""
### DATABASE SCHEMA ###
{schema_str}

### INPUTS ###
User's Question: {request.query}
Language: Chinese (Simplified)

Let's think step by step.
"""

    messages = [
        {"role": "system", "content": SQL_GENERATION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    # 5. Call LLM
    try:
        response = await provider.chat(messages=messages)
        content = response.content.strip()
        
        # Clean up code blocks
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        content = content.strip()
        
        try:
            result_json = json.loads(content)
            sql_query = result_json.get("sql", "").strip()
            reasoning = result_json.get("reasoning", "") # We can log this or return it if needed
        except json.JSONDecodeError:
            # Fallback if LLM doesn't return valid JSON despite instructions
            sql_query = content
            
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
        
        # 7. Generate Chart
        chart_response = None
        if formatted_results:
             # Only try to generate chart if we have results
             # Convert to list of dicts if possible, or pass as is
             chart_response = await generate_chart(formatted_results, request.query)

        return NL2SQLResponse(sql=sql_query, result=formatted_results, chart=chart_response)
    except Exception as e:
        return NL2SQLResponse(sql=sql_query, result=[], error=f"SQL execution failed: {e}")
