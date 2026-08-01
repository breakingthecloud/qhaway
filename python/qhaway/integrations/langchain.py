"""LangChain callback handler — records LLM spans for chat models."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from ..cost import calculate_cost
from ..trace import QhawayTrace, QhawaySpan

try:
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:  # pragma: no cover
    BaseCallbackHandler = object  # type: ignore[assignment,misc]


class QhawayCallbackHandler(BaseCallbackHandler):
    """Drop into LangChain LLMChain/ChatOpenAI via callbacks.

    Usage:
        from langchain_openai import ChatOpenAI
        from qhaway.integrations import QhawayCallbackHandler

        llm = ChatOpenAI(callbacks=[QhawayCallbackHandler(trace)])
    """

    raise_error = False

    def __init__(
        self,
        trace: QhawayTrace,
        agent_id: Optional[str] = None,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> None:
        self._trace = trace
        self._agent_id = agent_id
        self._user_id = user_id
        self._session_id = session_id
        self._pending: Dict[str, Dict[str, Any]] = {}

    def on_llm_start(
        self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any
    ) -> None:
        run_id = str(kwargs.get("run_id", ""))
        self._pending[run_id] = {"start": time.perf_counter(), "prompts": prompts}

    async def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        run_id = str(kwargs.get("run_id", ""))
        info = self._pending.pop(run_id, None)
        if info is None:
            return
        llm_output = getattr(response, "llm_output", None) or {}
        model = llm_output.get("model_name", "unknown")
        usage = llm_output.get("token_usage") or {}
        tokens_in = int(usage.get("prompt_tokens", 0) or 0)
        tokens_out = int(usage.get("completion_tokens", 0) or 0)
        cost = calculate_cost(model, tokens_in, tokens_out)
        await self._trace._record(
            QhawaySpan(
                id=run_id or make_id(),
                timestamp=now_iso(),
                model=model,
                provider="langchain",
                latency_ms=int((time.perf_counter() - info["start"]) * 1000),
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=cost if cost >= 0 else 0.0,
                user_id=self._user_id,
                session_id=self._session_id,
                agent_id=self._agent_id,
                success=True,
            )
        )

    async def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        run_id = str(kwargs.get("run_id", ""))
        info = self._pending.pop(run_id, None)
        if info is None:
            return
        await self._trace._record(
            QhawaySpan(
                id=run_id or make_id(),
                timestamp=now_iso(),
                model="unknown",
                provider="langchain",
                latency_ms=int((time.perf_counter() - info["start"]) * 1000),
                tokens_in=0,
                tokens_out=0,
                cost_usd=0.0,
                user_id=self._user_id,
                session_id=self._session_id,
                agent_id=self._agent_id,
                success=False,
                error=str(error),
            )
        )


def make_id() -> str:
    import uuid

    return uuid.uuid4().hex


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
