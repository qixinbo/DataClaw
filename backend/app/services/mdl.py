import json
import os
from pathlib import Path
from typing import Optional, Dict, Any, List
from app.models.datasource import DataSource
from app.schemas.mdl import MDLManifest, Model, Column, TableReference
from app.connectors.factory import get_connector
from app.database import SessionLocal

# Assuming running from backend/ directory
MDL_STORAGE_PATH = Path("data/mdl")

class MDLService:
    @staticmethod
    def _get_mdl_path(datasource_id: int) -> Path:
        MDL_STORAGE_PATH.mkdir(parents=True, exist_ok=True)
        return MDL_STORAGE_PATH / f"{datasource_id}.json"

    @staticmethod
    def get_raw_schema(datasource: DataSource) -> Dict[str, List[Dict[str, str]]]:
        connector = get_connector(datasource)
        try:
            return connector.get_schema()
        except Exception as e:
            print(f"Error fetching schema for DS {datasource.id}: {e}")
            return {}

    @staticmethod
    def generate_default_mdl(
        datasource: DataSource,
        selected_tables: Optional[List[str]] = None,
        selected_columns: Optional[Dict[str, List[str]]] = None,
    ) -> MDLManifest:
        raw_schema = MDLService.get_raw_schema(datasource)
        
        models = []
        for table_name, columns in raw_schema.items():
            if selected_tables is not None and table_name not in selected_tables:
                continue

            model_cols = []
            for col_info in columns:
                if isinstance(col_info, dict):
                    name = col_info.get("name", "UNKNOWN")
                    type_ = col_info.get("type", "UNKNOWN")
                elif isinstance(col_info, str):
                    # Fallback for old string format "name (type)"
                    if "(" in col_info and col_info.endswith(")"):
                        parts = col_info.rsplit(" (", 1)
                        if len(parts) == 2:
                            name = parts[0]
                            type_ = parts[1][:-1]
                        else:
                            name = col_info
                            type_ = "UNKNOWN"
                    else:
                        name = col_info
                        type_ = "UNKNOWN"
                else:
                    name = str(col_info)
                    type_ = "UNKNOWN"

                if selected_columns is not None:
                    allowed = selected_columns.get(table_name, [])
                    if allowed and name not in allowed:
                        continue
                
                model_cols.append(Column(name=name, type=type_))

            if not model_cols:
                continue
            
            models.append(Model(
                name=table_name,
                tableReference=TableReference(table=table_name),
                columns=model_cols
            ))
            
        return MDLManifest(
            catalog="default",
            schema="public", # Default schema, might need adjustment based on datasource config
            dataSource=datasource.type.upper(),
            models=models
        )

    @staticmethod
    def get_mdl(datasource_id: int) -> Optional[MDLManifest]:
        path = MDLService._get_mdl_path(datasource_id)
        if path.exists():
            try:
                with open(path, "r") as f:
                    data = json.load(f)
                # Pydantic v2 compatible
                return MDLManifest.model_validate(data)
            except Exception as e:
                print(f"Error loading MDL for {datasource_id}: {e}")
                return None
        return None

    @staticmethod
    def save_mdl(datasource_id: int, mdl: MDLManifest):
        path = MDLService._get_mdl_path(datasource_id)
        with open(path, "w") as f:
            f.write(mdl.model_dump_json(indent=2, by_alias=True))

    @staticmethod
    def get_or_create_mdl(datasource_id: int) -> MDLManifest:
        mdl = MDLService.get_mdl(datasource_id)
        if mdl:
            return mdl
            
        # Generate new
        db = SessionLocal()
        try:
            ds = db.query(DataSource).filter(DataSource.id == datasource_id).first()
            if not ds:
                raise ValueError(f"DataSource {datasource_id} not found")
            mdl = MDLService.generate_default_mdl(ds)
            MDLService.save_mdl(datasource_id, mdl)
            return mdl
        finally:
            db.close()
