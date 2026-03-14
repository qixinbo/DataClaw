from fastapi import APIRouter, UploadFile, File, HTTPException
import pandas as pd
import duckdb
import io
import uuid
from pathlib import Path

router = APIRouter()
upload_dir = Path(__file__).resolve().parents[2] / "data" / "uploads"
upload_dir.mkdir(parents=True, exist_ok=True)

@router.post("/upload/file")
async def upload_file(file: UploadFile = File(...)):
    allowed_extensions = ('.csv', '.xls', '.xlsx')
    if not file.filename.lower().endswith(allowed_extensions):
        raise HTTPException(status_code=400, detail="Invalid file type. Only CSV and Excel files allowed.")

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty file is not allowed.")
        file_obj = io.BytesIO(content)
        
        unique_filename = f"{uuid.uuid4()}-{file.filename}"
        save_path = upload_dir / unique_filename
        save_path.write_bytes(content)
        file_url = f"local://{unique_filename}"
        
        file_obj.seek(0)
        
        try:
            if file.filename.lower().endswith('.csv'):
                df = pd.read_csv(file_obj)
            else:
                df = pd.read_excel(file_obj)
                
            duckdb_conn = duckdb.connect(database=':memory:')
            duckdb_conn.register('uploaded_file', df)
            summary = duckdb_conn.execute("DESCRIBE uploaded_file").fetchall()
            row_count = len(df)
            columns = list(df.columns)
            
            return {
                "filename": unique_filename,
                "url": file_url,
                "rows": row_count,
                "columns": columns,
                "summary": str(summary)
            }
        except Exception as e:
             return {
                "filename": unique_filename,
                "url": file_url,
                "analysis_error": str(e)
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
