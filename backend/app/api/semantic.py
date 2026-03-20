from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from app.database import get_db
from app.models.datasource import DataSource
from app.schemas.mdl import MDLManifest
from app.services.mdl import MDLService
from app.connectors.factory import get_connector

router = APIRouter(tags=["semantic"])

class GenerateMDLRequest(BaseModel):
    selected_tables: Optional[List[str]] = None
    selected_columns: Optional[Dict[str, List[str]]] = None

class ModelDetailResponse(BaseModel):
    model: Dict[str, Any]
    relationships: List[Dict[str, Any]]
    preview_rows: List[Dict[str, Any]]

def _normalize_query_result(results: Any) -> List[Dict[str, Any]]:
    if isinstance(results, list):
        if results and isinstance(results[0], dict):
            return results
        if results and isinstance(results[0], (list, tuple)):
            return [dict(enumerate(row)) for row in results]
        return []
    if isinstance(results, tuple) and len(results) == 2:
        rows, cols = results
        col_names = [c[0] for c in cols]
        return [dict(zip(col_names, row)) for row in rows]
    return []

@router.get("/semantic/{datasource_id}/schema", response_model=Dict[str, List[Dict[str, str]]])
def get_semantic_schema(datasource_id: int, db: Session = Depends(get_db)):
    # Check if datasource exists
    ds = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="DataSource not found")
    
    try:
        raw_schema = MDLService.get_raw_schema(ds)
        result = {}
        for table, data in raw_schema.items():
            if isinstance(data, dict) and "columns" in data:
                result[table] = data["columns"]
            elif isinstance(data, list):
                result[table] = data
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/semantic/{datasource_id}", response_model=MDLManifest)
def get_semantic_model(datasource_id: int, db: Session = Depends(get_db)):
    # Check if datasource exists
    ds = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="DataSource not found")
    
    # Get or generate MDL
    try:
        mdl = MDLService.get_or_create_mdl(datasource_id)
        return mdl
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/semantic/{datasource_id}", response_model=MDLManifest)
def update_semantic_model(datasource_id: int, mdl: MDLManifest, db: Session = Depends(get_db)):
    # Check if datasource exists
    ds = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="DataSource not found")
    
    try:
        MDLService.save_mdl(datasource_id, mdl)
        return mdl
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/semantic/{datasource_id}/generate", response_model=MDLManifest)
def regenerate_semantic_model(datasource_id: int, request: Optional[GenerateMDLRequest] = None, db: Session = Depends(get_db)):
    ds = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="DataSource not found")
    
    try:
        selected_tables = request.selected_tables if request else None
        selected_columns = request.selected_columns if request else None
        mdl = MDLService.generate_default_mdl(
            ds,
            selected_tables=selected_tables,
            selected_columns=selected_columns,
        )
        MDLService.save_mdl(datasource_id, mdl)
        return mdl
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/semantic/{datasource_id}/models/{model_name}", response_model=ModelDetailResponse)
def get_model_detail(datasource_id: int, model_name: str, limit: int = 10, db: Session = Depends(get_db)):
    ds = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="DataSource not found")

    mdl = MDLService.get_or_create_mdl(datasource_id)
    model = next((m for m in mdl.models if m.name == model_name), None)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    relationships = [
        {
            "name": rel.name,
            "models": rel.models,
            "joinType": rel.joinType,
            "condition": rel.condition,
            "properties": rel.properties,
        }
        for rel in mdl.relationships
        if model_name in rel.models
    ]

    preview_rows: List[Dict[str, Any]] = []
    try:
        connector = get_connector(ds)
        table_name = model.tableReference.table if model.tableReference else model.name
        query = f'SELECT * FROM "{table_name}" LIMIT {max(1, min(limit, 100))}'
        raw = connector.execute_query(query)
        preview_rows = _normalize_query_result(raw)
    except Exception:
        preview_rows = []

    model_payload = {
        "name": model.name,
        "tableReference": model.tableReference.model_dump(by_alias=True) if model.tableReference else None,
        "primaryKey": model.primaryKey,
        "properties": model.properties,
        "columns": [c.model_dump(by_alias=True) for c in model.columns],
    }

    return ModelDetailResponse(
        model=model_payload,
        relationships=relationships,
        preview_rows=preview_rows,
    )
