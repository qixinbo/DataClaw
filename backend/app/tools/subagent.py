from typing import Any, Optional
import json

from nanobot.agent.tools.base import Tool
from app.database import SessionLocal
from app.models.subagent import Subagent
from app.core.nanobot import nanobot_service
from app.core.session_alias_store import session_alias_store
from app.services.llm_cache import get_llm_configs, get_active_llm_config


def _resolve_project_id(preferred_project_id: Optional[int]) -> Optional[int]:
    if preferred_project_id is not None:
        return preferred_project_id
    from app.context import current_session_id
    session_id = (current_session_id.get() or "").strip()
    if not session_id:
        return None
    alias_meta = session_alias_store.get_alias_meta(session_id)
    if not alias_meta:
        return None
    project_id = alias_meta.get("project_id")
    return project_id if isinstance(project_id, int) else None

class ListSubagentsTool(Tool):
    """
    Tool to list available subagents for the current project.
    """
    def __init__(self, project_id: Optional[int] = None):
        super().__init__()
        self.project_id = project_id

    @property
    def name(self) -> str:
        return "list_subagents"

    @property
    def description(self) -> str:
        return "List all available subagents in the current project, including their names and descriptions."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {},
            "required": [],
        }

    async def execute(self, **kwargs: Any) -> str:
        resolved_project_id = _resolve_project_id(self.project_id)
        if resolved_project_id is None:
            return "Error: No project context available to list subagents."
            
        with SessionLocal() as db:
            subagents = db.query(Subagent).filter(Subagent.project_id == resolved_project_id).all()
            
        if not subagents:
            return "No subagents found in the current project."
            
        result = []
        for sa in subagents:
            result.append({
                "id": sa.id,
                "name": sa.name,
                "description": sa.description,
            })
            
        return json.dumps(result, ensure_ascii=False, indent=2)


class InvokeSubagentTool(Tool):
    """
    Tool to invoke a specific subagent to perform a task.
    """
    def __init__(self, project_id: Optional[int] = None):
        super().__init__()
        self.project_id = project_id

    @property
    def name(self) -> str:
        return "invoke_subagent"

    @property
    def description(self) -> str:
        return (
            "Invoke a subagent by name to perform a specific task. "
            "You should first use list_subagents to find the correct subagent name."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "subagent_name": {
                    "type": "string",
                    "description": "The name of the subagent to invoke.",
                },
                "task": {
                    "type": "string",
                    "description": "The specific task or query to send to the subagent.",
                }
            },
            "required": ["subagent_name", "task"],
        }

    async def execute(self, **kwargs: Any) -> str:
        subagent_name = kwargs.get("subagent_name")
        task = kwargs.get("task")
        resolved_project_id = _resolve_project_id(self.project_id)
        
        if resolved_project_id is None:
            return "Error: No project context available to invoke subagent."
            
        if not subagent_name or not task:
            return "Error: subagent_name and task are required."
            
        with SessionLocal() as db:
            subagent = db.query(Subagent).filter(
                Subagent.project_id == resolved_project_id,
                Subagent.name == subagent_name
            ).first()
            
        if not subagent:
            return f"Error: Subagent '{subagent_name}' not found."

        # Construct the message with subagent instructions
        instructions = subagent.instructions or "You are a helpful assistant."
        message = f"[System: You are acting as subagent '{subagent.name}'. Instructions: {instructions}]\n\nTask: {task}"
        resolved_model_id = None
        llm_configs = get_llm_configs()
        target = None
        raw_model = (getattr(subagent, "model", None) or "").strip()
        if raw_model:
            target = next((item for item in llm_configs if item.get("id") == raw_model), None)
            if target is None:
                normalized = raw_model.lower()
                target = next(
                    (
                        item for item in llm_configs
                        if (
                            str(item.get("model") or "").strip().lower() == normalized
                            or str(item.get("name") or "").strip().lower() == normalized
                        )
                    ),
                    None,
                )
        if target is None:
            target = get_active_llm_config()
        if target and target.get("id"):
            resolved_model_id = target.get("id")
        
        try:
            from app.context import current_session_id
            parent_session_id = current_session_id.get() or "default"
            subagent_session_id = f"{parent_session_id}:subagent:{subagent.id}"
            
            response = await nanobot_service.process_message(
                message=message,
                session_id=subagent_session_id,
                project_id=resolved_project_id,
                model_id=resolved_model_id,
            )
            return f"Subagent '{subagent.name}' completed the task.\nResult:\n{response}"
        except Exception as e:
            return f"Error invoking subagent '{subagent.name}': {str(e)}"
