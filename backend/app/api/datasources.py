from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.datasource import DataSource
from app.schemas.datasource import DataSourceCreate, DataSourceUpdate, DataSource as DataSourceSchema, DataSourceTestRequest
from app.core.security import SECRET_KEY, ALGORITHM
from app.connectors.factory import get_connector_from_config
from pydantic import BaseModel

router = APIRouter()
security = HTTPBearer()

class CurrentUser(BaseModel):
    id: int
    username: str
    is_admin: bool = False

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> CurrentUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise unauthorized
    user_id = payload.get("id")
    username = payload.get("sub")
    is_admin = bool(payload.get("is_admin", False))
    if user_id is None or username is None:
        raise unauthorized
    return CurrentUser(id=user_id, username=username, is_admin=is_admin)

def get_admin_user(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")
    return current_user

@router.get("/datasources", response_model=List[DataSourceSchema])
def list_datasources(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    # Admin can see all, regular user might only see allowed ones?
    # For now, let's assume only admin can manage, but maybe regular users can see them to use?
    # The requirement says "Add data source config in Admin User Center", implying management is admin-only.
    # But usage in chat should be available to users.
    # Let's allow read for all authenticated users for now.
    datasources = db.query(DataSource).offset(skip).limit(limit).all()
    
    # Hide sensitive info for non-admins if necessary, but config usually contains secrets.
    # Maybe we should return a sanitized version for regular users?
    # For now, return full config but only to admins? 
    # Or just assume the API is secure.
    # If regular users need to select datasource, they just need ID and Name.
    if not current_user.is_admin:
        # Sanitize config
        sanitized = []
        for ds in datasources:
            ds_dict = DataSourceSchema.from_orm(ds).dict()
            # Remove sensitive fields from config
            if ds_dict.get("config"):
                ds_dict["config"] = {k: v for k, v in ds_dict["config"].items() if k not in ["password", "api_key", "secret"]}
            sanitized.append(ds_dict)
        return sanitized
        
    return datasources

@router.post("/datasources", response_model=DataSourceSchema)
def create_datasource(
    datasource: DataSourceCreate, 
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_admin_user)
):
    db_datasource = DataSource(**datasource.dict())
    db.add(db_datasource)
    db.commit()
    db.refresh(db_datasource)
    return db_datasource

@router.get("/datasources/{datasource_id}", response_model=DataSourceSchema)
def read_datasource(
    datasource_id: int, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    db_datasource = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if db_datasource is None:
        raise HTTPException(status_code=404, detail="Data source not found")
    
    if not current_user.is_admin:
         ds_dict = DataSourceSchema.from_orm(db_datasource).dict()
         if ds_dict.get("config"):
             ds_dict["config"] = {k: v for k, v in ds_dict["config"].items() if k not in ["password", "api_key", "secret"]}
         return ds_dict
         
    return db_datasource

@router.put("/datasources/{datasource_id}", response_model=DataSourceSchema)
def update_datasource(
    datasource_id: int, 
    datasource: DataSourceUpdate, 
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_admin_user)
):
    db_datasource = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if db_datasource is None:
        raise HTTPException(status_code=404, detail="Data source not found")
    
    update_data = datasource.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_datasource, key, value)
    
    db.commit()
    db.refresh(db_datasource)
    return db_datasource

@router.delete("/datasources/{datasource_id}")
def delete_datasource(
    datasource_id: int, 
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_admin_user)
):
    db_datasource = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if db_datasource is None:
        raise HTTPException(status_code=404, detail="Data source not found")
    
    db.delete(db_datasource)
    db.commit()
    return {"ok": True}

@router.post("/datasources/test")
def test_datasource_connection(
    request: DataSourceTestRequest,
    _: CurrentUser = Depends(get_admin_user)
):
    try:
        connector = get_connector_from_config(request.type, request.config)
        if connector.test_connection():
            return {"success": True, "message": "Connection successful"}
        else:
             raise HTTPException(status_code=400, detail="Connection failed")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")
