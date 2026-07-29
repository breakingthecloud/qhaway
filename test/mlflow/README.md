# Qhaway + MLflow Integration Guide

Export agent cost, latency, and usage metrics to MLflow for experiment tracking.

## Architecture

```
QhawayTrace / Tinkuy Agent
        │
        ▼
QhawayMLflow (implements QhawayStorage)
        │
        ▼
MLflow Tracking Server (REST API)
        │
        ▼
MLflow UI (experiment comparison)
```

Two modes:
- **Streaming** — `QhawayMLflow.write(span)` via `QhawayStorage` interface, auto-flushes at `batchSize`
- **Batch** — `QhawayMLflow.exportSpans(spans)` groups by `session_id`, one MLflow run per session

## Quick Start

### 1. Start MLflow

```bash
# From the test/docker directory (includes Prometheus + Grafana too)
cd test/docker
docker compose up -d mlflow
```

Or standalone:

```bash
docker run -d --name mlflow -p 5001:5000 ghcr.io/mlflow/mlflow:v2.16.0 \
  mlflow server --host 0.0.0.0 --port 5000
```

> **macOS note:** AirPlay uses port 5000. We map to **5001** on the host.

Open MLflow UI: http://localhost:5001

### 2. Install Qhaway

```bash
npm install @carloscortezcloud/qhaway
```

### 3. Export spans (batch mode)

```ts
import { QhawayMLflow } from '@carloscortezcloud/qhaway/mlflow';

const exporter = new QhawayMLflow({
  trackingUri: 'http://localhost:5001',
  experimentName: 'my-agent-runs',
});

await exporter.exportSpans([
  {
    id: 'span-1', timestamp: new Date().toISOString(),
    model: 'gpt-4o', provider: 'openai',
    latency_ms: 1200, tokens_in: 450, tokens_out: 180,
    cost_usd: 0.008, success: true,
    session_id: 'session-abc', agent_id: 'my-agent',
  },
  // ...
]);
```

### 4. Streaming mode (with Tinkuy)

```ts
import { MemoryStorage, serveMetrics } from '@carloscortezcloud/qhaway';
import { QhawayMLflow } from '@carloscortezcloud/qhaway/mlflow';
import { QhawayTinkuyPlugin } from '@carloscortezcloud/qhaway/tinkuy';

const mlflow = new QhawayMLflow({
  trackingUri: 'http://localhost:5001',
  experimentName: 'tinkuy-agent-runs',
  batchSize: 5,  // flush every 5 spans
});

const plugin = new QhawayTinkuyPlugin({
  storage: mlflow,  // streams spans directly to MLflow
  agentName: 'my-agent',
});

const agent = new Agent().with(plugin);
```

### 5. See results in MLflow

Open http://localhost:5001 → experiment `my-agent-runs`

Each session becomes a **run** with:

| Metric | Description |
|--------|-------------|
| `cost_usd` | Total cost of the agent run |
| `latency_ms` | Total execution time |
| `iterations` | Number of LLM calls |
| `prompt_tokens` | Input tokens |
| `completion_tokens` | Output tokens |
| `successful_calls` | Successful LLM calls |
| `failed_calls` | Failed LLM calls |

**Params:** models used, tools used

**Tags:** session_id, agent_name, qhaway_version

## Commands

```bash
# Start MLflow only
cd test/docker && docker compose up -d mlflow

# Start full stack (MLflow + Prometheus + Grafana + mock metrics)
cd test/docker && docker compose up -d

# Run the example
pnpm tsx test/mlflow/example.mjs

# View MLflow logs
docker compose logs -f mlflow
```

## Production Considerations

- **MemoryStorage + MLflow:** Use `CompositeStorage` to chain MLflow with MemoryStorage (for `serveMetrics`) and D1 (for persistence)
- **Batch size:** Adjust `batchSize` to balance latency vs API calls (default: 10)
- **Authentication:** MLflow supports token auth via `trackingUri` header or `?token=` param
- **Databricks MLflow:** Use your Databricks workspace URL + token as `trackingUri`
