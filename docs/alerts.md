# Qhaway Alerts

Threshold-based alerting for agent cost, latency, error rate, and token usage. Fires Slack / webhook / email / PagerDuty when metrics cross configured thresholds — with cooldown to prevent alert storms.

```
Qhaway spans (storage)
        │
        ▼
AlertEngine.evaluate(spans)
        │
        ├── cost_per_user_per_day > $5  (groupBy user)
        ├── latency_p99 > 10s
        ├── error_rate > 5%
        └── total_cost_per_day > $100
        │
        ▼  (threshold exceeded + cooldown expired)
Slack / Webhook / Email / PagerDuty / Console
```

## Quick Start

```typescript
import { AlertEngine, DEFAULT_ALERT_RULES } from '@carloscortezcloud/qhaway/alerts';

const engine = new AlertEngine({
  rules: DEFAULT_ALERT_RULES.map((r) =>
    r.id === 'user-daily-budget'
      ? { ...r, channels: [{ type: 'slack', target: 'https://hooks.slack.com/services/T…' }] }
      : r,
  ),
});

const { fired } = await engine.evaluate(spans);
console.log(fired.map((f) => f.message));
```

## Custom Rules

```typescript
const rules = [
  {
    id: 'alice-budget',
    name: 'Alice daily cap',
    metric: 'cost_per_user_per_day',
    condition: '>',
    threshold: 2.0,
    window: 'day',
    groupBy: 'user_id', // evaluates each user separately
    channels: [
      { type: 'webhook', target: 'https://my-api.example.com/qhaway-alert' },
      { type: 'pagerduty', target: 'INTEGRATION_KEY' },
    ],
    cooldownMinutes: 30,
  },
];
```

## Built-in Rules

| Rule | Metric | Threshold | Window |
|------|--------|-----------|--------|
| User Daily Budget | `cost_per_user_per_day` | $5 | day (per user) |
| Latency P99 | `latency_p99` | 10s | hour |
| Error Rate | `error_rate` | 5% | hour |
| Daily Spend | `total_cost_per_day` | $100 | day |

## CF Worker Cron (every 5 min)

1. Copy `examples/alerts-worker/` — set your D1 binding + cron in `wrangler.toml`
2. Optional: run `schema.sql` to store rules in D1 (rules auto-load via `loadRulesFromD1`)
3. Or set `ALERT_RULES_JSON` env var with your rules
4. `wrangler deploy`

```bash
npx wrangler d1 execute qhaway --file examples/alerts-worker/schema.sql
npx wrangler deploy
```

## Channels

| Type | `target` | Notes |
|------|----------|-------|
| `slack` | Incoming webhook URL | Blocks + context footer |
| `webhook` | Any POST URL | Raw JSON payload |
| `email` | `to@example.com` | Uses MailChannels CF Email Service |
| `pagerduty` | Integration key | Events API v2, severity `warning` |
| `console` | — | Logs to stdout |

## Cooldown

Each rule tracks the last fire time **per group value**. A rule with `cooldownMinutes: 60` and `groupBy: 'user_id'` can alert once per user per hour, so one spendy user won't suppress alerts for another.

## Reference

```typescript
// Metrics
type AlertMetric = 'cost_per_user_per_day' | 'cost_per_model' | 'latency_p99'
                | 'error_rate' | 'tokens_per_session' | 'total_cost_per_day';

// Windows
type AlertWindow = 'hour' | 'day' | 'week';
```
