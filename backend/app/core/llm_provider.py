from typing import Optional, Dict

from nanobot.providers.azure_openai_provider import AzureOpenAIProvider
from nanobot.providers.openai_codex_provider import OpenAICodexProvider
from nanobot.providers.openai_compat_provider import OpenAICompatProvider
from nanobot.providers.registry import find_by_name


def normalize_provider_name(provider: Optional[str]) -> Optional[str]:
    if not provider:
        return None
    normalized = provider.strip().lower()
    alias_map = {
        "azure": "azure_openai",
        "local": "vllm",
    }
    return alias_map.get(normalized, normalized)


def build_llm_provider(
    *,
    model: str,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    extra_headers: Optional[Dict[str, str]] = None,
):
    provider_name = normalize_provider_name(provider)
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
