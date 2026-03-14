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

class SkillCreate(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    content: str
    type: str = "python"

class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    type: Optional[str] = None

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

def load_skills() -> List[Dict[str, Any]]:
    return _load_data()

@router.get("/skills", response_model=List[Skill])
def list_skills():
    data = load_skills()
    return [Skill(**item) for item in data]

@router.get("/skills/{skill_id}", response_model=Skill)
def get_skill(skill_id: str):
    data = _load_data()
    for item in data:
        if item["id"] == skill_id:
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
def update_skill(skill_id: str, skill: SkillUpdate):
    data = _load_data()
    for i, item in enumerate(data):
        if item["id"] == skill_id:
            updated_item = item.copy()
            update_data = skill.dict(exclude_unset=True)
            updated_item.update(update_data)
            data[i] = updated_item
            _save_data(data)
            return Skill(**updated_item)
    raise HTTPException(status_code=404, detail="Skill not found")

@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: str):
    data = _load_data()
    initial_len = len(data)
    data = [item for item in data if item["id"] != skill_id]
    if len(data) == initial_len:
        raise HTTPException(status_code=404, detail="Skill not found")
    _save_data(data)
    return {"message": "Skill deleted successfully"}
