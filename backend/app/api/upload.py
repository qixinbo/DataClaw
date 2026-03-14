from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from app.connectors.minio import minio_connector
import pandas as pd
import duckdb
import io
import uuid

router = APIRouter()

@router.post("/upload/csv")
async def upload_csv(file: UploadFile = File(...), background_tasks: BackgroundTasks = None):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Invalid file type. Only CSV allowed.")

    try:
        content = await file.read()
        file_size = len(content)
        file_obj = io.BytesIO(content)
        
        # Generate a unique filename
        unique_filename = f"{uuid.uuid4()}-{file.filename}"
        
        # Upload to MinIO
        minio_url = minio_connector.upload_file(unique_filename, file_obj, file_size, content_type="text/csv")
        
        # Reset file pointer for analysis
        file_obj.seek(0)
        
        # Load into DuckDB (in-memory) for quick analysis
        try:
            df = pd.read_csv(file_obj)
            duckdb_conn = duckdb.connect(database=':memory:')
            duckdb_conn.register('uploaded_csv', df)
            summary = duckdb_conn.execute("DESCRIBE uploaded_csv").fetchall()
            row_count = len(df)
            columns = list(df.columns)
            
            return {
                "filename": unique_filename,
                "url": minio_url,
                "rows": row_count,
                "columns": columns,
                "summary": str(summary)
            }
        except Exception as e:
             return {
                "filename": unique_filename,
                "url": minio_url,
                "analysis_error": str(e)
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
