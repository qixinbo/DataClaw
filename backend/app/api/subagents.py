from typing import List
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.subagent import Subagent
from app.models.project import Project
from app.schemas.subagent import SubagentCreate, SubagentUpdate, Subagent as SubagentSchema
from app.core.security import get_current_user, CurrentUser

router = APIRouter()

@router.get("/projects/{project_id}/subagents", response_model=List[SubagentSchema])
def list_subagents(
    project_id: int,
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if not current_user.is_admin and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    subagents = db.query(Subagent).filter(Subagent.project_id == project_id).offset(skip).limit(limit).all()
    return subagents

@router.post("/projects/{project_id}/subagents", response_model=SubagentSchema)
def create_subagent(
    project_id: int,
    subagent: SubagentCreate, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if not current_user.is_admin and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    db_subagent = Subagent(**subagent.dict(), project_id=project_id)
    db.add(db_subagent)
    db.commit()
    db.refresh(db_subagent)
    return db_subagent

@router.get("/subagents/{subagent_id}", response_model=SubagentSchema)
def read_subagent(
    subagent_id: int, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    db_subagent = db.query(Subagent).filter(Subagent.id == subagent_id).first()
    if db_subagent is None:
        raise HTTPException(status_code=404, detail="Subagent not found")
        
    project = db.query(Project).filter(Project.id == db_subagent.project_id).first()
    if not current_user.is_admin and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
        
    return db_subagent

@router.put("/subagents/{subagent_id}", response_model=SubagentSchema)
def update_subagent(
    subagent_id: int, 
    subagent: SubagentUpdate, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    db_subagent = db.query(Subagent).filter(Subagent.id == subagent_id).first()
    if db_subagent is None:
        raise HTTPException(status_code=404, detail="Subagent not found")
        
    project = db.query(Project).filter(Project.id == db_subagent.project_id).first()
    if not current_user.is_admin and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    subagent_data = subagent.dict(exclude_unset=True)
    for key, value in subagent_data.items():
        setattr(db_subagent, key, value)
        
    db.add(db_subagent)
    db.commit()
    db.refresh(db_subagent)
    return db_subagent

@router.delete("/subagents/{subagent_id}")
def delete_subagent(
    subagent_id: int, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    db_subagent = db.query(Subagent).filter(Subagent.id == subagent_id).first()
    if db_subagent is None:
        raise HTTPException(status_code=404, detail="Subagent not found")
        
    project = db.query(Project).filter(Project.id == db_subagent.project_id).first()
    if not current_user.is_admin and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
        
    db.delete(db_subagent)
    db.commit()
    return {"status": "success"}
