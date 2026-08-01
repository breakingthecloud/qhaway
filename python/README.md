# Qhaway — Agent Observability for Python

`pip install qhaway-trace` gives Python teams the same agent observability as the TypeScript SDK: auto-instrument LLM calls, track cost/latency/tokens per user/session, and export to the Qhaway HTTP API, OpenTelemetry, or a local SQLite database.

Zero required dependencies for core (`QhawayTrace` + storage). Framework adapters are optional extras.

## Install

```bash
pip install qhaway-trace               # core
pip install "qhaway-trace[openai]"     # + OpenAI auto-instrumentation
pip install "qhaway-trace[anthropic]"  # + Anthropic auto-instrumentation
pip install "qhaway-trace[langchain]"  # + LangChain callback handler
pip install "qhaway-trace[dev]"        # + test deps
```

## Quick Start

```python
import asyncio
from qhaway import QhawayTrace, console_storage

trace = QhawayTrace(storage=console_storage, agent_id="my-agent")

@trace.wrap(model="gpt-4o", provider="openai", user_id="abc")
async def call_llm(prompt: str) -> str:
    return "answer"

asyncio.run(call_llm("hello"))
# [Qhaway] ✓ gpt-4o (openai) | $0.0000 | 0→0 tok | 0ms user=abc
```

## Auto-instrument OpenAI

```python
from qhaway import QhawayTrace, console_storage
from qhaway.integrations import OpenAIPatch

trace = QhawayTrace(storage=console_storage)
patch = OpenAIPatch.apply(trace)  # patches chat.completions.create

import openai
client = openai.AsyncOpenAI()
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hi"}],
)
# Auto-captures model, tokens, latency, and cost from usage
patch.restore()  # remove instrumentation when done
```

## Anthropic

```python
from qhaway.integrations import AnthropicPatch

patch = AnthropicPatch.apply(trace, user_id="abc")

from anthropic import AsyncAnthropic
client = AsyncAnthropic()
msg = await client.messages.create(model="claude-sonnet-4", max_tokens=100, messages=[...])
```

## LangChain callback

```python
from langchain_openai import ChatOpenAI
from qhaway import QhawayTrace, console_storage
from qhaway.integrations import QhawayCallbackHandler

trace = QhawayTrace(storage=console_storage)
llm = ChatOpenAI(callbacks=[QhawayCallbackHandler(trace)])
await llm.ainvoke("hello")
```

## Storage backends

| Adapter | Best for | Import |
|---------|----------|--------|
| `ConsoleStorage` | Local dev / debug | `qhaway.console_storage` |
| `MemoryStorage` | Tests, in-process | `from qhaway import MemoryStorage` |
| `SqliteStorage` | Standalone, no cloud deps | `from qhaway import SqliteStorage` |
| `HttpStorage` | Export to Qhaway CF Worker API | `from qhaway import HttpStorage` |
| `CompositeStorage` | Fan out to multiple backends | `from qhaway import CompositeStorage` |

### Export to a Qhaway HTTP endpoint

```python
from qhaway import QhawayTrace, HttpStorage

trace = QhawayTrace(
    storage=HttpStorage("https://qhaway.api.dev", api_key="YOUR_KEY"),
)
```

### Local persistence (SQLite)

```python
from qhaway import QhawayTrace, SqliteStorage

trace = QhawayTrace(storage=SqliteStorage("agent.db"))
```

## CLI

```bash
qhaway stats                 # summary of last 24h from qhaway.db
qhaway stats --db agent.db --hours 48
```

```
Qhaway stats (last 24h, 125 spans)
  Total cost:   $1.2340
  Calls:        125
  Tokens:       15200 in / 6400 out
  Errors:       3
  Avg latency:  412ms
  Cost by model:
    gpt-4o                  $0.9120
    claude-sonnet-4         $0.3220
```

## Cost calculation

Built-in pricing for OpenAI, Anthropic, and Google models. No external dependency.

```python
from qhaway import calculate_cost, resolve_pricing

cost = calculate_cost("gpt-4o", tokens_in=1000, tokens_out=500)
pricing = resolve_pricing("claude-sonnet-4", provider="anthropic")
```

## Schema (matches TypeScript)

```python
from qhaway import QhawaySpan

span = QhawaySpan(
    id="...", timestamp="...", model="gpt-4o", provider="openai",
    latency_ms=120, tokens_in=150, tokens_out=42, cost_usd=0.0006,
    user_id="abc", session_id="sess-1", agent_id="my-agent",
    tool_name=None, success=True, error=None, metadata={"env": "prod"},
)
```

## FastAPI example

```python
from fastapi import FastAPI
from qhaway import QhawayTrace, console_storage

app = FastAPI()
trace = QhawayTrace(storage=console_storage, agent_id="fastapi-agent")

@app.post("/chat")
async def chat(prompt: str, user_id: str):
    @trace.wrap(model="gpt-4o", provider="openai", user_id=user_id)
    async def _call(p: str) -> str:
        # your LLM call here
        return "reply"
    return {"reply": await _call(prompt)}
```

## Development

```bash
cd python
python -m pip install -e ".[dev]"
python -m pytest
```

## License

Apache 2.0
