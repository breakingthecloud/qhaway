"""Monkey-patch OpenAI to auto-instrument chat.completions.create."""

from __future__ import annotations

import time
from typing import Any, Optional

from ..cost import calculate_cost
from ..trace import QhawayTrace, QhawaySpan


class OpenAIPatch:
    """Applies/removes OpenAI auto-instrumentation.

    Usage:
        from qhaway.integrations import OpenAIPatch

        patch = OpenAIPatch.apply(trace, user_id="abc")
        # ... run agent ...
        patch.restore()
    """

    _installed = False
    _original: Optional[Any] = None

    @classmethod
    def apply(cls, trace: QhawayTrace, **meta: Any) -> "OpenAIPatch":
        try:
            import openai.resources.chat.completions as completions_mod
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "OpenAIPatch requires the openai package: pip install qhaway[openai]"
            ) from exc

        original_create = completions_mod.Completions.create
        if getattr(original_create, "_qhaway_patched", False):
            return cls()

        cls._original = original_create

        async def patched_create(self: Any, *args: Any, **kwargs: Any) -> Any:
            model = kwargs.get("model", "unknown")
            provider = kwargs.get("_provider", "openai")
            start = time.perf_counter()
            try:
                response = await OpenAIPatch._original(self, *args, **kwargs)
            except Exception as exc:
                await trace._record(
                    QhawaySpan(
                        id=make_id(),
                        timestamp=now_iso(),
                        model=model,
                        provider=provider,
                        latency_ms=int((time.perf_counter() - start) * 1000),
                        tokens_in=0,
                        tokens_out=0,
                        cost_usd=0.0,
                        user_id=meta.get("user_id"),
                        session_id=meta.get("session_id"),
                        agent_id=meta.get("agent_id"),
                        success=False,
                        error=str(exc),
                    )
                )
                raise

            usage = getattr(response, "usage", None)
            tokens_in = int(getattr(usage, "prompt_tokens", 0) or 0)
            tokens_out = int(getattr(usage, "completion_tokens", 0) or 0)
            cost = calculate_cost(model, tokens_in, tokens_out, provider)
            await trace._record(
                QhawaySpan(
                    id=make_id(),
                    timestamp=now_iso(),
                    model=model,
                    provider=provider,
                    latency_ms=int((time.perf_counter() - start) * 1000),
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_usd=cost if cost >= 0 else 0.0,
                    user_id=meta.get("user_id"),
                    session_id=meta.get("session_id"),
                    agent_id=meta.get("agent_id"),
                    success=True,
                )
            )
            return response

        patched_create._qhaway_patched = True  # type: ignore[attr-defined]
        completions_mod.Completions.create = patched_create
        cls._installed = True
        return cls()

    @classmethod
    def restore(cls) -> None:
        if cls._original is not None:
            try:
                import openai.resources.chat.completions as completions_mod

                completions_mod.Completions.create = cls._original
            except ImportError:  # pragma: no cover
                pass
        cls._original = None
        cls._installed = False


def make_id() -> str:
    import uuid

    return uuid.uuid4().hex


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
