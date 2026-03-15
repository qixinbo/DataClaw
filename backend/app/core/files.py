import os
from pathlib import Path
from typing import Optional

def resolve_upload_file_path(file_url: Optional[str]) -> Path:
    if not file_url:
        raise ValueError("File URL is empty")
        
    if file_url.startswith("local://"):
        raw_name = file_url.replace("local://", "", 1)
        safe_name = os.path.basename(raw_name)
        # Assuming we are in backend/app/core, go up to backend/data/uploads
        upload_dir = Path(__file__).resolve().parents[2] / "data" / "uploads"
        file_path = upload_dir / safe_name
        return file_path
    
    # If it's already an absolute path (or relative path not starting with local://)
    return Path(file_url)
