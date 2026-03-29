from typing import List, Optional
import io
import json

from fastapi import APIRouter, HTTPException
from fastapi import UploadFile, File, Form
from openai import OpenAI
import pandas as pd

from app.schemas.knowledge import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeConnectionTestRequest,
    KnowledgeConnectionTestResponse,
    KnowledgeGlobalConfig,
    KnowledgeGlobalConfigUpdate,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentCreate,
    KnowledgeDocumentUpdate,
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
)
from app.services.knowledge_base_store import knowledge_base_store
from app.services.knowledge_global_config_store import knowledge_global_config_store
from app.services.knowledge_index import knowledge_index_service
from app.services.openai_compat import normalize_openai_base_url

router = APIRouter()


def _mask_api_key(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * (len(value) - 8)}{value[-4:]}"


def _extract_upload_text(filename: str, content: bytes) -> str:
    lower = filename.lower()
    if lower.endswith((".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".log", ".xml", ".html", ".htm")):
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode("utf-8", errors="ignore")
    if lower.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
        return df.to_csv(index=False)
    if lower.endswith((".xls", ".xlsx")):
        df = pd.read_excel(io.BytesIO(content))
        return df.to_csv(index=False)
    
    # 增加对 PDF 的文本提取支持
    if lower.endswith(".pdf"):
        try:
            import PyPDF2
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(content))
            text = []
            for page in pdf_reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text.append(page_text)
            return "\n".join(text)
        except ImportError:
            raise ValueError("PyPDF2 is not installed. Cannot parse PDF files.")
        except Exception as e:
            raise ValueError(f"Failed to parse PDF: {str(e)}")
            
    raise ValueError("Unsupported file type")


@router.get("/knowledge-bases/global-config", response_model=KnowledgeGlobalConfig)
def get_knowledge_global_config():
    config = knowledge_global_config_store.get()
    raw_api_key = config.get("api_key")
    return {
        "api_base": config.get("api_base"),
        "api_key": None,
        "api_key_masked": _mask_api_key(raw_api_key),
        "has_api_key": bool(raw_api_key),
        "default_embedding_model": config.get("default_embedding_model"),
    }


@router.put("/knowledge-bases/global-config", response_model=KnowledgeGlobalConfig)
def update_knowledge_global_config(payload: KnowledgeGlobalConfigUpdate):
    updated = knowledge_global_config_store.update(payload.model_dump(exclude_unset=True))
    raw_api_key = updated.get("api_key")
    return {
        "api_base": updated.get("api_base"),
        "api_key": None,
        "api_key_masked": _mask_api_key(raw_api_key),
        "has_api_key": bool(raw_api_key),
        "default_embedding_model": updated.get("default_embedding_model"),
    }


@router.post("/knowledge-bases/global-config/test-connection", response_model=KnowledgeConnectionTestResponse)
def test_knowledge_global_connection(payload: KnowledgeConnectionTestRequest):
    saved = knowledge_global_config_store.get()
    api_base = normalize_openai_base_url(payload.api_base or saved.get("api_base") or "")
    api_key = payload.api_key or saved.get("api_key")
    model_name = (payload.model_name or "").strip()

    if not api_base:
        raise HTTPException(status_code=400, detail="API Base 未配置")
    if not api_key:
        raise HTTPException(status_code=400, detail="API Key 未配置")
    if not model_name:
        raise HTTPException(status_code=400, detail="测试连接必须显式填写向量模型名称")

    if not api_base:
        raise HTTPException(status_code=400, detail="API Base 未配置")
    try:
        client = OpenAI(
            api_key=api_key,
            base_url=api_base,
        )
        embedding_resp = client.embeddings.create(
            model=model_name,
            input="connection test",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Embedding调用失败: {exc}")

    dimension = None
    if getattr(embedding_resp, "data", None):
        first = embedding_resp.data[0]
        vector = getattr(first, "embedding", None)
        if isinstance(vector, list):
            dimension = len(vector)
    return {
        "success": True,
        "message": "连接成功，Embedding调用正常",
        "model_name": model_name,
        "embedding_dimension": dimension,
        "resolved_api_base": api_base,
        "available_models": [],
    }


@router.get("/knowledge-bases", response_model=List[KnowledgeBase])
def list_knowledge_bases(project_id: Optional[int] = None):
    return knowledge_base_store.list(project_id=project_id)


@router.post("/knowledge-bases", response_model=KnowledgeBase)
def create_knowledge_base(payload: KnowledgeBaseCreate):
    return knowledge_base_store.create(payload.model_dump())


@router.get("/knowledge-bases/{kb_id}", response_model=KnowledgeBase)
def get_knowledge_base(kb_id: str):
    kb = knowledge_base_store.get(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return kb


@router.put("/knowledge-bases/{kb_id}", response_model=KnowledgeBase)
def update_knowledge_base(kb_id: str, payload: KnowledgeBaseUpdate):
    kb = knowledge_base_store.update(kb_id, payload.model_dump(exclude_unset=True))
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return kb


@router.delete("/knowledge-bases/{kb_id}")
def delete_knowledge_base(kb_id: str):
    deleted = knowledge_base_store.delete(kb_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return {"status": "success"}


@router.get("/knowledge-bases/{kb_id}/documents", response_model=List[KnowledgeDocument])
def list_knowledge_documents(kb_id: str):
    kb = knowledge_base_store.get(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return kb.get("documents", [])


@router.post("/knowledge-bases/{kb_id}/documents", response_model=KnowledgeDocument)
def create_knowledge_document(kb_id: str, payload: KnowledgeDocumentCreate):
    doc = knowledge_base_store.create_document(kb_id=kb_id, payload=payload.model_dump())
    if not doc:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return doc


@router.put("/knowledge-bases/{kb_id}/documents/{doc_id}", response_model=KnowledgeDocument)
def update_knowledge_document(kb_id: str, doc_id: str, payload: KnowledgeDocumentUpdate):
    doc = knowledge_base_store.update_document(
        kb_id=kb_id,
        doc_id=doc_id,
        payload=payload.model_dump(exclude_unset=True),
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    return doc


@router.delete("/knowledge-bases/{kb_id}/documents/{doc_id}")
def delete_knowledge_document(kb_id: str, doc_id: str):
    deleted = knowledge_base_store.delete_document(kb_id=kb_id, doc_id=doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    return {"status": "success"}


@router.post("/knowledge-bases/{kb_id}/reindex")
def reindex_knowledge_base(kb_id: str):
    try:
        return knowledge_index_service.reindex(kb_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/knowledge-bases/{kb_id}/search", response_model=KnowledgeSearchResponse)
def search_knowledge_base(kb_id: str, payload: KnowledgeSearchRequest):
    try:
        result = knowledge_index_service.search(
            kb_id=kb_id,
            query=payload.query,
            top_k=payload.top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return result


@router.post("/knowledge-bases/{kb_id}/documents/upload")
async def upload_knowledge_documents(
    kb_id: str,
    files: List[UploadFile] = File(...),
    metadata: Optional[str] = Form(default=None),
):
    kb = knowledge_base_store.get(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    metadata_payload: dict[str, Any] = {}
    if metadata:
        try:
            parsed_metadata = json.loads(metadata)
            if isinstance(parsed_metadata, dict):
                metadata_payload = parsed_metadata
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="metadata 必须是合法 JSON 对象")

    created: List[dict[str, Any]] = []
    for file in files:
        filename = file.filename or "untitled"
        content = await file.read()
        if not content:
            continue
        # 将大小限制从 5MB 放宽到 15MB，以更好地支持带有图片的 PDF 文件
        if len(content) > 15 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"文件过大 (超过 15MB): {filename}")
        try:
            text = _extract_upload_text(filename, content)
        except Exception:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {filename}")
        doc = knowledge_base_store.create_document(
            kb_id=kb_id,
            payload={
                "title": filename,
                "content": text,
                "metadata": {**metadata_payload, "source": "upload", "filename": filename},
            },
        )
        if doc:
            created.append(doc)
    return {"status": "success", "count": len(created), "documents": created}
