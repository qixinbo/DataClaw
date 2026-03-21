import contextvars
import json
from typing import Any, Dict, List, Optional
from loguru import logger
from nanobot.providers.litellm_provider import LiteLLMProvider
from nanobot.providers.base import LLMResponse
from litellm import acompletion, stream_chunk_builder

streaming_queue_var = contextvars.ContextVar("streaming_queue", default=None)

class StreamingLiteLLMProvider(LiteLLMProvider):
    def __init__(self, *args, **kwargs):
        self._provider_name_override = kwargs.get("provider_name")
        super().__init__(*args, **kwargs)

    def _get_active_spec(self, model: str):
        from nanobot.providers.registry import find_by_model, find_by_name
        spec = None
        if self._provider_name_override:
            spec = find_by_name(self._provider_name_override)
        if not spec:
            spec = find_by_model(model)
        return spec

    def _setup_env(self, api_key: str, api_base: str | None, model: str) -> None:
        """Set environment variables based on detected provider."""
        import os
        spec = self._gateway or self._get_active_spec(model)
        if not spec:
            return
        if not spec.env_key:
            return

        if self._gateway:
            os.environ[spec.env_key] = api_key
        else:
            os.environ.setdefault(spec.env_key, api_key)

        effective_base = api_base or spec.default_api_base
        for env_name, env_val in spec.env_extras:
            resolved = env_val.replace("{api_key}", api_key)
            resolved = resolved.replace("{api_base}", effective_base)
            os.environ.setdefault(env_name, resolved)

    def _resolve_model(self, model: str) -> str:
        """Resolve model name by applying provider/gateway prefixes, using override if available."""
        if self._gateway:
            prefix = self._gateway.litellm_prefix
            if self._gateway.strip_model_prefix:
                model = model.split("/")[-1]
            if prefix and not model.startswith(f"{prefix}/"):
                model = f"{prefix}/{model}"
            return model

        spec = self._get_active_spec(model)
        if spec and spec.litellm_prefix:
            model = self._canonicalize_explicit_prefix(model, spec.name, spec.litellm_prefix)
            if not any(model.startswith(s) for s in spec.skip_prefixes):
                model = f"{spec.litellm_prefix}/{model}"
        elif spec and not spec.litellm_prefix and "/" not in model:
            # For standard providers like openai, anthropic, litellm requires the prefix for unknown models
            # but registry sets litellm_prefix="" to rely on native matching. 
            # If native matching fails (e.g. non-standard model name), we should force prefix.
            # We only force prefix if provider was explicitly set and model has no prefix.
            if self._provider_name_override:
                model = f"{spec.name}/{model}"

        return model

    def _apply_model_overrides(self, model: str, kwargs: dict[str, Any]) -> None:
        """Apply model-specific parameter overrides from the registry."""
        model_lower = model.lower()
        spec = self._get_active_spec(model)
        if spec:
            for pattern, overrides in spec.model_overrides:
                if pattern in model_lower:
                    kwargs.update(overrides)
                    return

    def _extra_msg_keys(self, original_model: str, resolved_model: str) -> frozenset[str]:
        """Return provider-specific extra keys to preserve in request messages."""
        spec = self._get_active_spec(original_model) or self._get_active_spec(resolved_model)
        if (spec and spec.name == "anthropic") or "claude" in original_model.lower() or resolved_model.startswith("anthropic/"):
            # _ANTHROPIC_EXTRA_KEYS is defined in nanobot.providers.litellm_provider, let's just use the string
            return frozenset({"thinking_blocks"})
        return frozenset()

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
        reasoning_effort: Optional[str] = None,
        request_timeout: Optional[int] = None,
        num_retries: Optional[int] = None,
    ) -> LLMResponse:
        original_model = model or self.default_model
        model_name = self._resolve_model(original_model)
        extra_msg_keys = self._extra_msg_keys(original_model, model_name)

        if self._supports_cache_control(original_model):
            messages, tools = self._apply_cache_control(messages, tools)

        kwargs: Dict[str, Any] = {
            "model": model_name,
            "messages": self._sanitize_messages(self._sanitize_empty_content(messages), extra_keys=extra_msg_keys),
            "temperature": temperature,
            "max_tokens": max(1, max_tokens),
            "stream": True,  # 强制开启流式
        }

        self._apply_model_overrides(model_name, kwargs)
        
        if self.api_key and self.api_key != "no-key":
            kwargs["api_key"] = self.api_key
        if self.api_base:
            kwargs["api_base"] = self.api_base
        if self.extra_headers:
            kwargs["extra_headers"] = self.extra_headers
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if request_timeout is not None:
            kwargs["timeout"] = request_timeout
        if num_retries is not None:
            kwargs["num_retries"] = max(0, int(num_retries))

        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
            kwargs["drop_params"] = True

        try:
            response_stream = await acompletion(**kwargs)
            chunks = []
            queue = streaming_queue_var.get()
            
            async for chunk in response_stream:
                chunks.append(chunk)
                
                if queue is not None:
                    # 提取普通内容或 think 内容
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta:
                        content = getattr(delta, "content", None)
                        reasoning_content = getattr(delta, "reasoning_content", None)
                        
                        if content:
                            await queue.put({"type": "delta", "content": content})
                        if reasoning_content:
                            await queue.put({"type": "progress", "content": reasoning_content, "is_reasoning": True})
                            
            # 还原为完整的 response 对象供 nanobot 处理
            full_response = stream_chunk_builder(chunks, messages=messages)
            return self._parse_response(full_response)
            
        except Exception as e:
            logger.error("StreamingLiteLLMProvider failed: {}", e)
            raise
