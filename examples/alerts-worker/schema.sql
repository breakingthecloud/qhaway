-- Qhaway Alerts config table (optional — used by loadRulesFromD1)
-- Rules can also be provided via ALERT_RULES_JSON env var or code.

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  metric TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT '>',
  threshold REAL NOT NULL,
  window TEXT NOT NULL DEFAULT 'day',
  group_by TEXT,
  channels TEXT NOT NULL DEFAULT '[]',
  cooldown_minutes INTEGER NOT NULL DEFAULT 60
);

INSERT OR REPLACE INTO alert_rules (id, name, metric, condition, threshold, window, group_by, channels, cooldown_minutes) VALUES
  ('user-daily-budget', 'User Daily Budget', 'cost_per_user_per_day', '>', 5.00, 'day', 'user_id', '[{"type":"slack","target":"https://hooks.slack.com/services/T..."}]', 60),
  ('latency-p99', 'Latency P99 Alert', 'latency_p99', '>', 10000, 'hour', NULL, '[{"type":"console"}]', 30),
  ('error-rate', 'Error Rate Alert', 'error_rate', '>', 5, 'hour', NULL, '[{"type":"console"}]', 30),
  ('daily-spend', 'Daily Spend Alert', 'total_cost_per_day', '>', 100.00, 'day', NULL, '[{"type":"webhook","target":"https://example.com/alerts"}]', 60);
