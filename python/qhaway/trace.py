"""Core span schema and tracing wrapper — mirrors the TypeScript QhawayTrace."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

SpanMetadata = Dict[str, Any]


@dataclass
class QhawaySpan:
    """A single LLM call (or tool execution) trace record."""

    id: str
    timestamp: str
    model: str
    provider: str
    latency_ms: int
    tokens_in: int
    tokens_out: int
    cost_usd: float
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    agent_id: Optional[str] = None
    tool_name: Optional[str] = None
    success: bool = True
    error: Optional[str] = None
    metadata: Optional[SpanMetadata] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class Storage:
    """Base storage interface — write a span, optionally query."""

    async def write(self, span: QhawaySpan) -> None:
        raise NotImplementedError

    async def query(self, **filters: Any) -> List[QhawaySpan]:
        raise NotImplementedError

    async def close(self) -> None:
        pass


class QhawayTrace:
    """Wraps async functions to capture LLM spans.

    Usage:
        trace = QhawayTrace(storage=console_storage)

        @trace.wrap(model="gpt-4o", provider="openai", user_id="abc")
        async def call_llm(prompt: str) -> str:
            ...
    """

    def __init__(self, storage: Storage, **default_meta: Any) -> None:
        self._storage = storage
        self._default_meta: Dict[str, Any] = default_meta

    @property
    def storage(self) -> Storage:
        return self._storage

    def wrap(self, fn: Callable[..., Any] = None, **meta: Any):
        """Decorator that records a span around the wrapped coroutine.

        Can be used with explicit kwargs (`@trace.wrap(model="gpt-4o")`) or
        directly as `@trace.wrap` with the coroutine receiving metadata via
        keyword args (`trace.wrap(func, model=..., user_id=...)`).
        """

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                span_meta = {**self._default_meta, **meta}
                merged_meta = dict(span_meta)
                merged_meta.update(kwargs.pop("_qhaway_meta", {}))

                start = time.perf_counter()
                try:
                    result = await func(*args, **kwargs)
                except Exception as exc:
                    await self._record(
                        QhawaySpan(
                            id=uuid.uuid4().hex,
                            timestamp=now_iso(),
                            model=str(merged_meta.get("model") or "unknown"),
                            provider=str(merged_meta.get("provider") or "unknown"),
                            latency_ms=int((time.perf_counter() - start) * 1000),
                            tokens_in=int(merged_meta.get("tokens_in", 0)),
                            tokens_out=int(merged_meta.get("tokens_out", 0)),
                            cost_usd=float(merged_meta.get("cost_usd", 0.0)),
                            user_id=merged_meta.get("user_id"),
                            session_id=merged_meta.get("session_id"),
                            agent_id=merged_meta.get("agent_id"),
                            tool_name=merged_meta.get("tool_name"),
                            success=False,
                            error=str(exc),
                            metadata=merged_meta.get("metadata"),
                        )
                    )
                    raise
                else:
                    await self._record(
                        QhawaySpan(
                            id=uuid.uuid4().hex,
                            timestamp=now_iso(),
                            model=str(merged_meta.get("model") or "unknown"),
                            provider=str(merged_meta.get("provider") or "unknown"),
                            latency_ms=int((time.perf_counter() - start) * 1000),
                            tokens_in=int(merged_meta.get("tokens_in", 0)),
                            tokens_out=int(merged_meta.get("tokens_out", 0)),
                            cost_usd=float(merged_meta.get("cost_usd", 0.0)),
                            user_id=merged_meta.get("user_id"),
                            session_id=merged_meta.get("session_id"),
                            agent_id=merged_meta.get("agent_id"),
                            tool_name=merged_meta.get("tool_name"),
                            success=True,
                            metadata=merged_meta.get("metadata"),
                        )
                    )
                    return result

            wrapper.__name__ = getattr(fn, "__name__", "wrapped") if fn else wrapper.__name__
            return wrapper

        if fn is not None:
            # Used as @trace.wrap directly on the function (no kwargs)
            return decorator(fn)
        return decorator

    async def record(self, span: QhawaySpan) -> None:
        await self._storage.write(span)

    async def _record(self, span: QhawaySpan) -> None:
        await self._storage.write(span)

    async def close(self) -> None:
        await self._storage.close()


def wrap(fn: Callable[..., Any], **meta: Any) -> Callable[..., Any]:
    """Convenience: wrap with an inline storage.

    Returns a decorator bound to a fresh ConsoleStorage-backed trace.
    """
    from .storage import console_storage

    trace = QhawayTrace(storage=console_storage)
    return trace.wrap(fn, **meta)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
