import { AlertEngine, loadRulesFromD1, DEFAULT_ALERT_RULES } from './engine.js';
import type { AlertRule, AlertWindow } from './types.js';
import type { QhawayStorage } from '../trace/index.js';

export interface CronWorkerConfig {
  storage: QhawayStorage;
  env: {
    DB?: {
      prepare: (sql: string) => {
        bind: (...args: unknown[]) => { all: () => Promise<{ results?: unknown[] }> };
      };
    };
    ALERT_RULES_JSON?: string;
  };
  ctx?: { waitUntil: (promise: Promise<unknown>) => void };
  intervalMinutes?: number;
  onError?: (err: unknown) => void;
}

export function createCronWorker(config: CronWorkerConfig): {
  scheduled: (event: { cron: string }) => Promise<void>;
} {
  return {
    scheduled: async () => {
      config.ctx?.waitUntil(runOnce(config));
    },
  };
}

export async function runOnce(config: CronWorkerConfig): Promise<void> {
  try {
    const rules = await resolveRules(config);
    if (!rules || rules.length === 0) return;

    const engine = new AlertEngine({ rules, onError: config.onError });
    const spans = await readSpans(config.storage);
    const result = await engine.evaluate(spans);

    if (result.fired.length > 0) {
      console.log(`[Qhaway Alerts] ${result.fired.length} alert(s) fired`);
    }
  } catch (err) {
    if (config.onError) config.onError(err);
    else console.error('[Qhaway Alerts] cron failed:', err);
  }
}

async function resolveRules(config: CronWorkerConfig): Promise<AlertRule[] | null> {
  if (config.env.ALERT_RULES_JSON) {
    try {
      return JSON.parse(config.env.ALERT_RULES_JSON) as AlertRule[];
    } catch {
      return null;
    }
  }
  if (config.env.DB) {
    const stored = await loadRulesFromD1(config.env.DB);
    if (stored) return stored;
  }
  return DEFAULT_ALERT_RULES;
}

async function readSpans(storage: QhawayStorage): Promise<Awaited<ReturnType<NonNullable<QhawayStorage['query']>>>> {
  if (storage.query) {
    return storage.query({}, 1000);
  }
  return [];
}
