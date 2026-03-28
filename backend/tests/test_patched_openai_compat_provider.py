import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
NANOBOT_ROOT = REPO_ROOT / "nanobot"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(NANOBOT_ROOT) not in sys.path:
    sys.path.insert(0, str(NANOBOT_ROOT))

from app.core.llm_provider import build_llm_provider
from app.core.nanobot import NanobotIntegration
from app.core.patched_openai_compat_provider import PatchedOpenAICompatProvider


def test_build_llm_provider_uses_max_completion_tokens_for_gpt5() -> None:
    provider = build_llm_provider(
        model="gpt-5.4-nano",
        provider="openai",
        api_key="test-key",
        api_base="https://example.com/v1",
    )

    assert isinstance(provider, PatchedOpenAICompatProvider)
    kwargs = provider._build_kwargs(
        messages=[{"role": "user", "content": "hello"}],
        tools=None,
        model="gpt-5.4-nano",
        max_tokens=5,
        temperature=0,
        reasoning_effort=None,
        tool_choice=None,
    )

    assert kwargs["max_completion_tokens"] == 5
    assert "max_tokens" not in kwargs


def test_nanobot_provider_keeps_max_tokens_for_legacy_models() -> None:
    integration = NanobotIntegration()
    provider = integration._build_provider(
        model="gpt-4o-mini",
        provider_name="openai",
        api_key="test-key",
        api_base="https://example.com/v1",
        extra_headers=None,
    )

    assert isinstance(provider, PatchedOpenAICompatProvider)
    kwargs = provider._build_kwargs(
        messages=[{"role": "user", "content": "hello"}],
        tools=None,
        model="gpt-4o-mini",
        max_tokens=5,
        temperature=0,
        reasoning_effort=None,
        tool_choice=None,
    )

    assert kwargs["max_tokens"] == 5
    assert "max_completion_tokens" not in kwargs
