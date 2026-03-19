import json
import os
import shutil
import zipfile
import tarfile
import re
import yaml
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

router = APIRouter()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_FILE = os.path.join(BASE_DIR, "data", "skills.json")
SKILL_HUB_DIR = os.path.join(BASE_DIR, "data", "workspace", "skills")

# Ensure skill-hub directory exists
os.makedirs(SKILL_HUB_DIR, exist_ok=True)

class Skill(BaseModel):
    id: str = Field(..., description="Unique identifier for the skill")
    name: str = Field(..., description="Name of the skill")
    description: Optional[str] = Field(None, description="Description of what the skill does")
    content: str = Field(..., description="The content/prompt/logic of the skill")
    type: str = Field("python", description="Type of the skill (python, sql, api)")
    project_id: Optional[int] = Field(None, description="The ID of the project this skill belongs to")
    source: str = Field("本地导入", description="Source of the skill (e.g., 本地导入, GitHub 导入)")
    installation_time: str = Field(default_factory=lambda: datetime.now().strftime("%Y年%m月%d日"), description="Time when the skill was installed")
    status: str = Field("安全", description="Security status of the skill (e.g., 安全, 低风险)")
    file_path: Optional[str] = Field(None, description="Path to the skill folder in skill-hub")
    is_builtin: bool = Field(False, description="Whether this is a system builtin skill")

class SkillCreate(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    content: str
    type: str = "python"
    project_id: Optional[int] = None
    source: str = "本地导入"
    installation_time: Optional[str] = None
    status: str = "安全"
    file_path: Optional[str] = None

class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    type: Optional[str] = None
    project_id: Optional[int] = None
    source: Optional[str] = None
    installation_time: Optional[str] = None
    status: Optional[str] = None
    file_path: Optional[str] = None

def _parse_skill_md(file_path: str) -> Dict[str, Any]:
    """Parse SKILL.md for metadata and content according to agentskills.io standard."""
    if not os.path.exists(file_path):
        return {}
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return {}
    
    # Split YAML frontmatter and Markdown body
    # Support both --- and +++ for frontmatter
    metadata = {}
    body = content
    
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            try:
                metadata = yaml.safe_load(parts[1]) or {}
                body = parts[2].strip()
            except Exception as e:
                print(f"Error parsing YAML frontmatter: {e}")
    
    # Extract name and description, fallback to some defaults
    name = metadata.get("name")
    description = metadata.get("description")
    
    # If name not in metadata, try to find the first H1 in markdown body
    if not name:
        for line in body.split('\n'):
            if line.startswith('# '):
                name = line[2:].strip()
                break
    
    return {
        "name": name,
        "description": description,
        "content": body,
        "metadata": metadata
    }

def _load_data() -> List[Dict[str, Any]]:
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return []

def _save_data(data: List[Dict[str, Any]]):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def _safe_skill_dir_name(value: str) -> str:
    safe = re.sub(r'[^a-zA-Z0-9_\-]', '_', value or "").lower()
    return safe or "skill"

def _write_skill_markdown(skill_dir: str, skill_name: str, description: Optional[str], content: str) -> str:
    os.makedirs(skill_dir, exist_ok=True)
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    final_description = description or "No description provided"
    body = content or ""
    markdown = (
        f"---\n"
        f"name: {skill_name}\n"
        f"description: {final_description}\n"
        f"---\n\n"
        f"{body}\n"
    )
    with open(skill_md_path, "w", encoding="utf-8") as f:
        f.write(markdown)
    return skill_md_path

def load_skills(project_id: Optional[int] = None) -> List[Dict[str, Any]]:
    data = _load_data()
    
    registered_paths = set()
    
    # Sync registered skills with their SKILL.md if available
    for item in data:
        item.setdefault("is_builtin", False)
        if item.get("file_path"):
            abs_path = os.path.abspath(item["file_path"])
            registered_paths.add(abs_path)
            skill_md_path = os.path.join(abs_path, "SKILL.md")
            if os.path.exists(skill_md_path):
                metadata_res = _parse_skill_md(skill_md_path)
                if metadata_res.get("name"):
                    item["name"] = metadata_res["name"]
                if metadata_res.get("description"):
                    item["description"] = metadata_res["description"]
                if metadata_res.get("content"):
                    item["content"] = metadata_res["content"]
    
    # Scan for unregistered skills in SKILL_HUB_DIR
    if os.path.exists(SKILL_HUB_DIR):
        for item in os.listdir(SKILL_HUB_DIR):
            skill_dir = os.path.abspath(os.path.join(SKILL_HUB_DIR, item))
            if os.path.isdir(skill_dir):
                skill_md_path = os.path.join(skill_dir, "SKILL.md")
                if os.path.exists(skill_md_path) and skill_dir not in registered_paths:
                    metadata_res = _parse_skill_md(skill_md_path)
                    skill_name = metadata_res.get("name") or item
                    
                    # Create a new entry for this discovered skill
                    new_skill = {
                        "id": item,
                        "name": skill_name,
                        "description": metadata_res.get("description") or "No description provided",
                        "content": metadata_res.get("content") or "",
                        "type": "agentskill",
                        "project_id": None,
                        "source": "后台生成",
                        "installation_time": datetime.now().strftime("%Y年%m月%d日"),
                        "status": "安全",
                        "file_path": skill_dir,
                        "is_builtin": item in ("nl2sql", "visualization")
                    }
                    data.append(new_skill)
                    registered_paths.add(skill_dir)

    if project_id is not None:
        return [item for item in data if item.get("project_id") == project_id or item.get("project_id") is None]
    return data

@router.get("/skills", response_model=List[Skill])
def list_skills(project_id: Optional[int] = None):
    data = load_skills(project_id)
    return [Skill(**item) for item in data]

@router.get("/skills/{skill_id}", response_model=Skill)
def get_skill(skill_id: str, project_id: Optional[int] = None):
    data = load_skills()
    for item in data:
        if item["id"] == skill_id:
            if project_id is not None and item.get("project_id") != project_id:
                continue
            return Skill(**item)
    raise HTTPException(status_code=404, detail="Skill not found")

@router.post("/skills/upload")
async def upload_skill(
    file: UploadFile = File(...),
    project_id: Optional[int] = Form(None)
):
    """Upload a skill file (SKILL.md) or a packaged skill (zip/tar.gz)."""
    filename = file.filename
    print(f"Uploading skill: {filename}, project_id: {project_id}")
    
    # Create a unique temp directory
    temp_dir_name = f"temp_{datetime.now().timestamp()}_{os.urandom(4).hex()}"
    temp_dir = os.path.join(SKILL_HUB_DIR, temp_dir_name)
    os.makedirs(temp_dir, exist_ok=True)
    
    try:
        file_path = os.path.join(temp_dir, filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        skill_source_dir = None
        
        # Handle different file types
        if filename.endswith(".zip"):
            try:
                with zipfile.ZipFile(file_path, 'r') as zip_ref:
                    zip_ref.extractall(temp_dir)
                os.remove(file_path)
                # Find the directory containing SKILL.md
                for root, dirs, files in os.walk(temp_dir):
                    if "SKILL.md" in files:
                        skill_source_dir = root
                        break
            except Exception as e:
                print(f"Zip extraction failed: {e}")
                raise HTTPException(status_code=400, detail=f"Failed to extract zip: {str(e)}")
                
        elif filename.endswith((".tar.gz", ".tgz")):
            try:
                with tarfile.open(file_path, 'r:gz') as tar_ref:
                    tar_ref.extractall(temp_dir)
                os.remove(file_path)
                for root, dirs, files in os.walk(temp_dir):
                    if "SKILL.md" in files:
                        skill_source_dir = root
                        break
            except Exception as e:
                print(f"Tarball extraction failed: {e}")
                raise HTTPException(status_code=400, detail=f"Failed to extract tarball: {str(e)}")
                
        elif filename == "SKILL.md":
            skill_source_dir = temp_dir
        else:
            print(f"Unsupported file type: {filename}")
            raise HTTPException(status_code=400, detail="Only SKILL.md or packaged skills (zip/tar.gz) are supported")

        if not skill_source_dir or not os.path.exists(os.path.join(skill_source_dir, "SKILL.md")):
            print(f"SKILL.md not found in {filename}")
            raise HTTPException(status_code=400, detail="SKILL.md not found in the uploaded file")

        # Parse metadata
        skill_md_path = os.path.join(skill_source_dir, "SKILL.md")
        metadata_res = _parse_skill_md(skill_md_path)
        
        # Use metadata name, or fallback to folder name or filename
        skill_name = metadata_res.get("name")
        if not skill_name:
            if filename == "SKILL.md":
                skill_name = "unnamed_skill"
            else:
                # Use filename without extension
                skill_name = os.path.splitext(filename)[0]
        
        # Create a safe directory name for the skill
        safe_name = _safe_skill_dir_name(skill_name)
        final_skill_id = f"{safe_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        final_skill_dir = os.path.join(SKILL_HUB_DIR, final_skill_id)
        
        print(f"Finalizing skill: {skill_name} -> {final_skill_dir}")
        
        # Move the skill content to final destination
        os.makedirs(final_skill_dir, exist_ok=True)
        for item in os.listdir(skill_source_dir):
            s = os.path.join(skill_source_dir, item)
            d = os.path.join(final_skill_dir, item)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)

        # Register in skills.json
        data = load_skills()
        new_skill = {
            "id": final_skill_id,
            "name": skill_name,
            "description": metadata_res.get("description") or "No description provided",
            "content": metadata_res.get("content") or "",
            "type": "agentskill",
            "project_id": project_id,
            "source": "文件上传",
            "installation_time": datetime.now().strftime("%Y年%m月%d日"),
            "status": "安全",
            "file_path": final_skill_dir
        }
        
        data.append(new_skill)
        _save_data(data)
        print(f"Skill registered successfully: {final_skill_id}")
        
        return new_skill

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")
    finally:
        # Cleanup temp directory
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

@router.post("/skills", response_model=Skill)
def create_skill(skill: SkillCreate):
    data = load_skills()
    if any(item["id"] == skill.id for item in data):
        raise HTTPException(status_code=400, detail="Skill with this ID already exists")
    
    new_skill_dict = skill.dict()
    if not new_skill_dict.get("installation_time"):
        new_skill_dict["installation_time"] = datetime.now().strftime("%Y年%m月%d日")
    if not new_skill_dict.get("file_path"):
        skill_dir = os.path.join(SKILL_HUB_DIR, _safe_skill_dir_name(new_skill_dict["id"]))
        _write_skill_markdown(
            skill_dir=skill_dir,
            skill_name=new_skill_dict["name"],
            description=new_skill_dict.get("description"),
            content=new_skill_dict.get("content", ""),
        )
        new_skill_dict["file_path"] = skill_dir
    
    data.append(new_skill_dict)
    _save_data(data)
    return Skill(**new_skill_dict)

@router.put("/skills/{skill_id}", response_model=Skill)
def update_skill(skill_id: str, skill: SkillUpdate, project_id: Optional[int] = None):
    data = load_skills()
    for i, item in enumerate(data):
        if item["id"] == skill_id:
            if project_id is not None and item.get("project_id") != project_id:
                continue
            updated_item = item.copy()
            update_data = skill.dict(exclude_unset=True)
            updated_item.update(update_data)
            if updated_item.get("file_path"):
                _write_skill_markdown(
                    skill_dir=updated_item["file_path"],
                    skill_name=updated_item.get("name") or item.get("name") or "skill",
                    description=updated_item.get("description"),
                    content=updated_item.get("content", ""),
                )
            data[i] = updated_item
            _save_data(data)
            return Skill(**updated_item)
    raise HTTPException(status_code=404, detail="Skill not found")

@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: str, project_id: Optional[int] = None):
    data = load_skills()
    initial_len = len(data)
    
    # If project_id is provided, we only delete if it matches
    new_data = []
    found = False
    skill_to_delete = None
    
    for item in data:
        if item["id"] == skill_id:
            if item.get("is_builtin"):
                raise HTTPException(status_code=400, detail="Builtin skills cannot be deleted")
            if project_id is not None and item.get("project_id") != project_id:
                new_data.append(item)
                continue
            found = True
            skill_to_delete = item
        else:
            new_data.append(item)
            
    if not found:
        raise HTTPException(status_code=404, detail="Skill not found")
    
    # Clean up file_path if it exists
    if skill_to_delete and skill_to_delete.get("file_path"):
        file_path = skill_to_delete["file_path"]
        if os.path.exists(file_path):
            try:
                if os.path.isdir(file_path):
                    shutil.rmtree(file_path)
                else:
                    os.remove(file_path)
            except Exception as e:
                print(f"Error deleting skill files at {file_path}: {e}")
        
    _save_data(new_data)
    return {"message": "Skill deleted successfully"}
