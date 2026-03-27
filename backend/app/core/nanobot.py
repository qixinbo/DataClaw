import asyncio
import sys
import os
import shutil
from pathlib import Path
from typing import List, Callable, Awaitable, Any, Dict

# Add project root to sys.path to allow importing nanobot
# Assuming backend/app/core/nanobot.py -> backend/app/core -> backend/app -> backend -> root
# This path calculation seems correct for backend/app/core/nanobot.py relative to backend/
# BUT nanobot package is in ../nanobot relative to backend/
# So we need to go up one more level to reach the parent of backend/
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT / "nanobot") not in sys.path:
    sys.path.append(str(PROJECT_ROOT / "nanobot"))

from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.config.loader import load_config
from nanobot.cron.service import CronService
from nanobot.providers.openai_compat_provider import OpenAICompatProvider
from nanobot.providers.openai_codex_provider import OpenAICodexProvider
from nanobot.providers.azure_openai_provider import AzureOpenAIProvider
from nanobot.providers.base import GenerationSettings
from nanobot.providers.registry import find_by_name
from nanobot.session.manager import SessionManager
from nanobot.config.schema import Config

# Import skills loader
# We use a lazy import inside the method to avoid potential circular dependencies if any arise,
# or just import here if we are confident.
# Given the structure, importing here should be fine as long as skills.py doesn't import nanobot.py.
from app.api.skills import load_skills
from app.services.llm_cache import get_llm_configs, get_active_llm_config

from app.core.data_root import get_workspace_root

class NanobotIntegration:
    def __init__(self):
        self.agent: AgentLoop | None = None
        self.bus: MessageBus | None = None
        self.cron: CronService | None = None
        self.config: Config | None = None
        self._started = False
        self._model_agent_cache: Dict[tuple[str | None, int | None], AgentLoop] = {}
        self._model_agent_lock = asyncio.Lock()

    @staticmethod
    def _normalize_config_value(value: Any) -> Any:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @staticmethod
    def _normalize_model_id(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return str(value)

    @staticmethod
    def _extract_response_text(response: Any) -> str:
        if response is None:
            return ""
        if isinstance(response, str):
            return response
        if isinstance(response, OutboundMessage):
            return response.content or ""
        if isinstance(response, dict):
            content = response.get("content")
            if isinstance(content, str):
                return content
            return str(content or "")
        content = getattr(response, "content", None)
        if isinstance(content, str):
            return content
        return str(response)

    def _need_custom_agent_for_target(self, target_config: Dict[str, Any]) -> bool:
        if not self.agent:
            return False

        provider = self.agent.provider
        target_model = self._normalize_config_value(target_config.get("model"))
        current_model = self._normalize_config_value(
            getattr(self.agent, "model", None) or getattr(provider, "default_model", None)
        )
        if target_model != current_model:
            return True

        target_provider = self._normalize_config_value(target_config.get("provider"))
        current_provider = self._normalize_config_value(getattr(provider, "_provider_name_override", None))
        if not current_provider:
            current_provider = self._normalize_config_value(getattr(getattr(provider, "_spec", None), "name", None))
        if not current_provider and current_model and self.config:
            current_provider = self._normalize_config_value(self.config.get_provider_name(current_model))
        if target_provider != current_provider:
            return True

        target_api_base = self._normalize_config_value(target_config.get("api_base"))
        current_api_base = self._normalize_config_value(getattr(provider, "api_base", None))
        if target_api_base != current_api_base:
            return True

        target_api_key = self._normalize_config_value(target_config.get("api_key"))
        current_api_key = self._normalize_config_value(getattr(provider, "api_key", None))
        if target_api_key != current_api_key:
            return True

        target_headers = target_config.get("extra_headers") or {}
        current_headers = getattr(provider, "extra_headers", None) or {}
        return target_headers != current_headers

    def initialize(self):
        workspace_path = get_workspace_root()
        workspace_path.mkdir(parents=True, exist_ok=True)
        self._sync_builtin_skills_to_workspace(workspace_path)
        
        # Override config workspace path via environment variable (since config is loaded from env)
        os.environ["NANOBOT_AGENTS__DEFAULTS__WORKSPACE"] = str(workspace_path)
        
        self.config = load_config()
        # No need to set self.config.workspace_path as it's a property that reads from agents.defaults.workspace
        
        self.bus = MessageBus()
        provider = self._make_provider(self.config)
        
        cron_store_path = workspace_path / "cron"
        cron_store_path.mkdir(parents=True, exist_ok=True)
        cron_store_file = cron_store_path / "jobs.json"
        
        self.cron = CronService(cron_store_file)
        
        session_manager = SessionManager(self.config.workspace_path)

        self.agent = AgentLoop(
            bus=self.bus,
            provider=provider,
            workspace=self.config.workspace_path,
            model=self.config.agents.defaults.model,
            max_iterations=self.config.agents.defaults.max_tool_iterations,
            context_window_tokens=self.config.agents.defaults.context_window_tokens,
            web_search_config=self.config.tools.web.search,
            web_proxy=self.config.tools.web.proxy or None,
            exec_config=self.config.tools.exec,
            cron_service=self.cron,
            restrict_to_workspace=self.config.tools.restrict_to_workspace,
            session_manager=session_manager,
            mcp_servers=self.config.tools.mcp_servers,
            channels_config=self.config.channels,
            timezone=self.config.agents.defaults.timezone,
        )

        self._register_custom_tools(self.agent)

    def _sync_builtin_skills_to_workspace(self, workspace_path: Path) -> None:
        builtin_root = Path(__file__).resolve().parents[1] / "skills_builtin"
        workspace_skills_root = workspace_path / "skills"
        workspace_skills_root.mkdir(parents=True, exist_ok=True)

        for skill_name in ("nl2sql", "visualization"):
            source_dir = builtin_root / skill_name
            source_skill_file = source_dir / "SKILL.md"
            if not source_skill_file.exists():
                continue
            target_dir = workspace_skills_root / skill_name
            target_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_skill_file, target_dir / "SKILL.md")

    def _register_custom_tools(self, agent: AgentLoop, project_id: int | None = None):
        from app.tools.nl2sql import NL2SQLTool
        from app.tools.visualization import VisualizationTool
        from app.tools.get_schema import GetDatabaseSchemaTool
        from app.tools.subagent import ListSubagentsTool, InvokeSubagentTool
        agent.tools.register(NL2SQLTool())
        agent.tools.register(VisualizationTool())
        agent.tools.register(GetDatabaseSchemaTool())
        if project_id is not None:
            agent.tools.register(ListSubagentsTool(project_id=project_id))
            agent.tools.register(InvokeSubagentTool(project_id=project_id))

    def _build_provider(
        self,
        model: str,
        provider_name: str | None,
        api_key: str | None,
        api_base: str | None,
        extra_headers: dict[str, Any] | None = None,
    ):
        spec = find_by_name(provider_name) if provider_name else None
        backend = spec.backend if spec else "openai_compat"

        if backend == "openai_codex" or model.startswith("openai-codex/"):
            return OpenAICodexProvider(default_model=model)

        if backend == "azure_openai":
            if not api_key or not api_base:
                raise ValueError("Azure OpenAI requires api_key and api_base.")
            return AzureOpenAIProvider(
                api_key=api_key,
                api_base=api_base,
                default_model=model,
            )

        if backend == "anthropic":
            from nanobot.providers.anthropic_provider import AnthropicProvider
            return AnthropicProvider(
                api_key=api_key,
                api_base=api_base,
                default_model=model,
                extra_headers=extra_headers,
            )

        return OpenAICompatProvider(
            api_key=api_key,
            api_base=api_base,
            default_model=model,
            extra_headers=extra_headers,
            spec=spec,
        )

    def _make_provider(self, config: Config):
        model = config.agents.defaults.model
        provider_name = config.get_provider_name(model)
        p = config.get_provider(model)
        provider = self._build_provider(
            model=model,
            provider_name=provider_name,
            api_key=p.api_key if p else None,
            api_base=config.get_api_base(model),
            extra_headers=p.extra_headers if p else None,
        )
        provider.generation = GenerationSettings(
            temperature=config.agents.defaults.temperature,
            max_tokens=config.agents.defaults.max_tokens,
            reasoning_effort=config.agents.defaults.reasoning_effort,
        )
        return provider

    def _make_provider_from_target(self, target_config: Dict[str, Any]):
        model = self._normalize_config_value(target_config.get("model")) or self.config.agents.defaults.model
        provider_name = self._normalize_config_value(target_config.get("provider"))
        if not provider_name and model and self.config:
            provider_name = self._normalize_config_value(self.config.get_provider_name(model))
        provider = self._build_provider(
            model=model,
            provider_name=provider_name,
            api_key=self._normalize_config_value(target_config.get("api_key")),
            api_base=self._normalize_config_value(target_config.get("api_base")),
            extra_headers=target_config.get("extra_headers"),
        )
        provider.generation = GenerationSettings(
            temperature=self.config.agents.defaults.temperature,
            max_tokens=self.config.agents.defaults.max_tokens,
            reasoning_effort=self.config.agents.defaults.reasoning_effort,
        )
        return provider

    async def start(self):
        if self._started:
            return
        if not self.agent:
            self.initialize()
        asyncio.create_task(self.agent.run())
        asyncio.create_task(self.cron.start())
        self._started = True

    async def stop(self):
        if self.agent:
            self.agent.stop()
            await self.agent.close_mcp()
        for agent in self._model_agent_cache.values():
            agent.stop()
            await agent.close_mcp()
        self._model_agent_cache.clear()
        if self.cron:
            self.cron.stop()
        self._started = False

    def _build_agent_for_provider(self, provider: Any, mcp_servers: dict | None = None) -> AgentLoop:
        return AgentLoop(
            bus=self.bus,
            provider=provider,
            workspace=self.config.workspace_path,
            model=provider.default_model,
            max_iterations=self.config.agents.defaults.max_tool_iterations,
            context_window_tokens=self.config.agents.defaults.context_window_tokens,
            web_search_config=self.config.tools.web.search,
            web_proxy=self.config.tools.web.proxy or None,
            exec_config=self.config.tools.exec,
            cron_service=self.cron,
            restrict_to_workspace=self.config.tools.restrict_to_workspace,
            session_manager=self.agent.sessions if self.agent else None,
            mcp_servers=mcp_servers if mcp_servers is not None else self.config.tools.mcp_servers,
            channels_config=self.config.channels,
            timezone=self.config.agents.defaults.timezone,
        )

    async def _get_or_create_model_agent(self, model_id: str | None, target_config: Dict[str, Any] | None, project_id: int | None = None) -> AgentLoop:
        normalized_model_id = self._normalize_model_id(model_id)
        cache_key = (normalized_model_id, project_id)
        async with self._model_agent_lock:
            cached = self._model_agent_cache.get(cache_key)
            if cached:
                return cached
            
            if target_config:
                provider = self._make_provider_from_target(target_config)
            else:
                provider = self._make_provider(self.config)

            mcp_servers_dict = dict(self.config.tools.mcp_servers) if self.config.tools.mcp_servers else {}
            if project_id is not None:
                from app.api.mcp import list_mcp_servers
                from nanobot.config.schema import MCPServerConfig
                servers = list_mcp_servers(project_id=project_id)
                for s in servers:
                    cfg = MCPServerConfig(
                        type=s.get("type"),
                        command=s.get("command") or "",
                        args=s.get("args") or [],
                        env=s.get("env") or {},
                        url=s.get("url") or "",
                        headers=s.get("headers") or {}
                    )
                    mcp_servers_dict[s["name"]] = cfg

            agent = self._build_agent_for_provider(provider, mcp_servers=mcp_servers_dict)
            self._register_custom_tools(agent, project_id=project_id)
            self._model_agent_cache[cache_key] = agent
            return agent

    async def process_message(
        self,
        message: str,
        session_id: str = "api:default",
        skill_ids: List[str] | None = None,
        model_id: str | None = None,
        project_id: int | None = None,
        on_progress: Callable[[str], Awaitable[None]] | None = None,
        on_stream: Callable[[str], Awaitable[None]] | None = None,
    ):
        if not self.agent:
            self.initialize()
        if not self._started:
            await self.start()
            
        if project_id is None:
            from app.core.session_alias_store import session_alias_store
            alias_info = session_alias_store.get_alias(session_id)
            if alias_info and alias_info.get("project_id"):
                project_id = alias_info.get("project_id")
                
        agent_to_use = self.agent
        need_custom_agent = False
        target_config = None

        selected_model_id = self._normalize_model_id(model_id)
        if selected_model_id:
            llm_configs = get_llm_configs()
            target_config = next(
                (item for item in llm_configs if self._normalize_model_id(item.get("id")) == selected_model_id),
                None,
            )

        if target_config is None:
            active_config = get_active_llm_config()
            if active_config and active_config.get("id"):
                selected_model_id = self._normalize_model_id(active_config.get("id"))
                target_config = active_config

        if target_config and self._need_custom_agent_for_target(target_config):
            need_custom_agent = True

        if project_id is not None:
            need_custom_agent = True

        if need_custom_agent:
            agent_to_use = await self._get_or_create_model_agent(selected_model_id, target_config, project_id)

        full_message = message
        # We no longer inject the full skill content into the user's message here,
        # because the skill is already available to the agent via its workspace/tools.
        # The routing instructions (System Prompt) injected in main.py are sufficient
        # to guide the agent to use the selected skills.

        session = agent_to_use.sessions.get_or_create(session_id)
        normalized_messages = self._normalize_session_messages(session.messages)
        if len(normalized_messages) != len(session.messages):
            session.messages = normalized_messages
            agent_to_use.sessions.save(session)

        response = await agent_to_use.process_direct(
            full_message,
            session_key=session_id,
            channel="api",
            chat_id=session_id,
            on_progress=on_progress,
            on_stream=on_stream,
        )
        return self._extract_response_text(response)

    def _normalize_session_messages(self, messages: List[Any]) -> List[dict[str, Any]]:
        normalized: List[dict[str, Any]] = []
        stack: List[Any] = list(messages)
        while stack:
            current = stack.pop(0)
            if isinstance(current, dict):
                normalized.append(current)
                continue
            if isinstance(current, list):
                stack = list(current) + stack
        return normalized

nanobot_service = NanobotIntegration()
