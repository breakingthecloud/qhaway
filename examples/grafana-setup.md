# Grafana Setup with Qhaway

## Prerequisites

- A Qhaway Worker exposing `GET /metrics` in Prometheus format
- Grafana (Cloud free tier, or OSS self-hosted)

## Step 1: Add Prometheus Data Source

1. Open Grafana → **Configuration** → **Data Sources** → **Add data source**
2. Select **Prometheus**
3. Set **URL** to your Qhaway Worker URL (e.g., `https://qhaway.your-worker.workers.dev`)
4. Set **Scrape interval** to `30s`
5. Click **Save & test**

## Step 2: Import Dashboard

1. Open Grafana → **Dashboards** → **New** → **Import**
2. Upload `src/dashboard/qhaway-dashboard.json` or paste its contents
3. Select the Prometheus data source from step 1
4. Click **Import**

## Step 3: Verify

After importing, you should see 6 panels:
- **Daily Spend** — current 24h cost
- **Cost by Model** — top 10 models by cost
- **Latency P99** — 99th percentile latency over time
- **Cost by User** — per-user spend table
- **Token Usage** — input vs output stacked area
- **LLM Calls** — call count by model and success

## Alert Rule

The dashboard includes a built-in alert: **Daily spend > $10**. Configure notification channels in Grafana → **Alerting** → **Notification channels** to receive alerts via Slack, email, PagerDuty, etc.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "No data" in panels | Verify Worker is running and `GET /metrics` returns data |
| "Data source not found" | Check Prometheus URL and network connectivity |
| Panels show 0 values | Metrics are counters — they need at least 1 scrape to appear |
