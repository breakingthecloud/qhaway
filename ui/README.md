# Qhaway Trace Viewer UI

A dependency-free, standalone web viewer for agent traces stored in any `QhawayStorage` (MemoryStorage, D1, KV). No Grafana Tempo, no LangSmith, no backend required.

## Quick Start

Open `index.html` directly in a browser, pointing at a JSON endpoint that serves spans:

```
open index.html?endpoint=https://my-agent.example.com/spans
```

Or inject spans before the script runs:

```html
<script>
  window.__QHAWAY_SPANS__ = [
    { id: '1', timestamp: '2026-08-03T10:00:00Z', model: 'gpt-4o', provider: 'openai',
      latency_ms: 234, tokens_in: 120, tokens_out: 80, cost_usd: 0.021, success: true,
      session_id: 'abc123', user_id: 'u1' },
  ];
</script>
<script src="index.html"></script>
```

## Features

- **Tree view** — sessions grouped into root nodes, each with its iteration/tool/agent spans as children. Click to expand/collapse.
- **Cost color coding** — green &le; $0.01, yellow &le; $0.05, red above. Session nodes show aggregated cost/latency.
- **Filters** — by model, agent, success/failure, date range, and tool name. No backend needed.
- **Rating support** — thumbs up/down spans (Qhaway-010) are annotated with `[UP]`/`[DOWN]` tags.
- **Summary bar** — total spans, cost, latency, failures, and rating counts.

## Programmatic API

```typescript
import { getUiApi, buildTraceTree, costColor } from '@carloscortezcloud/qhaway/ui';

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
