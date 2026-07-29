# Qhaway Local Test Stack

Docker stack with a mock metrics server + Prometheus + Grafana to visualize Qhaway metrics locally.

## Architecture

This stack simulates the real Qhaway observability pipeline. In production, your app
emits Qhaway metrics via the SDK (standalone), OTEL exporter, or Tinkuy plugin →
Prometheus scrapes them → Grafana visualizes them.

## Real Pipeline (Tinkuy + QhawayPlugin + Prometheus + Grafana)

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    TU AGENTE CON TINKUY                                │
  │                                                                         │
  │  ┌──────────────────────────────────────────────────────────────────┐   │
  │  │  Tinkuy Agent                                                    │   │
  │  │                                                                   │   │
  │  │  ┌──────────────────────┐  cada iteración / tool call / complete │   │
  │  │  │ QhawayTinkuyPlugin   │  → onIteration → storage.write(span)   │   │
  │  │  │ { storage }          │  → onToolCall  → storage.write(span)   │   │
  │  │  └────────┬─────────────┘  → onComplete  → storage.write(span)   │   │
  │  │           │                                                       │   │
  │  │           ▼                                                       │   │
  │  │  ┌──────────────────────┐                                        │   │
  │  │  │ MemoryStorage        │  Acumula spans con write/query          │   │
  │  │  │ (u otro QhawayStorage│  en memoria                            │   │
  │  │  │  con query())        │                                        │   │
  │  │  └──────────┬───────────┘                                        │   │
  │  │             │                                                    │   │
  │  │  ┌──────────▼───────────┐                                        │   │
  │  │  │ serveMetrics(        │  Qhaway crea automáticamente           │   │
  │  │  │   { port: 9090,      │  un HTTP server nativo (Node.js)       │   │
  │  │  │     storage })       │  sin Express / Fastify                 │   │
  │  │  │                      │  GET /metrics → query() +              │   │
  │  │  │                      │  generatePrometheusMetrics()           │   │
  │  │  └──────────────────────┘                                        │   │
  │  └──────────────────────────────────────────────────────────────────┘   │
  │                                                                         │
  └────────────────────────────────┬────────────────────────────────────────┘
                                   │
                         GET /metrics
                         (qhaway_cost_total, _latency_seconds, _tokens_*, _calls_total)
                                   │
                                   ▼
  ┌────────────────────────────────────────────────────────────────┐
  │  Prometheus                                                    │
  │  • scrapea tu agente cada N segundos (ej: 5s)                 │
  │  • targets: ["tu-agente:9090"]                               │
  │  • almacena series de tiempo (TSDB)                           │
  └────────────────────────────┬───────────────────────────────────┘
                               │  datasource: prometheus-uid
                               ▼
  ┌────────────────────────────────────────────────────────────────┐
  │  Grafana                                                       │
  │  dashboard: qhaway-dashboard                                   │
  │                                                                │
  │  ┌──────────────┬──────────────┬──────────────┬──────────────┐ │
  │  │  Daily Spend │ Cost by      │ Latency P99  │ Cost by User │ │
  │  │  (∑cost/24h) │ Model (top10)│ (hist_quant) │ (top20)      │ │
  │  ├──────────────┼──────────────┼──────────────┼──────────────┤ │
  │  │  Token Usage │ LLM Calls   │  ⚠ Alert     │              │ │
  │  │  in vs out   │ (sort_desc) │  >$500/día    │              │ │
  │  └──────────────┴──────────────┴──────────────┴──────────────┘ │
  └────────────────────────────────────────────────────────────────┘
```

## Local Test Stack (mock server)

Para development sin tener que levantar tu agente real, usamos un mock server
que genera métricas sintéticas con los mismos nombres:

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  metrics-server.js   (Node.js, Docker)                              │
  │  • qhaway_cost_total           • qhaway_latency_seconds             │
  │  • qhaway_tokens_input_total   • qhaway_tokens_output_total         │
  │  • qhaway_calls_total                                               │
  │  Datos aleatorios en cada request random(0.001-0.02) por modelo     │
  └────────────────────────┬─────────────────────────────────────────────┘
                           │
                           ▼
  ┌──────────────────┐    scrape 5s    ┌──────────────┐  ds uid    ┌──────────────┐
  │  metrics:9090    │ ──────────────→ │  prometheus  │ ──────────→│  grafana     │
  │  mock server     │                 │  :9091       │            │  :3000       │
  └──────────────────┘                 └──────────────┘            └──────────────┘
                                                                        ↑
                                                              ┌─────────┴─────────┐
                                                              │  provisioning     │
                                                              │  dashboards.yaml  │
                                                              │  qhaway-dash.json │
                                                              └───────────────────┘
```

## Quick Start

```bash
cd test/docker
docker compose up -d
```

Wait ~10s for initial data, then open:

**Grafana:** http://localhost:3000/d/qhaway-dashboard/qhaway-e28094-ai-agent-observability<br>
**Prometheus:** http://localhost:9091/targets

## What You Get

| Service | Port | Purpose |
|---------|------|---------|
| **metrics** | 9090 | Node.js server generating random Qhaway metrics every request |
| **prometheus** | 9091 | Scrapes metrics every 5s, stores time series |
| **grafana** | 3000 | Pre-provisioned dashboard with 6 panels |
| **mlflow** | 5001 | MLflow Tracking server for experiment metrics |

### Dashboard Panels

- **Daily Spend** — cost over 24h
- **Cost by Model** — top 10 models by total cost
- **Cost by User** — cost breakdown per user
- **Latency P99** — p99 latency histogram per model
- **Token Usage** — input vs output token rate per model
- **LLM Calls** — call count per model

### Alert Rule

The dashboard includes a **Daily Spend Alert** (threshold > $500/day) — visible in Grafana Alerting.

## Services Detail

### Mock Metrics Server

`metrics-server.js` — a lightweight HTTP server that generates random Qhaway metrics on every `/metrics` scrape:

- `qhaway_cost_total` — cost by model + user + provider
- `qhaway_latency_seconds` — histogram buckets (0.1 to +Inf)
- `qhaway_tokens_input_total` / `qhaway_tokens_output_total` — token counters per model
- `qhaway_calls_total` — call count with success/failure per model

Values reset on container restart but grow continuously within a session.

### Prometheus

Scrape config at `prometheus.yml` — targets `metrics:9090` every **5s**.

### Grafana

Fully auto-provisioned on first start:

- **Datasource** — `test/docker/grafana/datasources/prometheus.yaml`<br>
  Fixed UID `prometheus-uid` — stable across restarts.
- **Dashboard** — imported via `test/docker/grafana/dashboards/dashboards.yaml` from the canonical dashboard JSON at `src/dashboard/qhaway-dashboard.json`.<br>
  Stable URL UID `qhaway-dashboard`.

Anonymous access with Admin role — no login required.

## Architecture

```
┌──────────────┐     GET /metrics     ┌──────────────┐     datasource     ┌──────────────┐
│  metrics     │ ──────────────────→  │  prometheus  │ ────────────────→  │  grafana     │
│  :9090       │    scrape every 5s   │  :9091       │   prometheus-uid  │  :3000       │
│  Node.js     │                      │  stores TSDB │                   │  dashboard   │
│  mock server │                      │              │                   │  qhaway-dash │
└──────────────┘                      └──────────────┘                   └──────────────┘
                                                                              ↑
                                                                    ┌─────────┴─────────┐
                                                                    │  provisioning     │
                                                                    │  dashboards.yaml  │
                                                                    │  qhaway-dash.json │
                                                                    └───────────────────┘

  Ports:
    9090  ← metrics server (inside Docker net, not exposed to host)
    9091  ← Prometheus UI (http://localhost:9091)
    3000  ← Grafana UI  (http://localhost:3000)
```

## Commands

```bash
# Start all services
docker compose up -d

# Stop
docker compose down

# Restart only Grafana (after dashboard JSON changes)
docker compose restart grafana

# Rebuild metrics image (after JS changes)
docker compose build metrics && docker compose up -d

# Full reset (fresh state)
docker compose down -v && docker compose up -d

# View logs
docker compose logs -f
```

## Modifying the Dashboard

Edit `../../src/dashboard/qhaway-dashboard.json`, then restart Grafana:

```bash
docker compose restart grafana
```

The provisioning config reloads dashboards every 10s (`updateIntervalSeconds: 10`).

## Integrating with Your App

Replace the mock metrics server with your own app using Qhaway + Tinkuy:

```ts
import { MemoryStorage, serveMetrics } from '@carloscortezcloud/qhaway';
import { QhawayTinkuyPlugin } from '@carloscortezcloud/qhaway/tinkuy';

const storage = new MemoryStorage();
const plugin = new QhawayTinkuyPlugin({ storage, agentName: 'my-agent' });
const agent = new Agent().with(plugin);

// Qhaway crea el server HTTP en :9090, GET /metrics devuelve
// generatePrometheusMetrics() con los spans acumulados
serveMetrics({ port: 9090, storage });
```

O si usas el SDK standalone:

```ts
import { MemoryStorage, serveMetrics } from '@carloscortezcloud/qhaway';

const storage = new MemoryStorage();
serveMetrics({ port: 9090, storage });

// En cada LLM call:
storage.write({
  model: 'gpt-4o', provider: 'openai',
  latency_ms: 320, tokens_in: 150, tokens_out: 80,
  cost_usd: 0.005, success: true,
});
```

> **⚠️ MemoryStorage acumula spans en memoria sin límite.** Para development está bien, pero en producción el proceso se come toda la RAM con el tiempo. Opciones:
>
> - **Limitar:** `new MemoryStorage({ maxSpans: 10_000 })` — evicta los más viejos automáticamente
> - **Persistir:** Qhaway ya incluye `D1Storage` (Cloudflare D1), `KVStorage` (Cloudflare KV), y `ConsoleStorage`. Puedes implementar `QhawayStorage` para SQLite, S3, PostgreSQL, etc.
> - **Ventana de tiempo:** Usa `query()` con `limit` para devolver solo los últimos N spans en `/metrics`

También puedes usar Express, Fastify, Hono, o cualquier framework en vez del `serveMetrics()` nativo:

```ts
import { MemoryStorage, generatePrometheusMetrics } from '@carloscortezcloud/qhaway';

const storage = new MemoryStorage();
const app = express();

app.get('/metrics', async (req, res) => {
  const spans = await storage.query();
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(generatePrometheusMetrics(spans));
});
```

Luego apunta Prometheus a tu app:

```yaml
scrape_configs:
  - job_name: qhaway
    static_configs:
      - targets: ["tu-agente:9090"]
```

The dashboard panels query these Prometheus metrics:

| Panel | PromQL |
|-------|--------|
| Daily Spend | `sum(increase(qhaway_cost_total[24h]))` |
| Cost by Model | `topk(10, sum by(model) (qhaway_cost_total))` |
| Cost by User | `topk(20, sum by(user) (qhaway_cost_total{user!=""}))` |
| Latency P99 | `histogram_quantile(0.99, sum by(le) (rate(qhaway_latency_seconds_bucket[5m])))` |
| Token Usage | `sum(rate(qhaway_tokens_input_total[5m])) by(model)` / `sum(rate(qhaway_tokens_output_total[5m])) by(model)` |
| LLM Calls | `sort_desc(qhaway_calls_total)` |

### Installing Qhaway

```bash
npm install @carloscortezcloud/qhaway
```

See [examples](../../examples/) for SDK integration (standalone, OTEL, Tinkuy plugin).
