from __future__ import annotations

from typing import Any

from nanobot.providers.openai_compat_provider import OpenAICompatProvider


class PatchedOpenAICompatProvider(OpenAICompatProvider):
    _MAX_COMPLETION_TOKEN_MODELS = ("gpt-5", "o1", "o3", "o4")

    def _build_kwargs(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str | None,
        max_tokens: int,
        temperature: float,
        reasoning_effort: str | None,
        tool_choice: str | dict[str, Any] | None,
    ) -> dict[str, Any]:
        kwargs = super()._build_kwargs(
            messages=messages,
            tools=tools,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            reasoning_effort=reasoning_effort,
            tool_choice=tool_choice,
        )

        model_name = (model or self.default_model or "").lower()
        spec = self._spec
        supports_max_completion_tokens = bool(
            spec and getattr(spec, "supports_max_completion_tokens", False)
        )
        should_use_max_completion_tokens = supports_max_completion_tokens or any(
            token in model_name for token in self._MAX_COMPLETION_TOKEN_MODELS
        )

        if should_use_max_completion_tokens and "max_tokens" in kwargs:
            kwargs["max_completion_tokens"] = kwargs.pop("max_tokens")

        return kwargs
