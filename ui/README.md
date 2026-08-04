# Qhaway Trace Viewer UI

A dependency-free, standalone web viewer for agent traces stored in any `QhawayStorage` (MemoryStorage, D1, KV). No Grafana Tempo, no LangSmith, no backend required. It reads spans as JSON — either from a URL endpoint or a `window.__QHAWAY_SPANS__` global.

## Requirements

- Any static file server (or just open the HTML directly).
- A JSON array of `QhawaySpan` objects. Every span field is optional at render time; only `id`, `timestamp`, `model`, `latency_ms`, `cost_usd`, `success` are used for layout. `session_id` groups spans into session roots; `tool_name` classifies a node as tool/agent.

## Run it locally

### Option 1 — demo data (fastest)

Serve the `ui/` folder and open with the bundled demo dataset:

```bash
cd qhaway
python3 -m http.server 4173 --directory ui
```

Then open:

```
http://localhost:4173/index.html?endpoint=/demo-data.json
```

`demo-data.json` ships with realistic spans (3 sessions, tool calls, agent.run, a failure, ratings) so you can try filters and color coding immediately.

### Option 2 — your own storage endpoint

Point the viewer at any URL that returns a JSON array of spans:

```
open index.html?endpoint=https://my-agent.example.com/spans
```

On Cloudflare Workers, serve spans from D1/KV with a tiny route:

```typescript
import { D1Storage } from '@carloscortezcloud/qhaway/trace';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/spans') {
      const storage = new D1Storage(env.QHAWAY_DB);
      const spans = await storage.query({}, 500);
      return Response.json(spans);
    }
    // ...rest of your worker
  },
};
```

### Option 3 — inject spans directly (no server)

Open `index.html` with the data embedded before the script runs:

```html
<!DOCTYPE html>
<html>
<body>
  <script>
    window.__QHAWAY_SPANS__ = [
      { id: '1', timestamp: '2026-08-03T10:00:00Z', model: 'gpt-4o', provider: 'openai',
        latency_ms: 234, tokens_in: 120, tokens_out: 80, cost_usd: 0.021, success: true,
        session_id: 'abc123', user_id: 'u1' },
    ];
  </script>
  <script src="https://unpkg.com/@carloscortezcloud/qhaway/ui/index.html"></script>
</body>
</html>
```

> Note: serving `index.html` via `unpkg` is for quick prototyping. For production, copy the file into your own project.

## Features

- **Tree view** — sessions grouped into root nodes, each with its iteration/tool/agent spans as children. Click to expand/collapse.
- **Cost color coding** — green ≤ $0.01, yellow ≤ $0.05, red above. Session nodes show aggregated cost/latency.
- **Filters** — by model, agent, success/failure, date range, and tool name. No backend needed.
- **Rating support** — thumbs up/down spans (Qhaway-010) are annotated with `[UP]`/`[DOWN]`/`[NEUTRAL]` tags.
- **Summary bar** — total spans, cost, latency, failures, and rating counts.
- **Expand/collapse all** — toolbar buttons to open or close every session at once.

## Data format

The viewer consumes `QhawaySpan[]` as JSON:

```typescript
interface QhawaySpan {
  id: string;
  timestamp: string;        // ISO 8601
  model: string;
  provider: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  user_id?: string;
  session_id?: string;      // groups spans into a session root
  agent_id?: string;
  tool_name?: string;       // sets node type: tool, or agent.run → agent
  success: boolean;
  error?: string;
  rating?: 1 | -1 | 0;      // Qhaway-010 feedback loop
  metadata?: Record<string, unknown>;
}
```

## Programmatic API

The same tree/filter logic is exported from the npm package for use in your own tooling:

```typescript
import { getUiApi, buildTraceTree, filterSpans, costColor } from '@carloscortezcloud/qhaway/ui';

const api = getUiApi(storage); // or getUiApi('https://.../spans')
const spans = await api.loadSpans({ model: 'gpt-4o' });
const tree = buildTraceTree(spans);

for (const node of tree) {
  console.log(node.label, costColor(node.costUsd));
}
```

## Screenshot

![Qhaway Trace Viewer](docs/trace-viewer-screenshot.png)

> Screenshot placeholder — replace `docs/trace-viewer-screenshot.png` with a capture of the rendered tree.
