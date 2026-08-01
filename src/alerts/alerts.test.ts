import { describe, it, expect, vi } from 'vitest';
import { AlertEngine, DEFAULT_ALERT_RULES, loadRulesFromD1 } from './engine.js';
import { SlackChannel, WebhookChannel, CooldownTracker, fireChannels } from './channels.js';
import type { AlertRule } from './types.js';
import type { QhawaySpan } from '../trace/index.js';

function makeSpan(overrides: Partial<QhawaySpan> = {}): QhawaySpan {
  return {
    id: 's1',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    provider: 'openai',
    latency_ms: 100,
    tokens_in: 50,
    tokens_out: 30,
    cost_usd: 0.01,
    success: true,
    ...overrides,
  };
}

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'r1',
    name: 'Test Rule',
    metric: 'total_cost_per_day',
    condition: '>',
    threshold: 1,
    window: 'day',
    channels: [{ type: 'console' }],
    cooldownMinutes: 60,
    ...overrides,
  };
}

describe('AlertEngine', () => {
  it('fires when threshold exceeded', async () => {
    const engine = new AlertEngine({ rules: [rule({ metric: 'total_cost_per_day', threshold: 0.05 })] });
    const { fired, evaluated } = await engine.evaluate([
      makeSpan({ cost_usd: 0.04 }),
      makeSpan({ cost_usd: 0.04 }),
    ]);
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0].triggered).toBe(true);
    expect(fired).toHaveLength(1);
    expect(fired[0].ruleId).toBe('r1');
  });

  it('does not fire when under threshold', async () => {
    const engine = new AlertEngine({ rules: [rule({ threshold: 100 })] });
    const { fired, evaluated } = await engine.evaluate([makeSpan({ cost_usd: 0.01 })]);
    expect(evaluated[0].triggered).toBe(false);
    expect(fired).toHaveLength(0);
  });

  it('evaluates cost_per_user_per_day grouped by user', async () => {
    const engine = new AlertEngine({
      rules: [
        rule({
          id: 'budget',
          metric: 'cost_per_user_per_day',
          threshold: 0.5,
          groupBy: 'user_id',
        }),
      ],
    });
    const { evaluated, fired } = await engine.evaluate([
      makeSpan({ user_id: 'alice', cost_usd: 0.4 }),
      makeSpan({ user_id: 'alice', cost_usd: 0.3 }),
      makeSpan({ user_id: 'bob', cost_usd: 0.1 }),
    ]);
    const alice = evaluated.find((e) => e.groupValue === 'alice');
    const bob = evaluated.find((e) => e.groupValue === 'bob');
    expect(alice?.triggered).toBe(true);
    expect(bob?.triggered).toBe(false);
    expect(fired).toHaveLength(1);
    expect(fired[0].groupValue).toBe('alice');
  });

  it('evaluates latency_p99', async () => {
    const engine = new AlertEngine({
      rules: [rule({ metric: 'latency_p99', threshold: 500 })],
    });
    const spans = Array.from({ length: 100 }, (_, i) => makeSpan({ latency_ms: i < 95 ? 100 : 900 }));
    const { evaluated } = await engine.evaluate(spans);
    expect(evaluated[0].metric).toBe('latency_p99');
    expect(evaluated[0].actual).toBe(900);
    expect(evaluated[0].triggered).toBe(true);
  });

  it('evaluates error_rate as percentage', async () => {
    const engine = new AlertEngine({
      rules: [rule({ metric: 'error_rate', threshold: 5 })],
    });
    const { evaluated } = await engine.evaluate([
      makeSpan({ success: false }),
      makeSpan({ success: false }),
      makeSpan({ success: true }),
    ]);
    expect(evaluated[0].actual).toBeCloseTo(66.67, 1);
    expect(evaluated[0].triggered).toBe(true);
  });

  it('ignores spans outside the window', async () => {
    const engine = new AlertEngine({
      rules: [rule({ metric: 'total_cost_per_day', threshold: 0.05, window: 'hour' })],
    });
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { evaluated } = await engine.evaluate([
      makeSpan({ timestamp: old, cost_usd: 1.0 }),
    ]);
    expect(evaluated[0].triggered).toBe(false);
  });

  it('applies cooldown to prevent re-firing', async () => {
    let now = new Date('2026-07-31T00:00:00Z').getTime();
    const engine = new AlertEngine({
      rules: [rule({ cooldownMinutes: 60 })],
      now: () => now,
    });
    const spans = () => [makeSpan({ timestamp: new Date(now).toISOString(), cost_usd: 2.0 })];
    const first = await engine.evaluate(spans());
    expect(first.fired).toHaveLength(1);
    now += 5 * 60 * 1000;
    const second = await engine.evaluate(spans());
    expect(second.fired).toHaveLength(0);
    expect(engine.getFireCount('r1')).toBe(1);
    now += 60 * 60 * 1000;
    const third = await engine.evaluate(spans());
    expect(third.fired).toHaveLength(1);
  });
});

describe('Channels', () => {
  it('SlackChannel posts to webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const slack = new SlackChannel('https://hooks.slack.com/test');
    await slack.send({ text: 'hi', title: 'Alert', ruleId: 'r1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://hooks.slack.com/test');
    const body = JSON.parse(init.body);
    expect(body.blocks[0].text.text).toContain('hi');
    vi.unstubAllGlobals();
  });

  it('WebhookChannel posts JSON payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const webhook = new WebhookChannel('https://example.com/hook');
    await webhook.send({ text: 'spend high', metric: 'cost', actual: 5, threshold: 1 });
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.text).toBe('spend high');
    expect(body.actual).toBe(5);
    vi.unstubAllGlobals();
  });

  it('fireChannels tolerates channel errors via onError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const errors: unknown[] = [];
    await fireChannels(
      [{ type: 'slack', target: 'https://hooks.slack.com/x' }],
      { text: 'x' },
      (err) => errors.push(err),
    );
    expect(errors).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe('CooldownTracker', () => {
  it('tracks fire counts and cooldown', () => {
    let now = 1000;
    const tracker = new CooldownTracker(() => now);
    expect(tracker.canFire('r1', undefined, 10)).toBe(true);
    tracker.markFired('r1', undefined);
    now += 5 * 60 * 1000;
    expect(tracker.canFire('r1', undefined, 10)).toBe(false);
    now += 6 * 60 * 1000;
    expect(tracker.canFire('r1', undefined, 10)).toBe(true);
    expect(tracker.getFireCount('r1', undefined)).toBe(1);
  });
});

describe('loadRulesFromD1', () => {
  it('loads rules from D1 results', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              {
                id: 'd1-rule',
                name: 'D1 Rule',
                metric: 'total_cost_per_day',
                condition: '>',
                threshold: 50,
                window: 'day',
                cooldownMinutes: 30,
                channels: JSON.stringify([{ type: 'slack', target: 'https://x' }]),
              },
            ],
          }),
        }),
      }),
    };
    const rules = await loadRulesFromD1(db as never);
    expect(rules).toHaveLength(1);
    expect(rules![0].id).toBe('d1-rule');
    expect(rules![0].channels[0]).toMatchObject({ type: 'slack' });
  });

  it('returns null when table missing', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => { throw new Error('no table'); } }) }),
    };
    const rules = await loadRulesFromD1(db as never);
    expect(rules).toBeNull();
  });
});

describe('DEFAULT_ALERT_RULES', () => {
  it('has the four built-in rules', () => {
    expect(DEFAULT_ALERT_RULES.map((r) => r.id)).toEqual([
      'user-daily-budget',
      'latency-p99',
      'error-rate',
      'daily-spend',
    ]);
  });
});
