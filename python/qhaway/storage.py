"""Storage backends for Qhaway spans.

- ConsoleStorage: pretty-print to stdout (dev/debug)
- MemoryStorage: in-process list (tests, short-lived)
- HttpStorage: POST spans to a Qhaway CF Worker HTTP API
- SqliteStorage: local persistence, no cloud deps
- CompositeStorage: fan out to multiple storages
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import threading
from typing import Any, Dict, List, Optional

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

from .trace import QhawaySpan, Storage

CONSOLE_COLORS = {
    "ok": "\033[92m",
    "warn": "\033[93m",
    "err": "\033[91m",
    "dim": "\033[2m",
    "reset": "\033[0m",
}


class ConsoleStorage(Storage):
    """Prints each span as a single human-readable line."""

    async def write(self, span: QhawaySpan) -> None:
        status = "✓" if span.success else "✗"
        color = "ok" if span.success else "err"
        cost = f"${span.cost_usd:.4f}"
        tokens = f"{span.tokens_in}→{span.tokens_out} tok"
        who = f" user={span.user_id}" if span.user_id else ""
        session = f" session={span.session_id}" if span.session_id else ""
        tool = f" tool={span.tool_name}" if span.tool_name else ""
        line = (
            f"[Qhaway] {status} {span.model} ({span.provider}) | "
            f"{cost} | {tokens} | {span.latency_ms}ms{who}{session}{tool}"
        )
        print(f"{CONSOLE_COLORS[color]}{line}{CONSOLE_COLORS['reset']}")
        if span.error:
            print(f"{CONSOLE_COLORS['err']}  └─ {span.error}{CONSOLE_COLORS['reset']}")

    async def query(self, **filters: Any) -> List[QhawaySpan]:
        return []


console_storage = ConsoleStorage()


class MemoryStorage(Storage):
    def __init__(self, max_spans: Optional[int] = None) -> None:
        self._spans: List[QhawaySpan] = []
        self._max_spans = max_spans

    async def write(self, span: QhawaySpan) -> None:
        self._spans.append(span)
        if self._max_spans and len(self._spans) > self._max_spans:
            self._spans = self._spans[-self._max_spans :]

    async def query(self, **filters: Any) -> List[QhawaySpan]:
        result = self._spans
        for key, value in filters.items():
            if value is not None:
                result = [s for s in result if getattr(s, key, None) == value]
        return list(result)

    @property
    def spans(self) -> List[QhawaySpan]:
        return list(self._spans)


class HttpStorage(Storage):
    """POSTs spans to a Qhaway-compatible HTTP endpoint.

    Expected API: POST {base_url}/spans  with JSON body = span.to_dict().
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: float = 10.0,
        batch: int = 1,
    ) -> None:
        if httpx is None:
            raise ImportError("HttpStorage requires httpx: pip install qhaway[http]")
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._batch = batch
        self._pending: List[QhawaySpan] = []
        self._lock = asyncio.Lock()

    async def write(self, span: QhawaySpan) -> None:
        async with self._lock:
            self._pending.append(span)
            if len(self._pending) >= self._batch:
                pending = self._pending
                self._pending = []
            else:
                return
        await self._post(pending)

    async def flush(self) -> None:
        async with self._lock:
            pending = self._pending
            self._pending = []
        if pending:
            await self._post(pending)

    async def _post(self, spans: List[QhawaySpan]) -> None:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/spans",
                json=[s.to_dict() for s in spans],
                headers=headers,
            )
            resp.raise_for_status()

    async def close(self) -> None:
        await self.flush()


class SqliteStorage(Storage):
    """Persists spans to a local SQLite file. Zero cloud dependencies."""

    def __init__(self, path: Optional[str] = None, table: str = "qhaway_spans") -> None:
        self._path = path or os.environ.get("QHAWAY_DB") or "qhaway.db"
        self._table = table
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._path)
        self._conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._table} (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                model TEXT,
                provider TEXT,
                latency_ms INTEGER,
                tokens_in INTEGER,
                tokens_out INTEGER,
                cost_usd REAL,
                user_id TEXT,
                session_id TEXT,
                agent_id TEXT,
                tool_name TEXT,
                success INTEGER,
                error TEXT,
                metadata TEXT
            )
            """
        )
        self._conn.commit()

    async def write(self, span: QhawaySpan) -> None:
        with self._lock:
            self._conn.execute(
                f"""
                INSERT OR REPLACE INTO {self._table}
                (id, timestamp, model, provider, latency_ms, tokens_in, tokens_out,
                 cost_usd, user_id, session_id, agent_id, tool_name, success, error, metadata)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    span.id,
                    span.timestamp,
                    span.model,
                    span.provider,
                    span.latency_ms,
                    span.tokens_in,
                    span.tokens_out,
                    span.cost_usd,
                    span.user_id,
                    span.session_id,
                    span.agent_id,
                    span.tool_name,
                    1 if span.success else 0,
                    span.error,
                    json.dumps(span.metadata) if span.metadata else None,
                ),
            )
            self._conn.commit()

    async def query(self, **filters: Any) -> List[QhawaySpan]:
        where, params = [], []
        allowed = {f.name for f in QhawaySpan.__dataclass_fields__.values()} - {"metadata"}
        for key, value in filters.items():
            if value is not None and key in allowed:
                where.append(f"{key} = ?")
                params.append(value)
        sql = f"SELECT * FROM {self._table}"
        if where:
            sql += " WHERE " + " AND ".join(where)
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        cols = [d[0] for d in self._conn.execute(f"SELECT * FROM {self._table} LIMIT 0").description]
        return [row_to_span(row, cols) for row in rows]

    async def close(self) -> None:
        with self._lock:
            self._conn.close()


class CompositeStorage(Storage):
    """Writes to every storage in the list; query merges all results."""

    def __init__(self, storages: List[Storage]) -> None:
        self._storages = storages

    async def write(self, span: QhawaySpan) -> None:
        await asyncio.gather(*(s.write(span) for s in self._storages))

    async def query(self, **filters: Any) -> List[QhawaySpan]:
        results = await asyncio.gather(*(s.query(**filters) for s in self._storages))
        merged: Dict[str, QhawaySpan] = {}
        for batch in results:
            for span in batch:
                merged[span.id] = span
        return list(merged.values())

    async def close(self) -> None:
        await asyncio.gather(*(s.close() for s in self._storages))


def row_to_span(row: Any, cols: List[str]) -> QhawaySpan:
    d = dict(zip(cols, row))
    return QhawaySpan(
        id=d["id"],
        timestamp=d["timestamp"],
        model=d["model"],
        provider=d["provider"] or "unknown",
        latency_ms=d["latency_ms"] or 0,
        tokens_in=d["tokens_in"] or 0,
        tokens_out=d["tokens_out"] or 0,
        cost_usd=d["cost_usd"] or 0.0,
        user_id=d.get("user_id"),
        session_id=d.get("session_id"),
        agent_id=d.get("agent_id"),
        tool_name=d.get("tool_name"),
        success=bool(d["success"]),
        error=d.get("error"),
        metadata=json.loads(d["metadata"]) if d.get("metadata") else None,
    )
