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
from nanobot.bus.queue import MessageBus
from nanobot.config.loader import load_config
from nanobot.config.paths import get_cron_dir
from nanobot.cron.service import CronService
from nanobot.providers.openai_codex_provider import OpenAICodexProvider
from nanobot.providers.azure_openai_provider import AzureOpenAIProvider
from nanobot.providers.litellm_provider import LiteLLMProvider
from nanobot.providers.custom_provider import CustomProvider
from nanobot.providers.registry import find_by_name
from nanobot.session.manager import SessionManager
from nanobot.config.schema import Config

# Import skills loader
# We use a lazy import inside the method to avoid potential circular dependencies if any arise,
# or just import here if we are confident.
# Given the structure, importing here should be fine as long as skills.py doesn't import nanobot.py.
from app.api.skills import load_skills
from app.services.llm_cache import get_llm_configs

from app.core.streaming_provider import StreamingLiteLLMProvider

class NanobotIntegration:
    def __init__(self):
        self.agent: AgentLoop | None = None
        self.bus: MessageBus | None = None
        self.cron: CronService | None = None
        self.config: Config | None = None
        self._started = False
        self._model_agent_cache: Dict[str, AgentLoop] = {}
        self._model_agent_lock = asyncio.Lock()

    def initialize(self):
        # Set workspace path to backend/data/workspace
        workspace_path = Path(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "workspace"))
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
            temperature=self.config.agents.defaults.temperature,
            max_tokens=self.config.agents.defaults.max_tokens,
            max_iterations=self.config.agents.defaults.max_tool_iterations,
            memory_window=self.config.agents.defaults.memory_window,
            reasoning_effort=self.config.agents.defaults.reasoning_effort,
            brave_api_key=self.config.tools.web.search.api_key or None,
            web_proxy=self.config.tools.web.proxy or None,
            exec_config=self.config.tools.exec,
            cron_service=self.cron,
            restrict_to_workspace=self.config.tools.restrict_to_workspace,
            session_manager=session_manager,
            mcp_servers=self.config.tools.mcp_servers,
            channels_config=self.config.channels,
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

    def _register_custom_tools(self, agent: AgentLoop):
        from app.tools.nl2sql import NL2SQLTool
        from app.tools.visualization import VisualizationTool
        agent.tools.register(NL2SQLTool())
        agent.tools.register(VisualizationTool())

    def _make_provider(self, config: Config):
        # Logic adapted from nanobot/cli/commands.py
        model = config.agents.defaults.model
        provider_name = config.get_provider_name(model)
        p = config.get_provider(model)

        # Check if model is using an ID from our database configuration
        # This requires accessing the database or a cache of LLM configs
        # Since we are inside NanobotIntegration, we can try to load from the JSON file directly for simplicity
        # or rely on the caller to have injected the right config if they used environment variables.
        # But here we need to support dynamic loading based on the `model` string if it matches a stored config ID.
        
        # However, typically the `model` passed here comes from `config.agents.defaults.model`.
        # If we want to support dynamic switching per request, we should look at `agent.process_direct` arguments.
        # The `AgentLoop` initializes with a provider, but `LiteLLMProvider` might be able to handle dynamic models if we pass them.
        # BUT `LiteLLMProvider` is initialized with a specific `default_model`.
        
        # To support per-request model changes, we need to ensure the `provider` object or the `agent` can accept a model override.
        # `AgentLoop` methods like `process_direct` don't typically take a `model` argument to override the provider's default.
        # We might need to reinstantiate the provider or use a "DynamicProvider" that delegates based on context.
        
        # For now, let's assume standard initialization. 
        # If the user provides a `model_id` in `process_message`, we will handle it there by creating a temporary provider/agent or updating the current one.
        
        if provider_name == "openai_codex" or model.startswith("openai-codex/"):
            return OpenAICodexProvider(default_model=model)

        if provider_name == "custom":
            return CustomProvider(
                api_key=p.api_key if p else "no-key",
                api_base=config.get_api_base(model) or "http://localhost:8000/v1",
                default_model=model,
            )

        if provider_name == "azure_openai":
            if not p or not p.api_key or not p.api_base:
                raise ValueError("Azure OpenAI requires api_key and api_base.")
            
            return AzureOpenAIProvider(
                api_key=p.api_key,
                api_base=p.api_base,
                default_model=model,
            )

        spec = find_by_name(provider_name)
        # Skip API key check for now to allow initialization without full config
        
        return StreamingLiteLLMProvider(
            api_key=p.api_key if p else None,
            api_base=config.get_api_base(model),
            default_model=model,
            extra_headers=p.extra_headers if p else None,
            provider_name=provider_name,
        )

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

    def _build_agent_for_provider(self, provider: Any) -> AgentLoop:
        return AgentLoop(
            bus=self.bus,
            provider=provider,
            workspace=self.config.workspace_path,
            model=provider.default_model,
            temperature=self.config.agents.defaults.temperature,
            max_tokens=self.config.agents.defaults.max_tokens,
            max_iterations=self.config.agents.defaults.max_tool_iterations,
            memory_window=self.config.agents.defaults.memory_window,
            reasoning_effort=self.config.agents.defaults.reasoning_effort,
            brave_api_key=self.config.tools.web.search.api_key or None,
            web_proxy=self.config.tools.web.proxy or None,
            exec_config=self.config.tools.exec,
            cron_service=self.cron,
            restrict_to_workspace=self.config.tools.restrict_to_workspace,
            session_manager=self.agent.sessions,
            mcp_servers=self.config.tools.mcp_servers,
            channels_config=self.config.channels,
        )

    async def _get_or_create_model_agent(self, model_id: str, target_config: Dict[str, Any]) -> AgentLoop:
        async with self._model_agent_lock:
            cached = self._model_agent_cache.get(model_id)
            if cached:
                return cached
            provider = StreamingLiteLLMProvider(
                api_key=target_config.get("api_key"),
                api_base=target_config.get("api_base"),
                default_model=target_config.get("model"),
                extra_headers=target_config.get("extra_headers"),
                provider_name=target_config.get("provider"),
            )
            agent = self._build_agent_for_provider(provider)
            self._register_custom_tools(agent)
            self._model_agent_cache[model_id] = agent
            return agent

    async def process_message(
        self,
        message: str,
        session_id: str = "api:default",
        skill_ids: List[str] | None = None,
        model_id: str | None = None,
        on_progress: Callable[[str], Awaitable[None]] | None = None,
    ):
        if not self.agent:
            self.initialize()
        if not self._started:
            await self.start()
            
        # Handle dynamic model switching
        # If model_id is provided, we need to fetch its config and create a temporary provider
        # or update the current agent's provider context for this request.
        # Since AgentLoop is stateful and tied to a provider, and we want to avoid recreating the whole agent for every request if possible,
        # but changing the provider/model is a significant change.
        #
        # A simpler approach for this "stateless API" usage pattern:
        # We can instantiate a lightweight version of the agent or provider just for this request if the model differs.
        # OR, since we are using `process_direct`, we can check if `AgentLoop` supports overriding the model.
        # Looking at `nanobot/agent/loop.py` (assumed), it uses `self.provider.completion(...)`.
        
        # Strategy: 
        # 1. Load the model config from our JSON file using `model_id`.
        # 2. Construct a temporary provider instance for this model.
        # 3. Inject this provider into the agent for this request OR (cleaner) instantiate a temporary agent.
        #    Instantiating a whole AgentLoop might be heavy due to MCP/Cron etc.
        #    BUT `process_direct` is relatively isolated.
        #
        # Let's try to fetch the config first.
        agent_to_use = self.agent
        if model_id:
            llm_configs = get_llm_configs()
            target_config = next((item for item in llm_configs if item.get("id") == model_id), None)
            if target_config:
                if target_config.get("model") != self.agent.model:
                    agent_to_use = await self._get_or_create_model_agent(model_id, target_config)

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
        )
        return response

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
