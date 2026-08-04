<p align="center">
  <img alt="Qhaway" src="https://img.shields.io/badge/👁️-Qhaway-8B5CF6?style=for-the-badge" height="50">
</p>

<p align="center">
  <b>Agent Observability</b><br>
  Trace, cost, OTEL export, and Grafana dashboards for AI agents. Zero dependencies.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#modules">Modules</a>
  ·
  <a href="#exporters">Exporters</a>
  ·
  <a href="#ecosystem">Ecosystem</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/@carloscortezcloud/qhaway?style=flat-square&logo=npm&color=8B5CF6" alt="npm">
  <img src="https://img.shields.io/badge/license-Apache_2.0-8B5CF6?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/TypeScript-5.5%2B-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/dependencies-0-success?style=flat-square" alt="Zero deps">
  <img src="https://img.shields.io/badge/works-CF_Workers-8B5CF6?style=flat-square&logo=cloudflare" alt="CF Workers">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs">
</p>

---

## What Is Qhaway?

Qhaway (Quechua: "to observe/watch") wraps every LLM call your agent makes and captures cost, latency, token usage, and model info. Export to OpenTelemetry, Prometheus, or MLflow. Works in Cloudflare Workers, Node.js, Deno, Bun.

```typescript
import { QhawayTrace, ConsoleStorage } from '@carloscortezcloud/qhaway/trace';

const trace = new QhawayTrace(new ConsoleStorage(), { agent_id: 'my-agent' });

const wrapped = trace.wrap(myLlmCall, { model: 'gpt-4o', provider: 'openai', user_id: 'abc' });
const result = await wrapped(prompt);

// Console output:
// [Qhaway] ✓ gpt-4o (openai) | $0.00063 | 150→42 tok | 1234ms | user=abc
```

## Install

```bash
npm install @carloscortezcloud/qhaway
```

## Quick Start

```typescript
import { QhawayTrace, ConsoleStorage } from '@carloscortezcloud/qhaway/trace';

const trace = new QhawayTrace(new ConsoleStorage(), { agent_id: 'my-agent' });
const wrapped = trace.wrap(myLlmCall, { model: 'gpt-4o', provider: 'openai', user_id: 'abc' });
const result = await wrapped(prompt);
```

## Modules

Qhaway is a single package with subpath exports — import only what you need:

| Import path | What |
|-------------|------|
| `@carloscortezcloud/qhaway` | All-in-one entry |
| `@carloscortezcloud/qhaway/trace` | Span wrapper + storage (D1/KV/Console) |
| `@carloscortezcloud/qhaway/cost` | Pricing DB + cost attribution |
| `@carloscortezcloud/qhaway/otel` | OTLP/HTTP JSON exporter |
| `@carloscortezcloud/qhaway/tinkuy` | Auto-instrument TinkuyAgent |
| `@carloscortezcloud/qhaway/mlflow` | MLflow metrics exporter |
| `@carloscortezcloud/qhaway/alerts` | Threshold alerts (Slack/webhook/email/PagerDuty) |
| `@carloscortezcloud/qhaway/eval` | Eval run tagging + promptfoo import + eval metrics |
| `@carloscortezcloud/qhaway/ui` | Trace viewer tree + filters (feeds `ui/index.html`) |

## Storage

| Adapter | Best for | Import |
|---------|----------|--------|
| `D1Storage` | Production (SQL, aggregation) | `@carloscortezcloud/qhaway/trace` (d1) |
| `KVStorage` | High-scale write | `@carloscortezcloud/qhaway/trace` (kv) |
| `ConsoleStorage` | Local dev / debug | `@carloscortezcloud/qhaway/trace` (console) |

## Exporters

| Exporter | Destination |
|----------|-------------|
| **OTEL** | Any OTLP collector (Honeycomb, Grafana Tempo, Datadog, SigNoz) |
| **Prometheus** | `GET /metrics` endpoint for Grafana dashboards |
| **MLflow** | Log cost/latency metrics as MLflow experiment runs |
| **Alerts** | Threshold rules → Slack/webhook/email/PagerDuty with cooldown |

## Feedback Loop

Correlate user feedback (thumbs up/down) with cost, latency, and model. Attach a `rating` to any span:

```typescript
import { QhawayTrace, MemoryStorage, aggregateRating, ratingStats } from '@carloscortezcloud/qhaway';

const trace = new QhawayTrace(new MemoryStorage());

const wrapped = trace.wrap(myLlmCall, {
  model: 'gpt-4o',
  provider: 'openai',
  session_id: 'ses-1',
  rating: 1, // thumbs up — or -1 for down, 0 for neutral
});
```

`rating` flows through every storage adapter (D1/KV/Console) and the Prometheus endpoint exposes `qhaway_rating_total{model, rating}` and `qhaway_cost_by_rating_total{rating}`. The Grafana dashboard includes a **Satisfaction vs Cost** scatter panel.

```typescript
import { aggregateRating } from '@carloscortezcloud/qhaway';

const spans = await storage.query();
const byRating = aggregateRating(spans);
// [{ model: 'gpt-4o', rating: -1, calls: 3, costUsd: 0.15, avgLatencyMs: 412, ... }]

const stats = ratingStats(spans);
// { thumbsUp: 40, thumbsDown: 7, avgCostPerThumbsDown: 0.09, thumbsDownRate: 0.15 }
```

Wire it to a Tinkuy feedback hook: on thumbs down, record a span with `rating: -1` (see `examples/feedback-wiring.ts`).
## Agent Evaluations

Tag eval cases with an `eval_run_id`, then compare cost vs score across models and runs:

```typescript
import { labelEvalRun, aggregateEvalRuns, generateEvalMetrics } from '@carloscortezcloud/qhaway/eval';

const tagged = labelEvalRun(span, 'run-7', { score: 0.9, pass: true });

const runs = aggregateEvalRuns(spans);
// [{ eval_run_id: 'run-7', model: 'gpt-4o', passRate: 0.85, costPerScorePoint: 0.02, ... }]

const prom = generateEvalMetrics(spans); // qhaway_eval_run_* metrics for Grafana
```

Import promptfoo output directly — `parsePromptfooOutput(json)` converts `results` into labeled spans, so you can drop eval suites from promptfoo/LangChain into the same dashboards (`qhaway-eval-dashboard.json`). See `examples/eval-comparison.ts`.

## Trace Viewer UI

Standalone, dependency-free HTML viewer for agent traces — no Grafana Tempo or LangSmith required. It renders session → iteration → tool-call trees, colors expensive spans red, filters by model/agent/date/success, and shows feedback ratings.

### Run locally with demo data

```bash
cd qhaway
python3 -m http.server 4173 --directory ui
```

Open [http://localhost:4173/index.html?endpoint=/demo-data.json](http://localhost:4173/index.html?endpoint=/demo-data.json) — `demo-data.json` ships realistic spans (sessions, tool calls, failures, ratings).

### Point at your own spans

Any URL returning `QhawaySpan[]` as JSON works:

```
open ui/index.html?endpoint=https://my-agent.example.com/spans
```

On Cloudflare Workers, serve from D1/KV with a tiny route:

```typescript
import { D1Storage } from '@carloscortezcloud/qhaway/trace';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/spans') {
      const storage = new D1Storage(env.QHAWAY_DB);
      return Response.json(await storage.query({}, 500));
    }
  },
};
```

### Programmatic API

Tree-building and filtering are exported from the npm package:

```typescript
import { getUiApi, buildTraceTree, costColor } from '@carloscortezcloud/qhaway/ui';

const api = getUiApi(storage); // or getUiApi('https://.../spans')
const spans = await api.loadSpans({ model: 'gpt-4o' });
const tree = buildTraceTree(spans);

for (const node of tree) {
  console.log(node.label, costColor(node.costUsd));
}
```

Full guide (data format, inject spans without a server, features): [`ui/README.md`](ui/README.md).

## Python SDK

```bash
pip install qhaway-trace
```

```python
from qhaway import QhawayTrace, console_storage
from qhaway.integrations import OpenAIPatch

trace = QhawayTrace(storage=console_storage)
OpenAIPatch.apply(trace)  # auto-instrument all OpenAI calls
```

See [python/README.md](python/README.md) for OpenAI, LangChain, Anthropic, and FastAPI examples.

## Architecture

```
Your Agent (Tinkuy / LangChain / raw)
  │
  ▼
QhawayTrace.wrap(fn)
  │
  ├── D1/KV (storage)
  ├── OTLP (Honeycomb, Grafana, Datadog)
  └── GET /metrics → Prometheus → Grafana dashboard
```

## Grafana Dashboard

Import `qhaway-dashboard.json` into Grafana (Cloud or OSS) to visualize:
- Cost by model and user
- Latency P99 over time
- Token usage (input vs output)
- Recent call log
- Daily spend summary

## Ecosystem

| Package | Role | npm |
|---------|------|-----|
| **Qhaway** | Agent obs (this) | `@carloscortezcloud/qhaway` |
| **Styrr** | LLM router | `styrr` |
| **Sayay** | Cost guardrails | GitHub |
| **Tinkuy** | Agent framework | `@carloscortezcloud/tinkuy-agent` |
| **TideRAG** | Edge RAG pipeline | `@carloscortezcloud/tiderag` |

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  Built by engineers who got tired of blind AI spending.<br>
  <a href="https://github.com/breakingthecloud/tinkuylabs">Tinkuy Labs</a> · <a href="https://finoptix.dev">finoptix.dev</a>
</p>
<p align="center">
  <sub>If you can't see the cost, you can't control it. Qhaway opens your eyes.</sub>
</p>
