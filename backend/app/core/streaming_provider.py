import contextvars
import json
from typing import Any, Dict, List, Optional
from loguru import logger
from nanobot.providers.litellm_provider import LiteLLMProvider
from nanobot.providers.base import LLMResponse
from litellm import acompletion, stream_chunk_builder

streaming_queue_var = contextvars.ContextVar("streaming_queue", default=None)

class StreamingLiteLLMProvider(LiteLLMProvider):
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

        kwargs: Dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,  # 强制开启流式
        }
        
        if self.api_key and self.api_key != "no-key":
            kwargs["api_key"] = self.api_key
        if self.api_base:
            kwargs["api_base"] = self.api_base
        if self.extra_headers:
            kwargs["extra_headers"] = self.extra_headers
        if tools:
            kwargs["tools"] = tools
        if request_timeout is not None:
            kwargs["timeout"] = request_timeout
        if num_retries is not None:
            kwargs["num_retries"] = max(0, int(num_retries))

        if reasoning_effort and self._supports_reasoning_effort(model_name):
            kwargs["reasoning_effort"] = reasoning_effort

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
