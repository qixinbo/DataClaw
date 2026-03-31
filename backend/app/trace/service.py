from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Mapping, Optional

from app.trace.attributes import sanitize_attributes

logger = logging.getLogger(__name__)


class _NoopSpan:
    def set_attributes(self, _attributes: Optional[Mapping[str, Any]] = None) -> None:
        return None

    def update(self, **_kwargs: Any) -> None:
        return None

    def update_trace(self, **_kwargs: Any) -> None:
        return None

    def record_error(self, _exc: Exception, *, stage: str = "unknown") -> None:
        return None


class _SpanAdapter:
    def __init__(self, raw_span: Any) -> None:
        self._raw_span = raw_span

    def set_attributes(self, attributes: Optional[Mapping[str, Any]] = None) -> None:
        payload = sanitize_attributes(attributes)
        if not payload:
            return
        set_attribute = getattr(self._raw_span, "set_attribute", None)
        if callable(set_attribute):
            for key, value in payload.items():
                set_attribute(key, value)
            return
        update = getattr(self._raw_span, "update", None)
        if callable(update):
            update(metadata=payload)

    def update(self, **kwargs: Any) -> None:
        update = getattr(self._raw_span, "update", None)
        if callable(update):
            update(**kwargs)

    def update_trace(self, **kwargs: Any) -> None:
        update_trace = getattr(self._raw_span, "update_trace", None)
        if callable(update_trace):
            update_trace(**kwargs)

    def record_error(self, exc: Exception, *, stage: str = "unknown") -> None:
        self.set_attributes(
            {
                "error": True,
                "error.stage": stage,
                "error.type": exc.__class__.__name__,
                "error.message": str(exc),
            }
        )
        self.update(level="ERROR", status_message=str(exc))


class TraceService:
    def __init__(self) -> None:
        self._client: Any = None
        self._enabled = False
        self._initialized = False
        self._httpx_instrumented = False

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def initialized(self) -> bool:
        return self._initialized

    def _read_config(self) -> Dict[str, Optional[str]]:
        return {
            "public_key": os.getenv("LANGFUSE_PUBLIC_KEY"),
            "secret_key": os.getenv("LANGFUSE_SECRET_KEY"),
            "base_url": os.getenv("LANGFUSE_BASE_URL", "http://localhost:3000"),
        }

    def initialize(self) -> bool:
        if self._initialized:
            return self._enabled
            
        enable_tracing = os.getenv("ENABLE_TRACING", "false").lower() in ("true", "1", "t", "yes")
        if not enable_tracing:
            self._initialized = True
            self._enabled = False
            return False
            
        self._initialized = True
        cfg = self._read_config()
        if not cfg["public_key"] or not cfg["secret_key"]:
            logger.info("Langfuse tracing disabled: missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY")
            return False
        try:
            from langfuse import Langfuse
        except Exception as exc:
            logger.warning("Langfuse tracing disabled: SDK import failed: %s", exc)
            return False
        try:
            self._client = Langfuse(
                public_key=cfg["public_key"],
                secret_key=cfg["secret_key"],
                host=cfg["base_url"],
            )
            self._enabled = True
            logger.info("Langfuse tracing enabled, host=%s", cfg["base_url"])
        except Exception as exc:
            logger.warning("Langfuse tracing initialization failed, fallback to no-op: %s", exc)
            self._client = None
            self._enabled = False
            return False

        try:
            from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

            HTTPXClientInstrumentor().instrument()
            self._httpx_instrumented = True
        except Exception as exc:
            logger.warning("HTTPX OTEL instrumentation unavailable: %s", exc)
        return True

    def shutdown(self) -> None:
        if self._enabled and self._client:
            flush = getattr(self._client, "flush", None)
            if callable(flush):
                try:
                    flush()
                except Exception:
                    pass
            close = getattr(self._client, "shutdown", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass
        if self._httpx_instrumented:
            try:
                from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

                HTTPXClientInstrumentor().uninstrument()
            except Exception:
                pass
        self._client = None
        self._enabled = False
        self._initialized = False
        self._httpx_instrumented = False

    @contextmanager
    def start_span(
        self,
        name: str,
        *,
        attributes: Optional[Mapping[str, Any]] = None,
        input_payload: Optional[Any] = None,
    ) -> Iterator[_SpanAdapter | _NoopSpan]:
        if not self._enabled or not self._client:
            yield _NoopSpan()
            return
        try:
            start_observation = getattr(self._client, "start_as_current_observation", None)
            if callable(start_observation):
                ctx = start_observation(name=name, as_type="span")
            else:
                start_span = getattr(self._client, "start_as_current_span", None)
                if not callable(start_span):
                    yield _NoopSpan()
                    return
                ctx = start_span(name=name)
        except Exception:
            yield _NoopSpan()
            return
        try:
            with ctx as raw_span:
                span = _SpanAdapter(raw_span)
                if attributes:
                    span.set_attributes(attributes)
                if input_payload is not None:
                    span.update(input=input_payload)
                yield span
        except Exception as exc:
            logger.warning("Langfuse span failure (%s): %s", name, exc)
            yield _NoopSpan()


trace_service = TraceService()
