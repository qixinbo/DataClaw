import json
import os
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

DATA_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "skills.json")

class Skill(BaseModel):
    id: str = Field(..., description="Unique identifier for the skill")
    name: str = Field(..., description="Name of the skill")
    description: Optional[str] = Field(None, description="Description of what the skill does")
    content: str = Field(..., description="The content/prompt/logic of the skill")
    type: str = Field("python", description="Type of the skill (python, sql, api)")
    project_id: Optional[int] = Field(None, description="The ID of the project this skill belongs to")

class SkillCreate(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    content: str
    type: str = "python"
    project_id: Optional[int] = None

class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    type: Optional[str] = None
    project_id: Optional[int] = None

def _load_data() -> List[Dict[str, Any]]:
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return []

def _save_data(data: List[Dict[str, Any]]):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

def load_skills(project_id: Optional[int] = None) -> List[Dict[str, Any]]:
    data = _load_data()
    if project_id is not None:
        return [item for item in data if item.get("project_id") == project_id]
    return data

@router.get("/skills", response_model=List[Skill])
def list_skills(project_id: Optional[int] = None):
    data = load_skills(project_id)
    return [Skill(**item) for item in data]

@router.get("/skills/{skill_id}", response_model=Skill)
def get_skill(skill_id: str, project_id: Optional[int] = None):
    data = _load_data()
    for item in data:
        if item["id"] == skill_id:
            if project_id is not None and item.get("project_id") != project_id:
                continue
            return Skill(**item)
    raise HTTPException(status_code=404, detail="Skill not found")

@router.post("/skills", response_model=Skill)
def create_skill(skill: SkillCreate):
    data = _load_data()
    if any(item["id"] == skill.id for item in data):
        raise HTTPException(status_code=400, detail="Skill with this ID already exists")
    
    new_skill = skill.dict()
    data.append(new_skill)
    _save_data(data)
    return Skill(**new_skill)

@router.put("/skills/{skill_id}", response_model=Skill)
def update_skill(skill_id: str, skill: SkillUpdate, project_id: Optional[int] = None):
    data = _load_data()
    for i, item in enumerate(data):
        if item["id"] == skill_id:
            if project_id is not None and item.get("project_id") != project_id:
                continue
            updated_item = item.copy()
            update_data = skill.dict(exclude_unset=True)
            updated_item.update(update_data)
            data[i] = updated_item
            _save_data(data)
            return Skill(**updated_item)
    raise HTTPException(status_code=404, detail="Skill not found")

@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: str, project_id: Optional[int] = None):
    data = _load_data()
    initial_len = len(data)
    
    # If project_id is provided, we only delete if it matches
    new_data = []
    found = False
    for item in data:
        if item["id"] == skill_id:
            if project_id is not None and item.get("project_id") != project_id:
                new_data.append(item)
                continue
            found = True
        else:
            new_data.append(item)
            
    if not found:
        raise HTTPException(status_code=404, detail="Skill not found")
        
    _save_data(new_data)
    return {"message": "Skill deleted successfully"}
