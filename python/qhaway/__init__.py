"""Qhaway — agent observability for Python.

Trace LLM calls, compute cost/latency/tokens, and export to Qhaway HTTP API,
OpenTelemetry, or local storage.

    from qhaway import QhawayTrace, console_storage
    from qhaway.integrations import OpenAIPatch

    trace = QhawayTrace(storage=console_storage)
    OpenAIPatch.apply(trace)  # auto-instrument all OpenAI calls
"""

from .trace import QhawayTrace, QhawaySpan, wrap
from .storage import (
    ConsoleStorage,
    MemoryStorage,
    HttpStorage,
    SqliteStorage,
    console_storage,
    CompositeStorage,
)
from .cost import calculate_cost, resolve_pricing, DEFAULT_PRICING

__version__ = "0.1.0"

__all__ = [
    "QhawayTrace",
    "QhawaySpan",
    "wrap",
    "ConsoleStorage",
    "MemoryStorage",
    "HttpStorage",
    "SqliteStorage",
    "CompositeStorage",
    "console_storage",
    "calculate_cost",
    "resolve_pricing",
    "DEFAULT_PRICING",
    "__version__",
]
