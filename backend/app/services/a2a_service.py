from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import ssl
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Dict, Iterable, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.models.a2a import (
    A2AAuditLog,
    A2AProjectConfig,
    A2ARemoteAgent,
    A2ATask,
    A2ATaskEvent,
    A2ATaskWebhook,
    A2AWebhookDelivery,
)
from app.models.project import Project
from app.schemas.a2a import (
    A2AArtifactSchema,
    A2APartSchema,
    A2ATaskStatusSchema,
    TaskArtifactUpdateEvent,
    TaskStatusUpdateEvent,
)
from app.trace import build_error_attributes, trace_service


def _json_loads(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _json_dumps(raw: Any) -> str:
    return json.dumps(raw, ensure_ascii=False)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _mask_error(message: str) -> str:
    if not message:
        return "internal_error"
    return "request_failed"


class SharedSecretAuth:
    @staticmethod
    def generate_signature(secret: str, payload: bytes, timestamp: Optional[int] = None) -> Tuple[str, int]:
        if timestamp is None:
            timestamp = int(time.time())
        message = f"{timestamp}".encode() + payload
        signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
        return f"sha256={signature}", timestamp

    @staticmethod
    def verify_signature(secret: str, payload: bytes, signature: str, timestamp: int, max_age_seconds: int = 300) -> bool:
        if abs(time.time() - timestamp) > max_age_seconds:
            return False
        expected_sig, _ = SharedSecretAuth.generate_signature(secret, payload, timestamp)
        return hmac.compare_digest(signature, expected_sig)

    @staticmethod
    def sign_request(secret: str, method: str, path: str, body: Optional[bytes] = None) -> Dict[str, str]:
        timestamp = int(time.time())
        payload = body or b""
        message = f"{timestamp}.{method.upper()}.{path}".encode() + payload
        signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
        return {
            "X-A2A-Signature": f"sha256={signature}",
            "X-A2A-Timestamp": str(timestamp),
        }


class MtlsConfig:
    def __init__(
        self,
        ca_cert: Optional[str] = None,
        client_cert: Optional[str] = None,
        client_key: Optional[str] = None,
    ):
        self.ca_cert = ca_cert
        self.client_cert = client_cert
        self.client_key = client_key

    def create_ssl_context(self) -> Optional[ssl.SSLContext]:
        if not self.client_cert or not self.client_key:
            return None
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.load_cert_chain(self.client_cert, self.client_key)
        if self.ca_cert:
            ctx.load_verify_locations(self.ca_cert)
            ctx.verify_mode = ssl.CERT_REQUIRED
        else:
            ctx.verify_mode = ssl.CERT_NONE
        return ctx


class OAuth2TokenStore:
    def __init__(self):
        self._tokens: Dict[str, Tuple[str, datetime]] = {}
        self._lock = asyncio.Lock()

    async def get_token(self, key: str) -> Optional[str]:
        async with self._lock:
            if key in self._tokens:
                token, expires_at = self._tokens[key]
                if expires_at > _utc_now() + timedelta(minutes=1):
                    return token
            return None

    async def set_token(self, key: str, token: str, expires_in: int = 3600) -> None:
        async with self._lock:
            self._tokens[key] = (token, _utc_now() + timedelta(seconds=expires_in))


class OAuth2Auth:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        token_url: str,
        scopes: Optional[List[str]] = None,
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_url = token_url
        self.scopes = scopes or []
        self._token_store = OAuth2TokenStore()

    def _get_cache_key(self) -> str:
        return f"{self.client_id}:{self.token_url}:{':'.join(self.scopes)}"

    async def get_access_token(self, grant_type: str = "client_credentials") -> str:
        cache_key = self._get_cache_key()
        cached = await self._token_store.get_token(cache_key)
        if cached:
            return cached

        async with httpx.AsyncClient() as client:
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "grant_type": grant_type,
            }
            if self.scopes:
                data["scope"] = " ".join(self.scopes)
            resp = await client.post(self.token_url, data=data)
            resp.raise_for_status()
            token_data = resp.json()
            token = token_data["access_token"]
            expires_in = token_data.get("expires_in", 3600)
            await self._token_store.set_token(cache_key, token, expires_in)
            return token

    async def authorize_request(self, method: str, url: str, **kwargs) -> Dict[str, str]:
        token = await self.get_access_token()
        return {"Authorization": f"Bearer {token}"}


class OIDCAuth:
    def __init__(
        self,
        issuer_url: str,
        client_id: str,
        client_secret: Optional[str] = None,
        scopes: Optional[List[str]] = None,
    ):
        self.issuer_url = issuer_url.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.scopes = scopes or ["openid", "profile"]
        self._oauth2: Optional[OAuth2Auth] = None
        self._discovery_cache: Optional[Dict[str, Any]] = None

    async def _get_discovery(self) -> Dict[str, Any]:
        if self._discovery_cache:
            return self._discovery_cache
        discovery_url = f"{self.issuer_url}/.well-known/openid-configuration"
        async with httpx.AsyncClient() as client:
            resp = await client.get(discovery_url)
            resp.raise_for_status()
            self._discovery_cache = resp.json()
            return self._discovery_cache

    async def get_access_token(self) -> str:
        discovery = await self._get_discovery()
        token_url = discovery.get("token_endpoint")
        if not token_url:
            raise RuntimeError("OIDC discovery missing token_endpoint")
        if not self._oauth2:
            self._oauth2 = OAuth2Auth(
                client_id=self.client_id,
                client_secret=self.client_secret or "",
                token_url=token_url,
                scopes=self.scopes,
            )
        return await self._oauth2.get_access_token()

    async def authorize_request(self, method: str, url: str, **kwargs) -> Dict[str, str]:
        token = await self.get_access_token()
        return {"Authorization": f"Bearer {token}"}


class RemoteAgentSecuritySelector:
    def __init__(self, agent: A2ARemoteAgent):
        self.agent = agent
        self._card_security_schemes: Optional[Dict[str, Any]] = None

    def load_security_from_card(self) -> None:
        card = _json_loads(self.agent.card_json, {})
        if card:
            self._card_security_schemes = card.get("securitySchemes", {})

    def get_preferred_auth_scheme(self) -> str:
        card = _json_loads(self.agent.card_json, {})
        security_reqs = card.get("security", [])
        if security_reqs:
            first_req = security_reqs[0]
            if isinstance(first_req, dict):
                for scheme_name in first_req.keys():
                    return scheme_name
        return self.agent.auth_scheme or "bearer"

    def get_auth_headers(self, user_token: Optional[str] = None) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        preferred = self.get_preferred_auth_scheme()

        if preferred == "bearer" or self.agent.auth_scheme == "bearer":
            if self.agent.auth_token:
                headers["Authorization"] = f"Bearer {self.agent.auth_token}"
            elif user_token:
                headers["Authorization"] = f"Bearer {user_token}"

        elif preferred == "shared_secret" or self.agent.auth_scheme == "shared_secret":
            pass

        elif preferred in ("oauth2", "oauth2_authorizationcode", "oauth2_clientcredentials"):
            pass

        elif preferred == "openIdConnect":
            pass

        elif preferred == "mutualTLS":
            pass

        return headers

    def get_mtls_context(self) -> Optional[ssl.SSLContext]:
        if self.agent.auth_scheme == "mutualTLS" or self.get_preferred_auth_scheme() == "mutualTLS":
            if self.agent.mtls_client_cert and self.agent.mtls_client_key:
                config = MtlsConfig(
                    ca_cert=self.agent.mtls_ca_cert,
                    client_cert=self.agent.mtls_client_cert,
                    client_key=self.agent.mtls_client_key,
                )
                return config.create_ssl_context()
        return None

    def create_signed_request_headers(
        self,
        method: str,
        path: str,
        body: Optional[bytes] = None,
    ) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        preferred = self.get_preferred_auth_scheme()

        if preferred == "shared_secret" and self.agent.shared_secret:
            sig_headers = SharedSecretAuth.sign_request(
                self.agent.shared_secret,
                method,
                path,
                body,
            )
            headers.update(sig_headers)

        elif self.agent.auth_scheme == "bearer" and self.agent.auth_token:
            headers["Authorization"] = f"Bearer {self.agent.auth_token}"

        return headers

    async def get_oauth2_auth(self) -> Optional[OAuth2Auth]:
        if self.agent.oauth2_client_id and self.agent.oauth2_token_url:
            scopes = self.agent.oauth2_scopes.split() if self.agent.oauth2_scopes else []
            return OAuth2Auth(
                client_id=self.agent.oauth2_client_id,
                client_secret=self.agent.oauth2_client_secret or "",
                token_url=self.agent.oauth2_token_url,
                scopes=scopes,
            )
        return None

    async def get_oidc_auth(self) -> Optional[OIDCAuth]:
        if self.agent.oidc_issuer_url:
            return OIDCAuth(
                issuer_url=self.agent.oidc_issuer_url,
                client_id=self.agent.oidc_client_id or "",
                client_secret=self.agent.oidc_client_secret,
                scopes=self.agent.oauth2_scopes.split() if self.agent.oauth2_scopes else [],
            )
        return None

    async def authorize_request(self, method: str, url: str, user_token: Optional[str] = None) -> Dict[str, str]:
        headers = self.get_auth_headers(user_token)
        preferred = self.get_preferred_auth_scheme()

        if preferred in ("oauth2", "oauth2_authorizationcode", "oauth2_clientcredentials"):
            oauth2_auth = await self.get_oauth2_auth()
            if oauth2_auth:
                headers.update(await oauth2_auth.authorize_request(method, url))

        elif preferred == "openIdConnect":
            oidc_auth = await self.get_oidc_auth()
            if oidc_auth:
                headers.update(await oidc_auth.authorize_request(method, url))

        return headers

_STATE_TRANSITIONS = {
    "SUBMITTED": {"WORKING", "FAILED", "CANCELED", "REJECTED", "AUTH_REQUIRED", "INPUT_REQUIRED", "COMPLETED"},
    "WORKING": {"COMPLETED", "FAILED", "CANCELED", "INPUT_REQUIRED", "AUTH_REQUIRED"},
    "INPUT_REQUIRED": {"WORKING", "FAILED", "CANCELED"},
    "AUTH_REQUIRED": {"WORKING", "FAILED", "CANCELED", "REJECTED"},
    "REJECTED": set(),
    "FAILED": set(),
    "COMPLETED": set(),
    "CANCELED": set(),
}
_TERMINAL_STATES = {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}


@dataclass
class A2AResolvedRoute:
    selected: str
    fallback_chain: List[str]
    canary_hit: bool
    reason: str


class A2AMetrics:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._counters: Dict[str, int] = defaultdict(int)
        self._latency_ms: Dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=2000))

    async def incr(self, key: str, value: int = 1) -> None:
        async with self._lock:
            self._counters[key] += value

    async def observe_latency(self, key: str, elapsed_ms: float) -> None:
        async with self._lock:
            self._latency_ms[key].append(float(elapsed_ms))

    async def snapshot(self) -> Dict[str, Any]:
        async with self._lock:
            counters = dict(self._counters)
            p95 = {}
            for key, values in self._latency_ms.items():
                series = sorted(values)
                if not series:
                    p95[f"{key}.p95_ms"] = 0.0
                    continue
                idx = int(0.95 * (len(series) - 1))
                p95[f"{key}.p95_ms"] = round(series[idx], 2)
            total = counters.get("a2a.requests.total", 0)
            errors = counters.get("a2a.requests.error", 0)
            retries = counters.get("a2a.requests.retry", 0)
            breakers = counters.get("a2a.circuit.open", 0)
            return {
                "counters": counters,
                "derived": {
                    "error_rate": round(errors / total, 4) if total else 0.0,
                    "retry_rate": round(retries / total, 4) if total else 0.0,
                    "circuit_open_rate": round(breakers / total, 4) if total else 0.0,
                },
                "latency": p95,
            }


class A2ARuntime:
    def __init__(self) -> None:
        self._subscribers: Dict[str, List[asyncio.Queue[Dict[str, Any]]]] = defaultdict(list)
        self.metrics = A2AMetrics()
        self.protocol_version = "1.0"
        self._circuit_state: Dict[int, datetime] = {}

    async def publish(self, task_id: str, event: Dict[str, Any]) -> None:
        queues = list(self._subscribers.get(task_id, []))
        for queue in queues:
            await queue.put(event)

    async def subscribe(self, task_id: str) -> AsyncIterator[Dict[str, Any]]:
        queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=200)
        self._subscribers[task_id].append(queue)
        try:
            while True:
                payload = await queue.get()
                yield payload
        finally:
            self._subscribers[task_id] = [q for q in self._subscribers.get(task_id, []) if q is not queue]
            if not self._subscribers[task_id]:
                self._subscribers.pop(task_id, None)

    def get_project_config(self, db: Session, project_id: int, user_id: int) -> A2AProjectConfig:
        item = db.query(A2AProjectConfig).filter(A2AProjectConfig.project_id == project_id).first()
        if item:
            return item
        config = A2AProjectConfig(project_id=project_id, updated_by=user_id)
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    def resolve_route(self, *, project_config: A2AProjectConfig, session_id: str, requested_mode: str, requested_fallback: Optional[List[str]]) -> A2AResolvedRoute:
        selected = requested_mode or project_config.route_mode_default or "local_first"
        fallback = requested_fallback or _json_loads(project_config.fallback_chain_json, ["local"])
        fallback_chain = [item for item in fallback if item in {"a2a", "local", "mcp"}]
        if not fallback_chain:
            fallback_chain = ["local"]
        canary_hit = False
        if project_config.canary_enabled and project_config.canary_percent > 0:
            digest = hashlib.sha256(f"{project_config.project_id}:{session_id}".encode()).hexdigest()
            bucket = int(digest[:8], 16) % 100
            canary_hit = bucket < project_config.canary_percent
        if selected in {"a2a_first", "a2a"} and not canary_hit:
            return A2AResolvedRoute(
                selected="local",
                fallback_chain=fallback_chain,
                canary_hit=False,
                reason="canary_not_hit_fallback_local",
            )
        if selected in {"a2a_first", "a2a"}:
            return A2AResolvedRoute(selected="a2a", fallback_chain=fallback_chain, canary_hit=canary_hit, reason="a2a_selected")
        if selected in {"mcp_first", "mcp"}:
            return A2AResolvedRoute(selected="mcp", fallback_chain=fallback_chain, canary_hit=canary_hit, reason="mcp_selected")
        return A2AResolvedRoute(selected="local", fallback_chain=fallback_chain, canary_hit=canary_hit, reason="local_selected")

    def can_transition(self, from_state: str, to_state: str) -> bool:
        if from_state == to_state:
            return True
        return to_state in _STATE_TRANSITIONS.get(from_state, set())

    def create_task(
        self,
        db: Session,
        *,
        project_id: int,
        tenant_id: int,
        source: str,
        input_text: str,
        idempotency_key: Optional[str],
        remote_agent_id: Optional[int],
        compatibility_mode: bool,
        metadata: Optional[Dict[str, Any]] = None,
        context_id: Optional[str] = None,
    ) -> A2ATask:
        if idempotency_key:
            existing = (
                db.query(A2ATask)
                .filter(
                    A2ATask.project_id == project_id,
                    A2ATask.tenant_id == tenant_id,
                    A2ATask.idempotency_key == idempotency_key,
                )
                .first()
            )
            if existing:
                return existing
        task = A2ATask(
            id=f"task_{uuid.uuid4().hex}",
            project_id=project_id,
            tenant_id=tenant_id,
            source=source,
            remote_agent_id=remote_agent_id,
            state="SUBMITTED",
            input_text=input_text,
            idempotency_key=idempotency_key,
            compatibility_mode=compatibility_mode,
            metadata_json=_json_dumps(metadata or {}),
            context_id=context_id,
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        return task

    def append_event(self, db: Session, task: A2ATask, event_type: str, payload: Dict[str, Any]) -> A2ATaskEvent:
        event = A2ATaskEvent(task_id=task.id, event_type=event_type, payload_json=_json_dumps(payload))
        db.add(event)
        db.commit()
        db.refresh(event)
        return event

    def transition_task(
        self,
        db: Session,
        task: A2ATask,
        *,
        to_state: str,
        output_text: Optional[str] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> A2ATask:
        if not self.can_transition(task.state, to_state):
            raise ValueError(f"Invalid task transition: {task.state} -> {to_state}")
        task.state = to_state
        if output_text is not None:
            task.output_text = output_text
        if error_message is not None:
            task.error_message = error_message
        if metadata is not None:
            task.metadata_json = _json_dumps(metadata)
        if to_state in _TERMINAL_STATES:
            task.finished_at = _utc_now()
        db.add(task)
        db.commit()
        db.refresh(task)
        return task

    def record_audit(
        self,
        db: Session,
        *,
        actor_user_id: int,
        action: str,
        target_type: str,
        target_id: str,
        result: str,
        project_id: Optional[int] = None,
        task_id: Optional[str] = None,
        detail: Optional[Dict[str, Any]] = None,
    ) -> None:
        audit = A2AAuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            result=result,
            project_id=project_id,
            task_id=task_id,
            detail_json=_json_dumps(detail or {}),
        )
        db.add(audit)
        db.commit()

    async def fetch_agent_card(self, db: Session, agent: A2ARemoteAgent, *, timeout_s: float = 10.0) -> Dict[str, Any]:
        if agent.id in self._circuit_state and self._circuit_state[agent.id] > _utc_now():
            raise RuntimeError("circuit_open")
        started = time.perf_counter()
        await self.metrics.incr("a2a.requests.total")
        headers = {}
        if agent.auth_scheme == "bearer" and agent.auth_token:
            headers["Authorization"] = f"Bearer {agent.auth_token}"
        url = f"{agent.base_url.rstrip('/')}/api/v1/a2a/agent-card"
        with trace_service.start_span("a2a.card.fetch", attributes={"agent_id": agent.id, "url": url}) as span:
            for attempt in range(3):
                try:
                    async with httpx.AsyncClient(timeout=timeout_s, verify=True) as client:
                        resp = await client.get(url, headers=headers)
                    if resp.status_code >= 400:
                        raise RuntimeError(f"http_{resp.status_code}")
                    payload = resp.json()
                    elapsed_ms = (time.perf_counter() - started) * 1000
                    await self.metrics.observe_latency("a2a.card.fetch", elapsed_ms)
                    agent.card_json = _json_dumps(payload)
                    agent.protocol_version = str(payload.get("protocol_version") or "")
                    agent.capabilities_json = _json_dumps(payload.get("capabilities") or [])
                    agent.card_fetched_at = _utc_now()
                    agent.healthy = True
                    agent.failure_count = 0
                    agent.circuit_open_until = None
                    db.add(agent)
                    db.commit()
                    db.refresh(agent)
                    return payload
                except Exception as exc:
                    span.set_attributes(build_error_attributes(exc, stage="a2a_card_fetch"))
                    await self.metrics.incr("a2a.requests.error")
                    if attempt < 2:
                        await self.metrics.incr("a2a.requests.retry")
                        await asyncio.sleep(0.2 * (2 ** attempt))
                        continue
                    agent.failure_count = (agent.failure_count or 0) + 1
                    if agent.failure_count >= 3:
                        reopen_at = _utc_now() + timedelta(seconds=90)
                        agent.circuit_open_until = reopen_at
                        self._circuit_state[agent.id] = reopen_at
                        await self.metrics.incr("a2a.circuit.open")
                    agent.healthy = False
                    db.add(agent)
                    db.commit()
                    raise

    async def notify_webhooks(self, db: Session, task: A2ATask, event: A2ATaskEvent) -> None:
        webhooks = db.query(A2ATaskWebhook).filter(A2ATaskWebhook.task_id == task.id, A2ATaskWebhook.enabled == True).all()
        if not webhooks:
            return
        for hook in webhooks:
            delivery = A2AWebhookDelivery(task_id=task.id, webhook_id=hook.id, event_id=event.id, attempt=0, status="PENDING")
            db.add(delivery)
            db.commit()
            db.refresh(delivery)
            await self._deliver_once(db, hook, event, delivery)

    async def _deliver_once(self, db: Session, hook: A2ATaskWebhook, event: A2ATaskEvent, delivery: A2AWebhookDelivery) -> None:
        event_payload = _json_loads(event.payload_json, {})
        stream_response_payload = self._build_stream_response_payload(event, event_payload)
        body = _json_dumps(stream_response_payload).encode("utf-8")

        for attempt in range(1, 5):
            delivery.attempt = attempt
            db.add(delivery)
            db.commit()

            headers = {"Content-Type": "application/json", "X-A2A-Event-Id": str(event.id)}
            if hook.secret:
                digest = hmac.new(hook.secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
                headers["X-A2A-Signature"] = f"sha256={digest}"
            if hook.auth_header:
                headers["Authorization"] = hook.auth_header

            try:
                async with httpx.AsyncClient(timeout=8.0, verify=True) as client:
                    resp = await client.post(hook.target_url, content=body, headers=headers)
                delivery.response_code = resp.status_code
                delivery.response_body = (resp.text or "")[:1000]
                if 200 <= resp.status_code < 300:
                    delivery.status = "DELIVERED"
                    delivery.dead_letter = False
                    delivery.delivered_at = _utc_now()
                    db.add(delivery)
                    db.commit()
                    return
                raise RuntimeError(f"http_{resp.status_code}")
            except Exception as exc:
                delivery.error_message = str(exc)[:500]
                if attempt < 4:
                    backoff_seconds = 2 ** attempt
                    delivery.status = "RETRYING"
                    delivery.next_retry_at = _utc_now() + timedelta(seconds=backoff_seconds)
                    db.add(delivery)
                    db.commit()
                    await asyncio.sleep(backoff_seconds)
                    continue
                delivery.status = "FAILED"
                delivery.dead_letter = True
                db.add(delivery)
                db.commit()
                return

    def _build_stream_response_payload(self, event: A2ATaskEvent, event_payload: Dict[str, Any]) -> Dict[str, Any]:
        event_type = event.event_type
        task_id = event_payload.get("task_id", event.task_id)

        if event_type == "TaskStatusUpdateEvent":
            status_state = event_payload.get("task_status", "WORKING")
            status_timestamp = event_payload.get("timestamp", _utc_now().isoformat())
            status_schema = A2ATaskStatusSchema(
                state=status_state,
                timestamp=datetime.fromisoformat(status_timestamp) if isinstance(status_timestamp, str) else status_timestamp,
            )
            return {
                "statusUpdate": TaskStatusUpdateEvent(
                    taskId=task_id,
                    contextId=event_payload.get("context_id"),
                    status=status_schema,
                    metadata=event_payload.get("metadata", {}),
                ).model_dump()
            }
        elif event_type == "TaskArtifactUpdateEvent":
            artifact_content = event_payload.get("artifact", {}).get("content", "")
            artifact_schema = A2AArtifactSchema(
                artifactId=f"artifact-{event.id}",
                parts=[A2APartSchema(part_type="text", text=artifact_content)],
            )
            return {
                "artifactUpdate": TaskArtifactUpdateEvent(
                    taskId=task_id,
                    contextId=event_payload.get("context_id"),
                    artifact=artifact_schema,
                    append=False,
                    lastChunk=True,
                ).model_dump()
            }
        else:
            return {"message": event_payload}


a2a_runtime = A2ARuntime()
