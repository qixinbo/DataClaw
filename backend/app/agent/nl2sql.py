import asyncio
import sys
import os
import json
import time
import threading
import logging
from pathlib import Path
from typing import List, Optional, Dict, Any, Callable, Awaitable
from pydantic import BaseModel, Field
import duckdb
import pandas as pd

logger = logging.getLogger(__name__)

# Add project root to sys.path to allow importing nanobot
PROJECT_ROOT = Path(__file__).resolve().parents[3]
NANOBOT_ROOT = PROJECT_ROOT / "nanobot"
if str(NANOBOT_ROOT) not in sys.path:
    sys.path.append(str(NANOBOT_ROOT))

from app.core.llm_provider import build_llm_provider
from app.connectors.postgres import postgres_connector
from app.connectors.clickhouse import clickhouse_connector
from app.connectors.factory import get_connector
from app.schemas.chart import ChartGenerationResponse
from app.agent.chart import generate_chart
from app.database import SessionLocal
from app.models.datasource import DataSource
from app.core.files import resolve_upload_file_path
from app.services.mdl import MDLService
from app.services.llm_cache import get_active_llm_config
from app.trace import trace_service

SCHEMA_CACHE_TTL_SECONDS = 300
CONNECTION_CACHE_TTL_SECONDS = 30
UPLOAD_CACHE_TTL_SECONDS = 900
MAX_UPLOAD_CACHE_ITEMS = 8
NL2SQL_MAX_TOKENS = 900
NL2SQL_TEMPERATURE = 0.1
NL2SQL_REASONING_EFFORT = "low"
NL2SQL_LLM_TIMEOUT_SECONDS = int(os.getenv("NL2SQL_LLM_TIMEOUT_SECONDS", "90"))
NL2SQL_LLM_REQUEST_TIMEOUT_SECONDS = int(os.getenv("NL2SQL_LLM_REQUEST_TIMEOUT_SECONDS", "45"))
NL2SQL_LLM_RETRY_COUNT = int(os.getenv("NL2SQL_LLM_RETRY_COUNT", "0"))
NL2SQL_SQL_EXEC_TIMEOUT_SECONDS = 60
NL2SQL_CHART_TIMEOUT_SECONDS = int(os.getenv("NL2SQL_CHART_TIMEOUT_SECONDS", "45"))

_schema_cache: Dict[str, Dict[str, Any]] = {}
_connection_cache: Dict[str, Dict[str, Any]] = {}
_upload_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = threading.Lock()

class NL2SQLRequest(BaseModel):
    query: str = Field(..., description="User's natural language query")
    source: str = Field(..., description="Data source to query (postgres, clickhouse, upload, ds:{id})")
    file_url: Optional[str] = Field(None, description="Uploaded file URL when source is upload")
    session_id: Optional[str] = Field(None, description="Conversation session identifier")
    generate_chart: bool = Field(False, description="Whether to generate chart specification")

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

Given user's question and database schema, generate accurate ANSI SQL directly and concisely.

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

def _resolve_upload_file_path(file_url: Optional[str]) -> Path:
    try:
        return resolve_upload_file_path(file_url)
    except ValueError as e:
        raise ValueError(f"Invalid uploaded file URL: {e}")

def _load_upload_dataframe_from_path(file_path: Path) -> pd.DataFrame:
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(file_path)
    if suffix in [".xls", ".xlsx"]:
        return pd.read_excel(file_path)
    if suffix == ".parquet":
        return pd.read_parquet(file_path)
    raise ValueError(f"Unsupported uploaded file type: {suffix}")

def _build_upload_schema(df: pd.DataFrame) -> Dict[str, List[Dict[str, str]]]:
    conn = duckdb.connect(":memory:")
    conn.register("uploaded_file", df)
    columns = conn.execute("DESCRIBE uploaded_file").fetchall()
    schema = {"uploaded_file": [{"name": col[0], "type": col[1]} for col in columns]}
    conn.close()
    return schema

def _get_upload_payload(file_url: Optional[str]) -> Dict[str, Any]:
    file_path = _resolve_upload_file_path(file_url)
    stat = file_path.stat()
    cache_key = f"{file_path}:{int(stat.st_mtime)}:{stat.st_size}"
    now = time.time()
    with _cache_lock:
        cached = _upload_cache.get(cache_key)
        if cached and now < cached["expires_at"]:
            return {"df": cached["df"], "schema": cached["schema"]}
    df = _load_upload_dataframe_from_path(file_path)
    schema = _build_upload_schema(df)
    with _cache_lock:
        if len(_upload_cache) >= MAX_UPLOAD_CACHE_ITEMS:
            oldest_key = min(_upload_cache.keys(), key=lambda key: _upload_cache[key]["expires_at"])
            _upload_cache.pop(oldest_key, None)
        _upload_cache[cache_key] = {
            "df": df,
            "schema": schema,
            "expires_at": now + UPLOAD_CACHE_TTL_SECONDS,
        }
    return {"df": df, "schema": schema}

def _execute_upload_sql(sql_query: str, df: pd.DataFrame) -> List[Dict[str, Any]]:
    conn = duckdb.connect(":memory:")
    conn.register("uploaded_file", df)
    result_df = conn.execute(sql_query).df()
    conn.close()
    return result_df.to_dict(orient="records")

def _to_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None

# _build_fallback_chart removed as per user request to not hardcode fallbacks

def _build_schema_cache_key(source: str, connector: Any) -> str:
    # If source is ds:ID, that's already a good key
    if source.startswith("ds:"):
        return source
        
    if source == "postgres":
        return f"postgres:{getattr(connector, 'db_url', '')}"
    if source == "clickhouse":
        return (
            f"clickhouse:{getattr(connector, 'host', '')}:{getattr(connector, 'port', '')}:"
            f"{getattr(connector, 'user', '')}:{getattr(connector, 'database', '')}"
        )
    return source

def _get_cached_schema(source: str, connector: Any) -> Optional[Dict[str, List[Dict[str, str]]]]:
    key = _build_schema_cache_key(source, connector)
    now = time.time()
    with _cache_lock:
        cached = _schema_cache.get(key)
        if cached and now < cached["expires_at"]:
            return cached["schema"]
    return None

def _set_cached_schema(source: str, connector: Any, schema: Dict[str, List[Dict[str, str]]]) -> None:
    key = _build_schema_cache_key(source, connector)
    with _cache_lock:
        _schema_cache[key] = {"schema": schema, "expires_at": time.time() + SCHEMA_CACHE_TTL_SECONDS}

async def _check_connection_with_cache(source: str, connector: Any) -> bool:
    cache_key = _build_schema_cache_key(source, connector)
    now = time.time()
    with _cache_lock:
        cached = _connection_cache.get(cache_key)
        if cached and now < cached["expires_at"]:
            return bool(cached["ok"])
    
    # Run synchronous test_connection in a separate thread to avoid blocking event loop
    try:
        ok = await asyncio.wait_for(
            asyncio.to_thread(connector.test_connection),
            timeout=15.0
        )
    except asyncio.TimeoutError:
        print("Connection test failed or timed out: Timeout after 15 seconds")
        ok = False
    except Exception as e:
        print(f"Connection test failed or timed out: {e}")
        ok = False
    
    with _cache_lock:
        _connection_cache[cache_key] = {"ok": ok, "expires_at": now + CONNECTION_CACHE_TTL_SECONDS}
    return ok

async def process_nl2sql(
    request: NL2SQLRequest,
    on_progress: Callable[[str], Awaitable[None]] | None = None,
) -> NL2SQLResponse:
    async def emit_progress(content: str) -> None:
        if on_progress and content:
            await on_progress(content)

    total_started = time.perf_counter()
    trace_base_attributes = {
        "component": "nl2sql",
        "source": request.source,
        "session_id": request.session_id,
        "generate_chart": request.generate_chart,
    }
    # 1. Get the connector and schema
    connector = None
    schema = {}
    upload_df: Optional[pd.DataFrame] = None
    
    if request.source == "postgres":
        connector = postgres_connector
    elif request.source == "clickhouse":
        connector = clickhouse_connector
    elif request.source == "upload":
        try:
            upload_started = time.perf_counter()
            upload_payload = await asyncio.to_thread(_get_upload_payload, request.file_url)
            upload_df = upload_payload["df"]
            schema = upload_payload["schema"]
            await emit_progress(f"上传文件加载完成 ({time.perf_counter() - upload_started:.2f}s)")
        except Exception as e:
            return NL2SQLResponse(sql="", result=[], error=f"Failed to load uploaded file: {e}")
    elif request.source.startswith("ds:"):
        try:
            ds_started = time.perf_counter()
            ds_id = int(request.source.split(":")[1])
            
            def _get_ds_connector():
                db = SessionLocal()
                try:
                    ds = db.query(DataSource).filter(DataSource.id == ds_id).first()
                    if not ds:
                        return None
                    return get_connector(ds)
                finally:
                    db.close()
            
            connector = await asyncio.to_thread(_get_ds_connector)
            if not connector:
                return NL2SQLResponse(sql="", result=[], error=f"Data source not found: {request.source}")
                
            await emit_progress(f"数据源配置读取完成 ({time.perf_counter() - ds_started:.2f}s)")
        except ValueError:
             return NL2SQLResponse(sql="", result=[], error=f"Invalid data source ID: {request.source}")
        except Exception as e:
             return NL2SQLResponse(sql="", result=[], error=f"Failed to load data source: {e}")
    else:
        return NL2SQLResponse(sql="", result=[], error=f"Unsupported data source: {request.source}")

    if connector:
        await emit_progress("正在检测数据源连通性")
        cached_schema = _get_cached_schema(request.source, connector)
        if cached_schema is not None:
            schema = cached_schema
            await emit_progress(f"命中 Schema 缓存，已加载 {len(schema)} 张表")
        else:
            conn_started = time.perf_counter()
            if not await _check_connection_with_cache(request.source, connector):
                return NL2SQLResponse(sql="", result=[], error=f"Failed to connect to {request.source}")
            await emit_progress(f"连接检测完成 ({time.perf_counter() - conn_started:.2f}s)")
            schema_started = time.perf_counter()
            try:
                schema = await asyncio.wait_for(
                    asyncio.to_thread(connector.get_schema),
                    timeout=120.0
                )
            except asyncio.TimeoutError:
                return NL2SQLResponse(sql="", result=[], error="Failed to fetch schema: Timeout after 120 seconds. Data source might be too large or network is slow.")
            except Exception as e:
                return NL2SQLResponse(sql="", result=[], error=f"Failed to fetch schema: {e}")
            
            _set_cached_schema(request.source, connector, schema)
            await emit_progress(f"Schema 拉取完成，共 {len(schema)} 张表 ({time.perf_counter() - schema_started:.2f}s)")
         
    schema_str = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))

    # Try to load MDL context
    mdl_context = ""
    if request.source.startswith("ds:"):
        try:
            ds_id = int(request.source.split(":")[1])
            mdl = await asyncio.to_thread(MDLService.get_mdl, ds_id)
            if mdl:
                mdl_lines = ["\n### SEMANTIC MODEL (WrenMDL) ###"]
                
                mdl_lines.append("MODELS:")
                for model in mdl.models:
                    table_ref = model.tableReference.table if model.tableReference else model.name
                    desc = f" - Description: {model.properties.get('description', '')}" if model.properties.get('description') else ""
                    mdl_lines.append(f"- Model: {model.name} (Table: {table_ref}){desc}")
                    
                    if model.columns:
                        mdl_lines.append("  Columns:")
                        for col in model.columns:
                            col_desc = f" ({col.properties.get('description')})" if col.properties.get('description') else ""
                            expr = f" [Calculated: {col.expression}]" if col.isCalculated else ""
                            mdl_lines.append(f"    - {col.name} ({col.type}){col_desc}{expr}")
                
                if mdl.relationships:
                    mdl_lines.append("\nRELATIONSHIPS:")
                    for rel in mdl.relationships:
                        mdl_lines.append(f"- {rel.name}: {rel.joinType} between {rel.models} ON {rel.condition}")
                
                mdl_context = "\n".join(mdl_lines)
        except Exception as e:
            print(f"Failed to load MDL: {e}")

    # 2. Get the active LLM config
    active_config = get_active_llm_config()
    
    if not active_config:
        return NL2SQLResponse(sql="", result=[], error="No active LLM configuration found")

    # 3. Initialize Provider
    try:
        provider = build_llm_provider(
            model=active_config.get("model"),
            provider=active_config.get("provider"),
            api_key=active_config.get("api_key"),
            api_base=active_config.get("api_base"),
            extra_headers=active_config.get("extra_headers") or {},
        )
    except Exception as e:
        return NL2SQLResponse(sql="", result=[], error=f"Failed to initialize LLM provider: {e}")

    # 4. Construct Prompt
    user_prompt = f"""
### DATABASE SCHEMA ###
{schema_str}
{mdl_context}

### INPUTS ###
User's Question: {request.query}
Language: Chinese (Simplified)
"""

    messages = [
        {"role": "system", "content": SQL_GENERATION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    # 5. Call LLM & 6. Execute SQL (with Self-Correction Loop)
    MAX_SQL_EXEC_RETRIES = int(os.getenv("NL2SQL_MAX_EXEC_RETRIES", "2"))
    sql_query = ""
    formatted_results = []
    chart_response = None
    timeout_stage = "llm_generation"

    for exec_attempt in range(MAX_SQL_EXEC_RETRIES + 1):
        try:
            llm_started = time.perf_counter()
            if exec_attempt == 0:
                await emit_progress("正在生成 SQL")
            else:
                await emit_progress(f"正在尝试修复 SQL ({exec_attempt}/{MAX_SQL_EXEC_RETRIES})")
                
            response = None
            last_error = ""

            for attempt in range(NL2SQL_LLM_RETRY_COUNT + 1):
                try:
                    with trace_service.start_span(
                        "nl2sql.llm_generation",
                        attributes={
                            **trace_base_attributes,
                            "exec_attempt": exec_attempt,
                            "retry_attempt": attempt,
                            "model": active_config.get("model"),
                        },
                    ) as llm_span:
                        response = await asyncio.wait_for(
                            provider.chat(
                                messages=messages,
                                max_tokens=NL2SQL_MAX_TOKENS,
                                temperature=NL2SQL_TEMPERATURE,
                                reasoning_effort=NL2SQL_REASONING_EFFORT,
                            ),
                            timeout=NL2SQL_LLM_TIMEOUT_SECONDS,
                        )
                        llm_span.update(output={"finish_reason": getattr(response, "finish_reason", None)})
                except asyncio.TimeoutError:
                    last_error = f"LLM generation timeout after {NL2SQL_LLM_TIMEOUT_SECONDS}s"
                    if attempt < NL2SQL_LLM_RETRY_COUNT:
                        await emit_progress(f"SQL 生成超时，正在重试 ({attempt + 1}/{NL2SQL_LLM_RETRY_COUNT})")
                        continue
                    return NL2SQLResponse(sql=sql_query, result=[], error=last_error)
                except Exception as e:
                    last_error = f"LLM generation failed: {e}"
                    if attempt < NL2SQL_LLM_RETRY_COUNT:
                        await emit_progress(f"SQL 生成失败，正在重试 ({attempt + 1}/{NL2SQL_LLM_RETRY_COUNT})")
                        continue
                    return NL2SQLResponse(sql=sql_query, result=[], error=last_error)

                if response.finish_reason == "error":
                    last_error = response.content or "LLM Error"
                    if attempt < NL2SQL_LLM_RETRY_COUNT:
                        await emit_progress(f"模型返回错误，正在重试 ({attempt + 1}/{NL2SQL_LLM_RETRY_COUNT})")
                        continue
                    return NL2SQLResponse(sql=sql_query, result=[], error=last_error)
                break

            if response is None:
                return NL2SQLResponse(sql=sql_query, result=[], error=last_error or "LLM generation failed")

            content = (response.content or "").strip()
            if not content:
                return NL2SQLResponse(sql=sql_query, result=[], error="LLM returned empty response")

            # Clean up code blocks
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            content = content.strip()

            try:
                result_json = json.loads(content)
                sql_query = result_json.get("sql", "").strip()
            except json.JSONDecodeError:
                # Fallback if LLM doesn't return valid JSON despite instructions
                sql_query = content
                
            logger.info(f"Generated SQL for query '{request.query}':\n{sql_query}")
            
            # 格式化单行 SQL 用于在前端进度中展示
            formatted_sql = sql_query.replace('\n', ' ')
            if len(formatted_sql) > 150:
                formatted_sql = formatted_sql[:147] + "..."
            await emit_progress(f"SQL 生成完成: {formatted_sql}")

        except Exception as e:
            return NL2SQLResponse(sql=sql_query, result=[], error=f"LLM generation failed: {e}")

        # 6. Execute SQL
        try:
            timeout_stage = "sql_execution"
            sql_exec_started = time.perf_counter()
            await emit_progress("正在执行 SQL 查询")
            with trace_service.start_span(
                "nl2sql.sql_execution",
                attributes={
                    **trace_base_attributes,
                    "exec_attempt": exec_attempt,
                },
                input_payload={"sql": sql_query},
            ) as sql_span:
                if request.source == "upload":
                    if upload_df is None:
                        upload_payload = await asyncio.to_thread(_get_upload_payload, request.file_url)
                        upload_df = upload_payload["df"]
                    formatted_results = await asyncio.wait_for(
                        asyncio.to_thread(_execute_upload_sql, sql_query, upload_df),
                        timeout=NL2SQL_SQL_EXEC_TIMEOUT_SECONDS,
                    )
                else:
                    results = await asyncio.wait_for(
                        asyncio.to_thread(connector.execute_query, sql_query),
                        timeout=NL2SQL_SQL_EXEC_TIMEOUT_SECONDS,
                    )
                    formatted_results = []
                    if isinstance(results, list):
                        if results and isinstance(results[0], dict):
                            formatted_results = results
                        elif results and isinstance(results[0], (list, tuple)):
                            formatted_results = [list(row) for row in results]
                        else:
                            formatted_results = results
                    elif isinstance(results, tuple) and len(results) == 2:
                        rows, cols = results
                        col_names = [c[0] for c in cols]
                        formatted_results = [dict(zip(col_names, row)) for row in rows]
                    else:
                        formatted_results = []
                sql_span.set_attributes({"result_rows": len(formatted_results)})
                     
            await emit_progress(f"SQL 执行完成，返回 {len(formatted_results)} 行 ({time.perf_counter() - sql_exec_started:.2f}s)")
            break # Execution succeeded, break the retry loop

        except asyncio.TimeoutError:
            return NL2SQLResponse(sql=sql_query, result=[], error=f"SQL execution timeout after {NL2SQL_SQL_EXEC_TIMEOUT_SECONDS}s")
        except Exception as e:
            if exec_attempt < MAX_SQL_EXEC_RETRIES:
                await emit_progress(f"SQL 执行失败，准备自动修复 ({exec_attempt + 1}/{MAX_SQL_EXEC_RETRIES})")
                messages.append({"role": "assistant", "content": f"```json\n{{\"sql\": \"{sql_query}\"}}\n```"})
                messages.append({
                    "role": "user", 
                    "content": f"The generated SQL failed to execute. Database error:\n{str(e)}\n\nPlease fix the SQL query to resolve this error and provide the corrected version following the exact same JSON format."
                })
                continue
            else:
                return NL2SQLResponse(sql=sql_query, result=[], error=f"SQL execution failed after {MAX_SQL_EXEC_RETRIES} retries: {e}")

    # 7. Generate Chart
    if request.generate_chart and formatted_results:
        try:
            chart_started = time.perf_counter()
            await emit_progress("正在生成可视化方案")
            timeout_stage = "chart_generation"
            with trace_service.start_span(
                "nl2sql.chart_generation",
                attributes=trace_base_attributes,
                input_payload={"query": request.query, "rows": len(formatted_results)},
            ) as chart_span:
                chart_response = await asyncio.wait_for(
                    generate_chart(formatted_results, request.query),
                    timeout=NL2SQL_CHART_TIMEOUT_SECONDS,
                )
                chart_span.set_attributes(
                    {
                        "chart.can_visualize": bool(getattr(chart_response, "can_visualize", False)),
                        "chart.type": getattr(chart_response, "chart_type", ""),
                    }
                )
            await emit_progress(f"可视化方案生成完成 ({time.perf_counter() - chart_started:.2f}s)")
        except asyncio.TimeoutError:
            fallback_chart = ChartGenerationResponse(
                reasoning=f"Chart generation timeout after {NL2SQL_CHART_TIMEOUT_SECONDS}s",
                chart_type="",
                can_visualize=False,
                chart_spec=None,
            )
            return NL2SQLResponse(sql=sql_query, result=formatted_results, chart=fallback_chart)
        except Exception as e:
            pass # Ignore chart generation errors, return data only

    with trace_service.start_span(
        "nl2sql.completed",
        attributes={
            **trace_base_attributes,
            "total_seconds": round(time.perf_counter() - total_started, 4),
            "result_rows": len(formatted_results),
            "has_chart": bool(chart_response),
        },
    ):
        pass
    await emit_progress(f"NL2SQL 总耗时 {time.perf_counter() - total_started:.2f}s")
    return NL2SQLResponse(sql=sql_query, result=formatted_results, chart=chart_response)
