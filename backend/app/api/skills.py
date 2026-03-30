import json
import os
import shutil
import zipfile
import tarfile
import re
import yaml
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from app.core.data_root import get_data_root, get_workspace_root
from nanobot.agent.skills import BUILTIN_SKILLS_DIR as NANOBOT_BUILTIN_SKILLS_DIR

router = APIRouter()

DATA_FILE = str(get_data_root() / "skills.json")
SKILL_HUB_DIR = str(get_workspace_root() / "skills")
BACKEND_BUILTIN_SKILLS_DIR = str(Path(__file__).resolve().parents[1] / "skills_builtin")

SOURCE_LOCAL_IMPORT = "local_import"
SOURCE_SYSTEM_BUILTIN = "system_builtin"
SOURCE_BACKEND_GENERATED = "backend_generated"
SOURCE_UPLOADED_FILE = "uploaded_file"

STATUS_SAFE = "safe"
STATUS_LOW_RISK = "low_risk"

_SOURCE_ALIASES = {
    SOURCE_LOCAL_IMPORT: SOURCE_LOCAL_IMPORT,
    "本地导入": SOURCE_LOCAL_IMPORT,
    "Local Import": SOURCE_LOCAL_IMPORT,
    SOURCE_SYSTEM_BUILTIN: SOURCE_SYSTEM_BUILTIN,
    "系统内置": SOURCE_SYSTEM_BUILTIN,
    "System Built-in": SOURCE_SYSTEM_BUILTIN,
    SOURCE_BACKEND_GENERATED: SOURCE_BACKEND_GENERATED,
    "后台生成": SOURCE_BACKEND_GENERATED,
    "Backend Generated": SOURCE_BACKEND_GENERATED,
    SOURCE_UPLOADED_FILE: SOURCE_UPLOADED_FILE,
    "文件上传": SOURCE_UPLOADED_FILE,
    "File Upload": SOURCE_UPLOADED_FILE,
}

_STATUS_ALIASES = {
    STATUS_SAFE: STATUS_SAFE,
    "安全": STATUS_SAFE,
    "Safe": STATUS_SAFE,
    STATUS_LOW_RISK: STATUS_LOW_RISK,
    "低风险": STATUS_LOW_RISK,
    "Low Risk": STATUS_LOW_RISK,
}


def _normalize_source(value: Optional[str]) -> str:
    if not value:
        return SOURCE_LOCAL_IMPORT
    return _SOURCE_ALIASES.get(value, value)


def _normalize_status(value: Optional[str]) -> str:
    if not value:
        return STATUS_SAFE
    return _STATUS_ALIASES.get(value, value)

def _ensure_skill_hub_dir() -> None:
    os.makedirs(SKILL_HUB_DIR, exist_ok=True)

class Skill(BaseModel):
    id: str = Field(..., description="Unique identifier for the skill")
    name: str = Field(..., description="Name of the skill")
    description: Optional[str] = Field(None, description="Description of what the skill does")
    content: str = Field(..., description="The content/prompt/logic of the skill")
    type: str = Field("python", description="Type of the skill (python, sql, api)")
    project_id: Optional[int] = Field(None, description="The ID of the project this skill belongs to")
    source: str = Field(SOURCE_LOCAL_IMPORT, description="Stable source key of the skill")
    installation_time: str = Field(default_factory=lambda: datetime.now().strftime("%Y年%m月%d日"), description="Time when the skill was installed")
    status: str = Field(STATUS_SAFE, description="Stable security status key")
    file_path: Optional[str] = Field(None, description="Path to the skill folder in skill-hub")
    is_builtin: bool = Field(False, description="Whether this is a system builtin skill")

class SkillCreate(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    content: str
    type: str = "python"
    project_id: Optional[int] = None
    source: str = SOURCE_LOCAL_IMPORT
    installation_time: Optional[str] = None
    status: str = STATUS_SAFE
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

def _dedupe_skills(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: Dict[str, Dict[str, Any]] = {}
    for item in data:
        skill_id = str(item.get("id") or "").strip()
        project_id = item.get("project_id")
        if not skill_id:
            continue
        
        # Use a composite key of (id, project_id) for deduplication
        # so that different projects can theoretically have the same skill_id
        dedupe_key = f"{skill_id}_{project_id}"
        
        existing = deduped.get(dedupe_key)
        if existing is None:
            deduped[dedupe_key] = item
            continue
            
        # If they somehow have the exact same dedupe_key, we just keep the later one
        deduped[dedupe_key] = item
        
    return list(deduped.values())

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

def _scan_builtin_skills(data: List[Dict[str, Any]], registered_paths: set, source_dir: str, source_name: str):
    if not os.path.exists(source_dir):
        return
    for item in os.listdir(source_dir):
        skill_dir = os.path.abspath(os.path.join(source_dir, item))
        if os.path.isdir(skill_dir):
            skill_md_path = os.path.join(skill_dir, "SKILL.md")
            if os.path.exists(skill_md_path):
                metadata_res = _parse_skill_md(skill_md_path)
                skill_name = metadata_res.get("name") or item
                
                existing = None
                for d in data:
                    if (d.get("id") == item and d.get("is_builtin")) or d.get("file_path") == skill_dir:
                        existing = d
                        break
                
                if existing:
                    existing["name"] = skill_name
                    existing["description"] = metadata_res.get("description") or "No description provided"
                    existing["content"] = metadata_res.get("content") or ""
                    existing["file_path"] = skill_dir
                    existing["is_builtin"] = True
                    existing["source"] = source_name
                    existing["status"] = STATUS_SAFE
                    registered_paths.add(skill_dir)
                else:
                    new_skill = {
                        "id": item,
                        "name": skill_name,
                        "description": metadata_res.get("description") or "No description provided",
                        "content": metadata_res.get("content") or "",
                        "type": "agentskill",
                        "project_id": None,
                        "source": source_name,
                        "installation_time": datetime.now().strftime("%Y年%m月%d日"),
                        "status": STATUS_SAFE,
                        "file_path": skill_dir,
                        "is_builtin": True
                    }
                    data.append(new_skill)
                    registered_paths.add(skill_dir)

def load_skills(project_id: Optional[int] = None) -> List[Dict[str, Any]]:
    _ensure_skill_hub_dir()
    data = _load_data()
    
    registered_paths = set()
    
    # Sync registered skills with their SKILL.md if available
    for item in data:
        item["source"] = _normalize_source(item.get("source"))
        item["status"] = _normalize_status(item.get("status"))
        if item.get("id") in ("nl2sql", "visualization") or item.get("is_builtin"):
            item["is_builtin"] = True
        else:
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
    
    # Scan builtin skills
    _scan_builtin_skills(data, registered_paths, NANOBOT_BUILTIN_SKILLS_DIR, SOURCE_SYSTEM_BUILTIN)
    _scan_builtin_skills(data, registered_paths, BACKEND_BUILTIN_SKILLS_DIR, SOURCE_SYSTEM_BUILTIN)

    # Scan for unregistered skills in SKILL_HUB_DIR (1-level deep to match nanobot's behavior)
    if os.path.exists(SKILL_HUB_DIR):
        for item in os.listdir(SKILL_HUB_DIR):
            skill_dir = os.path.abspath(os.path.join(SKILL_HUB_DIR, item))
            if os.path.isdir(skill_dir):
                skill_md_path = os.path.join(skill_dir, "SKILL.md")
                if os.path.exists(skill_md_path) and skill_dir not in registered_paths:
                    metadata_res = _parse_skill_md(skill_md_path)
                    skill_name = metadata_res.get("name") or item
                    
                    # Try to deduce project_id from directory prefix (e.g., p123_skillname)
                    deduced_project_id = None
                    match = re.match(r'^p(\d+)_', item)
                    if match:
                        deduced_project_id = int(match.group(1))
                    
                    new_skill = {
                        "id": item,
                        "name": skill_name,
                        "description": metadata_res.get("description") or "No description provided",
                        "content": metadata_res.get("content") or "",
                        "type": "agentskill",
                        "project_id": deduced_project_id,
                        "source": SOURCE_BACKEND_GENERATED,
                        "installation_time": datetime.now().strftime("%Y年%m月%d日"),
                        "status": STATUS_SAFE,
                        "file_path": skill_dir,
                        "is_builtin": item in ("nl2sql", "visualization")
                    }
                    data.append(new_skill)
                    registered_paths.add(skill_dir)

    deduped = _dedupe_skills(data)
    if project_id is not None:
        return [item for item in deduped if item.get("project_id") == project_id or item.get("project_id") is None]
    return deduped

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
    _ensure_skill_hub_dir()
    
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
        
        if project_id is not None:
            # Prefix the folder name with p{project_id}_ to distinguish projects in storage
            # without breaking nanobot's 1-level-deep skill loader
            final_skill_dir = os.path.join(SKILL_HUB_DIR, f"p{project_id}_{final_skill_id}")
            final_skill_id = f"p{project_id}_{final_skill_id}"
        else:
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
            "source": SOURCE_UPLOADED_FILE,
            "installation_time": datetime.now().strftime("%Y年%m月%d日"),
            "status": STATUS_SAFE,
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
    _ensure_skill_hub_dir()
    data = load_skills()
    if any(item["id"] == skill.id and item.get("project_id") == skill.project_id for item in data):
        raise HTTPException(status_code=400, detail="Skill with this ID already exists in this project")
    
    new_skill_dict = skill.dict()
    new_skill_dict["source"] = _normalize_source(new_skill_dict.get("source"))
    new_skill_dict["status"] = _normalize_status(new_skill_dict.get("status"))
    if not new_skill_dict.get("installation_time"):
        new_skill_dict["installation_time"] = datetime.now().strftime("%Y年%m月%d日")
    if not new_skill_dict.get("file_path"):
        project_id = new_skill_dict.get("project_id")
        base_dir_name = _safe_skill_dir_name(new_skill_dict["id"])
        if project_id is not None:
            # Add prefix for project storage distinction
            if not base_dir_name.startswith(f"p{project_id}_"):
                base_dir_name = f"p{project_id}_{base_dir_name}"
            skill_dir = os.path.join(SKILL_HUB_DIR, base_dir_name)
        else:
            skill_dir = os.path.join(SKILL_HUB_DIR, base_dir_name)
            
        _write_skill_markdown(
            skill_dir=skill_dir,
            skill_name=new_skill_dict["name"],
            description=new_skill_dict.get("description"),
            content=new_skill_dict.get("content", ""),
        )
        new_skill_dict["file_path"] = skill_dir
        new_skill_dict["id"] = base_dir_name
    
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
            if "source" in update_data:
                update_data["source"] = _normalize_source(update_data.get("source"))
            if "status" in update_data:
                update_data["status"] = _normalize_status(update_data.get("status"))
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
            if project_id is not None and item.get("project_id") not in (project_id, None):
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
