# 👁️ Qhaway — Agent Observability

Trace, cost, OTEL export, and Grafana dashboards for AI agents. Zero-dependency. Works in Cloudflare Workers, Node.js, Deno, Bun.

```bash
npm install @carloscortezcloud/qhaway
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

## Quick Start

```typescript
import { QhawayTrace, ConsoleStorage } from '@carloscortezcloud/qhaway/trace';

const trace = new QhawayTrace(new ConsoleStorage(), { agent_id: 'my-agent' });

const wrapped = trace.wrap(myLlmCall, { model: 'gpt-4o', provider: 'openai', user_id: 'abc' });
const result = await wrapped(prompt);

// Console output:
// [Qhaway] ✓ gpt-4o (openai) | $0.00063 | 150→42 tok | 1234ms | user=abc
```

## Storage

| Adapter | Best for | Import |
|---------|----------|--------|
| `D1Storage` | Production (SQL, aggregation) | `@carloscortezcloud/qhaway/trace` (d1) |
| `KVStorage` | High-scale write | `@carloscortezcloud/qhaway/trace` (kv) |
| `ConsoleStorage` | Local dev / debug | `@carloscortezcloud/qhaway/trace` (console) |

## Exporters

- **OTEL** — Export spans to any OTLP collector (Honeycomb, Grafana Tempo, Datadog, SigNoz)
- **Prometheus** — `GET /metrics` endpoint for Grafana dashboards
- **MLflow** — Log cost/latency metrics as MLflow experiment runs

## Grafana Dashboard

Import `qhaway-dashboard.json` into Grafana (Cloud or OSS) to visualize:

- Cost by model and user
- Latency P99 over time
- Token usage (input vs output)
- Recent call log
- Daily spend stat

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

## License

Apache 2.0
