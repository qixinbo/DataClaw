from typing import List
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate, Project as ProjectSchema
from app.core.security import get_current_user, CurrentUser

router = APIRouter()

@router.get("/projects", response_model=List[ProjectSchema])
def list_projects(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    # Users can only see their own projects, unless they are admin (who can see all?)
    # For simplicity, let's allow users to see their own projects.
    query = db.query(Project)
    if not current_user.is_admin:
        query = query.filter(Project.owner_id == current_user.id)
    
    projects = query.offset(skip).limit(limit).all()
    return projects

@router.post("/projects", response_model=ProjectSchema)
def create_project(
    project: ProjectCreate, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    db_project = Project(**project.dict(), owner_id=current_user.id)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project

@router.get("/projects/{project_id}", response_model=ProjectSchema)
def read_project(
    project_id: int, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if db_project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if not current_user.is_admin and db_project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
        
    return db_project

@router.put("/projects/{project_id}", response_model=ProjectSchema)
def update_project(
    project_id: int, 
    project: ProjectUpdate, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if db_project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if not current_user.is_admin and db_project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    project_data = project.dict(exclude_unset=True)
    for key, value in project_data.items():
        setattr(db_project, key, value)
        
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project

@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int, 
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user)
):
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if db_project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if not current_user.is_admin and db_project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
        
    db.delete(db_project)
    db.commit()
    return {"status": "success"}
