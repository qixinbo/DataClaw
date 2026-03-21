from typing import Dict, Any, Optional
import json
import functools
from app.connectors.postgres import PostgresConnector
from app.connectors.clickhouse import ClickHouseConnector
from app.connectors.parquet import ParquetConnector
from app.connectors.csv import CSVConnector
from app.models.datasource import DataSource
from app.core.files import resolve_upload_file_path

@functools.lru_cache(maxsize=32)
def _get_cached_connector(ds_type: str, config_json: str):
    config = json.loads(config_json)
    
    if ds_type in ["postgres", "postgresql", "supabase"]:
        db_url = config.get("connection_string")
        if not db_url:
            default_port = 6543 if ds_type == "supabase" else 5432
            port = config.get("port") or default_port
            db_url = f"postgresql://{config.get('user')}:{config.get('password')}@{config.get('host')}:{port}/{config.get('database')}"
            
        if ds_type == "supabase" and "?" not in db_url:
            db_url += "?sslmode=require"
        elif ds_type == "supabase" and "sslmode=" not in db_url:
            db_url += "&sslmode=require"
            
        return PostgresConnector(db_url=db_url)
        
    elif ds_type == "sqlite":
        # SQLite uses connection string usually file path
        db_url = config.get("connection_string")
        if not db_url and config.get("file_path"):
             file_path = str(resolve_upload_file_path(config.get("file_path")))
             db_url = f"sqlite:///{file_path}"
        return PostgresConnector(db_url=db_url)

    elif ds_type == "clickhouse":
        return ClickHouseConnector(
            host=config.get("host"),
            port=config.get("port", 9000),
            user=config.get("user", "default"),
            password=config.get("password", ""),
            database=config.get("database", "default")
        )
        
    elif ds_type == "parquet":
        file_path = str(resolve_upload_file_path(config.get("file_path")))
        return ParquetConnector(file_path=file_path)
    
    elif ds_type == "csv":
        file_path = str(resolve_upload_file_path(config.get("file_path")))
        return CSVConnector(file_path=file_path)
        
    else:
        raise ValueError(f"Unsupported data source type: {ds_type}")

def get_connector(datasource: DataSource):
    # Use JSON string of config as cache key
    # Ensure stable ordering of keys
    config_str = json.dumps(datasource.config, sort_keys=True)
    return _get_cached_connector(datasource.type.lower(), config_str)

def get_connector_from_config(ds_type: str, config: Dict[str, Any]):
    # Helper for testing connection without saving to DB
    # We can use the cached function too, or bypass if we want fresh check
    # Usually for testing we want fresh check, so let's bypass cache or clear it if needed.
    # But reusing cache is fine if config is same.
    config_str = json.dumps(config, sort_keys=True)
    return _get_cached_connector(ds_type.lower(), config_str)
