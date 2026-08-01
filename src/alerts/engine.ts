import type { QhawaySpan, QhawayStorage } from '../trace/index.js';
import { CooldownTracker, evaluateWindow, fireChannels } from './channels.js';
import type { AlertChannel, AlertEvaluation, AlertFired, AlertMetric, AlertRule, AlertWindow } from './types.js';

export interface AlertEngineConfig {
  rules?: AlertRule[];
  now?: () => number;
  onError?: (err: unknown) => void;
}

export interface AlertEngineResult {
  evaluated: AlertEvaluation[];
  fired: AlertFired[];
}

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'user-daily-budget',
    name: 'User Daily Budget',
    metric: 'cost_per_user_per_day',
    condition: '>',
    threshold: 5.0,
    window: 'day',
    groupBy: 'user_id',
    channels: [{ type: 'console' }],
    cooldownMinutes: 60,
  },
  {
    id: 'latency-p99',
    name: 'Latency P99 Alert',
    metric: 'latency_p99',
    condition: '>',
    threshold: 10000,
    window: 'hour',
    channels: [{ type: 'console' }],
    cooldownMinutes: 30,
  },
  {
    id: 'error-rate',
    name: 'Error Rate Alert',
    metric: 'error_rate',
    condition: '>',
    threshold: 5,
    window: 'hour',
    channels: [{ type: 'console' }],
    cooldownMinutes: 30,
  },
  {
    id: 'daily-spend',
    name: 'Daily Spend Alert',
    metric: 'total_cost_per_day',
    condition: '>',
    threshold: 100.0,
    window: 'day',
    channels: [{ type: 'console' }],
    cooldownMinutes: 60,
  },
];

export class AlertEngine {
  private rules: AlertRule[];
  private cooldown: CooldownTracker;
  private onError?: (err: unknown) => void;
  private now: () => number;

  constructor(config: AlertEngineConfig = {}) {
    this.rules = config.rules ?? DEFAULT_ALERT_RULES;
    this.now = config.now ?? (() => Date.now());
    this.cooldown = new CooldownTracker(this.now);
    this.onError = config.onError;
  }

  get rulesList(): AlertRule[] {
    return this.rules;
  }

  setRules(rules: AlertRule[]): void {
    this.rules = rules;
  }

  async evaluate(spans: QhawaySpan[]): Promise<AlertEngineResult> {
    const evaluated: AlertEvaluation[] = [];
    const fired: AlertFired[] = [];

    for (const rule of this.rules) {
      const windowStart = evaluateWindow(rule.window, new Date(this.now()));

      if (rule.groupBy) {
        const groups = groupSpansBy(spans, rule.groupBy);
        for (const [groupValue, groupSpans] of groups) {
          const inWindow = groupSpans.filter((s) => new Date(s.timestamp) >= windowStart);
          const value = computeMetric(rule.metric, inWindow);
          const result = evaluateRule(rule, value, windowStart, groupValue, this.now());
          evaluated.push(result);
          if (result.triggered && this.cooldown.canFire(rule.id, groupValue, rule.cooldownMinutes)) {
            this.cooldown.markFired(rule.id, groupValue);
            fired.push({ ...result, channels: rule.channels });
          }
        }
      } else {
        const inWindow = spans.filter((s) => new Date(s.timestamp) >= windowStart);
        const value = computeMetric(rule.metric, inWindow);
        const result = evaluateRule(rule, value, windowStart, undefined, this.now());
        evaluated.push(result);
        if (result.triggered && this.cooldown.canFire(rule.id, undefined, rule.cooldownMinutes)) {
          this.cooldown.markFired(rule.id, undefined);
          fired.push({ ...result, channels: rule.channels });
        }
      }
    }

    await Promise.all(
      fired.map((f) =>
        fireChannels(
          f.channels,
          {
            title: `Qhaway Alert: ${f.ruleName}`,
            text: f.message,
            severity: 'warning',
            ruleId: f.ruleId,
            metric: f.metric,
            actual: f.actual,
            threshold: f.threshold,
            timestamp: f.timestamp,
          },
          this.onError,
        ),
      ),
    );

    return { evaluated, fired };
  }

  getFireCount(ruleId: string, groupValue?: string): number {
    return this.cooldown.getFireCount(ruleId, groupValue);
  }
}

function evaluateRule(
  rule: AlertRule,
  actual: number,
  windowStart: Date,
  groupValue: string | undefined,
  nowMs: number,
): AlertEvaluation {
  const triggered = compare(actual, rule.condition, rule.threshold);
  const groupLabel = groupValue ? ` (${groupValue})` : '';
  const message = `${rule.name}${groupLabel}: ${formatValue(rule.metric, actual)} ${rule.condition} ${rule.threshold} in last ${rule.window}`;
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    metric: rule.metric,
    condition: rule.condition,
    threshold: rule.threshold,
    actual,
    groupValue,
    window: rule.window,
    triggered,
    timestamp: new Date(nowMs).toISOString(),
    message,
  };
}

function compare(actual: number, condition: AlertRule['condition'], threshold: number): boolean {
  switch (condition) {
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    default: return false;
  }
}

function groupSpansBy(spans: QhawaySpan[], key: string): Map<string, QhawaySpan[]> {
  const groups = new Map<string, QhawaySpan[]>();
  for (const span of spans) {
    const value = getSpanGroupValue(span, key);
    const k = value !== undefined ? String(value) : 'unknown';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(span);
  }
  return groups;
}

function getSpanGroupValue(span: QhawaySpan, key: string): unknown {
  switch (key) {
    case 'user_id': return span.user_id;
    case 'session_id': return span.session_id;
    case 'agent_id': return span.agent_id;
    case 'model': return span.model;
    case 'provider': return span.provider;
    case 'tool_name': return span.tool_name;
    default: return (span as unknown as Record<string, unknown>)[key];
  }
}

function computeMetric(metric: AlertMetric, spans: QhawaySpan[]): number {
  switch (metric) {
    case 'cost_per_user_per_day':
    case 'cost_per_model':
    case 'total_cost_per_day':
      return round(spans.reduce((sum, s) => sum + s.cost_usd, 0), 6);
    case 'latency_p99':
      return p99(spans.map((s) => s.latency_ms));
    case 'error_rate': {
      if (spans.length === 0) return 0;
      const errors = spans.filter((s) => !s.success).length;
      return round((errors / spans.length) * 100, 2);
    }
    case 'tokens_per_session':
      return spans.reduce((sum, s) => sum + s.tokens_in + s.tokens_out, 0);
    default:
      return 0;
  }
}

function p99(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)];
}

function formatValue(metric: AlertMetric, value: number): string {
  if (metric === 'latency_p99') return `${Math.round(value)}ms`;
  if (metric === 'error_rate') return `${value}%`;
  if (metric.includes('cost')) return `$${value.toFixed(4)}`;
  return String(value);
}

function round(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

export interface D1AlertStorageOptions {
  tableName?: string;
}

export async function loadRulesFromD1(
  db: { prepare: (sql: string) => { bind: (...args: unknown[]) => { all: () => Promise<{ results?: unknown[] }> } } },
  opts: D1AlertStorageOptions = {},
): Promise<AlertRule[] | null> {
  const table = opts.tableName ?? 'alert_rules';
  try {
    const res = await db.prepare(`SELECT * FROM ${table}`).bind().all();
    if (!res.results || res.results.length === 0) return null;
    return res.results.map((row) => normalizeRule(row as Partial<AlertRule>));
  } catch {
    return null;
  }
}

function normalizeRule(row: Partial<AlertRule>): AlertRule {
  const channelsRaw = (row.channels as unknown) as AlertChannel[] | string | undefined;
  let channels: AlertChannel[] = [{ type: 'console' }];
  if (typeof channelsRaw === 'string') {
    channels = JSON.parse(channelsRaw);
  } else if (Array.isArray(channelsRaw) && channelsRaw.length > 0) {
    channels = channelsRaw;
  }
  return {
    id: row.id ?? `rule-${Date.now()}`,
    name: row.name ?? 'Untitled rule',
    metric: row.metric ?? 'total_cost_per_day',
    condition: row.condition ?? '>',
    threshold: row.threshold ?? 100,
    window: row.window ?? 'day',
    groupBy: row.groupBy,
    channels,
    cooldownMinutes: row.cooldownMinutes ?? 60,
  };
}

export function filterSpansByStorage(
  storage: QhawayStorage,
  limit = 1000,
): Promise<QhawaySpan[]> {
  if (storage.query) return storage.query({}, limit);
  return Promise.resolve([]);
}

export type { AlertWindow };
