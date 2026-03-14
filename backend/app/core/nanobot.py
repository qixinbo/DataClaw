import asyncio
import sys
import os
from pathlib import Path
from typing import List

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

class NanobotIntegration:
    def __init__(self):
        self.agent: AgentLoop | None = None
        self.bus: MessageBus | None = None
        self.cron: CronService | None = None
        self.config: Config | None = None

    def initialize(self):
        self.config = load_config()
        self.bus = MessageBus()
        provider = self._make_provider(self.config)
        
        cron_store_path = get_cron_dir() / "jobs.json"
        self.cron = CronService(cron_store_path)
        
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

    def _make_provider(self, config: Config):
        # Logic adapted from nanobot/cli/commands.py
        model = config.agents.defaults.model
        provider_name = config.get_provider_name(model)
        p = config.get_provider(model)

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
        
        return LiteLLMProvider(
            api_key=p.api_key if p else None,
            api_base=config.get_api_base(model),
            default_model=model,
            extra_headers=p.extra_headers if p else None,
            provider_name=provider_name,
        )

    async def start(self):
        if not self.agent:
            self.initialize()
        # Start the agent loop in background
        asyncio.create_task(self.agent.run())
        asyncio.create_task(self.cron.start())

    async def stop(self):
        if self.agent:
            self.agent.stop()
            await self.agent.close_mcp()
        if self.cron:
            self.cron.stop()

    async def process_message(self, message: str, session_id: str = "api:default", skill_ids: List[str] | None = None):
        if not self.agent:
            self.initialize()
            await self.start()
            
        full_message = message
        if skill_ids:
            skills = load_skills()
            selected_skills = [s for s in skills if s["id"] in skill_ids]
            if selected_skills:
                # We inject skills as a runtime context block
                skill_context = "[Runtime Context — metadata only, not instructions]\n# Active Skills\n\n"
                for s in selected_skills:
                    skill_context += f"## {s['name']}\n{s.get('description', '')}\n{s['content']}\n\n"
                
                # Append user message after skills
                full_message = f"{skill_context}\n\n{message}"

        response = await self.agent.process_direct(
            full_message,
            session_key=session_id,
            channel="api",
            chat_id=session_id
        )
        return response

nanobot_service = NanobotIntegration()
