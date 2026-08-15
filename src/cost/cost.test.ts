import { describe, it, expect } from 'vitest';
import { QhawayCost, calculateCost, resolvePricing, getBuiltinPricing, getDefaultPricing } from './index.js';
import { aggregateByUser, aggregateByModel, aggregateByAgent, aggregateByDay, getCostByUser, getCostByModel, getCostByAgent, getCostByDay } from './aggregator.js';
import { generatePrometheusMetrics, computeMetrics } from './metrics.js';
import type { QhawaySpan } from '../trace/index.js';
import type { ModelPricing } from './pricing.js';

function makeSpan(overrides: Partial<QhawaySpan>): QhawaySpan {
  return {
    id: 'test-id',
    timestamp: '2026-07-29T12:00:00.000Z',
    model: 'gpt-4o',
    provider: 'openai',
    latency_ms: 500,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0,
    success: true,
    ...overrides,
  };
}

describe('QhawayCost', () => {
  it('calculates cost for known model', async () => {
    const cost = new QhawayCost();
    expect(await cost.calculate('gpt-4o', 1000, 500)).toBe(0.005 * 1 + 0.015 * 0.5);
  });

  it('returns -1 for unknown model', async () => {
    const cost = new QhawayCost();
    expect(await cost.calculate('nonexistent-model', 100, 50)).toBe(-1);
  });

  it('uses custom pricing when provided', async () => {
    const customPricing: ModelPricing[] = [
      { model: 'my-model', provider: 'custom', inputPer1K: 0.01, outputPer1K: 0.02, contextWindow: 4096 },
    ];
    const cost = new QhawayCost({ customPricing });
    expect(await cost.calculate('my-model', 1000, 500)).toBe(0.01 * 1 + 0.02 * 0.5);
  });

  it('applies cost to a span', async () => {
    const cost = new QhawayCost();
    const span = makeSpan({ model: 'gpt-4o', tokens_in: 1000, tokens_out: 500 });
    const result = await cost.apply(span);
    expect(result.cost_usd).toBe(0.005 * 1 + 0.015 * 0.5);
    expect(result.id).toBe(span.id);
  });

  it('custom pricing takes priority over built-in', async () => {
    const customPricing: ModelPricing[] = [
      { model: 'gpt-4o', provider: 'openai', inputPer1K: 0.1, outputPer1K: 0.3, contextWindow: 128000 },
    ];
    const cost = new QhawayCost({ customPricing });
    expect(await cost.calculate('gpt-4o', 1000, 500)).toBe(0.1 * 1 + 0.3 * 0.5);
  });
});

describe('calculateCost standalone', () => {
  it('calculates cost correctly', async () => {
    expect(await calculateCost('gpt-4o', 1000, 500)).toBe(0.005 + 0.0075);
  });

  it('returns -1 for unknown model', async () => {
    expect(await calculateCost('unknown', 100, 50)).toBe(-1);
  });

  it('handles zero tokens', async () => {
    expect(await calculateCost('gpt-4o', 0, 0)).toBe(0);
  });
});

describe('resolvePricing', () => {
  it('finds pricing for known model', async () => {
    const p = await resolvePricing('gpt-4o');
    expect(p).toBeDefined();
    expect(p!.inputPer1K).toBe(0.005);
  });

  it('matches by exact model name', async () => {
    const p = await resolvePricing('claude-sonnet-4-20250514');
    expect(p).toBeDefined();
    expect(p!.model).toBe('claude-sonnet-4-20250514');
  });

  it('returns undefined for unknown model', async () => {
    expect(await resolvePricing('void-model')).toBeUndefined();
  });
});

describe('getDefaultPricing', () => {
  it('returns default pricing for known model', async () => {
    const p = await getDefaultPricing('gpt-4o');
    expect(p.inputPer1K).toBe(0.005);
  });

  it('returns fallback for unknown model', async () => {
    const p = await getDefaultPricing('unknown');
    expect(p.inputPer1K).toBe(0.002);
  });
});

describe('getBuiltinPricing', () => {
  it('returns all built-in models', () => {
    const list = getBuiltinPricing();
    expect(list.length).toBeGreaterThan(5);
    expect(list.some(p => p.model === 'gpt-4o')).toBe(true);
    expect(list.some(p => p.model === 'claude-sonnet-4')).toBe(true);
  });
});

describe('Aggregation', () => {
  const spans: QhawaySpan[] = [
    makeSpan({ user_id: 'alice', model: 'gpt-4o', agent_id: 'agent-a', cost_usd: 0.5, tokens_in: 100, tokens_out: 50, timestamp: '2026-07-29T10:00:00Z' }),
    makeSpan({ user_id: 'bob', model: 'gpt-4o-mini', agent_id: 'agent-a', cost_usd: 0.1, tokens_in: 200, tokens_out: 100, timestamp: '2026-07-29T11:00:00Z' }),
    makeSpan({ user_id: 'alice', model: 'claude-sonnet-4', agent_id: 'agent-b', cost_usd: 0.3, tokens_in: 150, tokens_out: 75, timestamp: '2026-07-30T10:00:00Z' }),
    makeSpan({ user_id: 'alice', model: 'gpt-4o', agent_id: 'agent-a', cost_usd: 0.25, tokens_in: 50, tokens_out: 25, timestamp: '2026-07-30T11:00:00Z' }),
  ];

  it('aggregateByUser groups cost by user', () => {
    const result = aggregateByUser(spans);
    expect(result).toHaveLength(2);
    const alice = result.find(r => r.value === 'alice');
    expect(alice).toBeDefined();
    expect(alice!.totalCostUsd).toBe(1.05);
    expect(alice!.callCount).toBe(3);
  });

  it('aggregateByModel groups cost by model', () => {
    const result = aggregateByModel(spans);
    expect(result).toHaveLength(3);
    const gpt4o = result.find(r => r.value === 'gpt-4o');
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.totalCostUsd).toBe(0.75);
  });

  it('aggregateByAgent groups cost by agent', () => {
    const result = aggregateByAgent(spans);
    expect(result).toHaveLength(2);
    const agentA = result.find(r => r.value === 'agent-a');
    expect(agentA).toBeDefined();
    expect(agentA!.totalCostUsd).toBe(0.85);
  });

  it('aggregateByDay groups cost by day', () => {
    const result = aggregateByDay(spans);
    expect(result).toHaveLength(2);
    const day1 = result.find(r => r.value === '2026-07-29');
    expect(day1).toBeDefined();
    expect(day1!.totalCostUsd).toBe(0.6);
  });

  it('getCostByUser filters by userId', () => {
    expect(getCostByUser(spans, 'alice')).toBe(1.05);
    expect(getCostByUser(spans, 'bob')).toBe(0.1);
    expect(getCostByUser(spans, 'charlie')).toBe(0);
  });

  it('getCostByModel filters by model', () => {
    expect(getCostByModel(spans, 'gpt-4o')).toBe(0.75);
  });

  it('getCostByAgent filters by agentId', () => {
    expect(getCostByAgent(spans, 'agent-b')).toBe(0.3);
  });

  it('getCostByDay filters by day', () => {
    expect(getCostByDay(spans, '2026-07-29')).toBe(0.6);
    expect(getCostByDay(spans, '2026-07-30')).toBe(0.55);
  });

  it('getCostByUser respects period filter', () => {
    const period = { start: '2026-07-30T00:00:00Z', end: '2026-07-30T23:59:59Z' };
    expect(getCostByUser(spans, 'alice', period)).toBe(0.55);
  });
});

describe('Prometheus Metrics', () => {
  const spans: QhawaySpan[] = [
    makeSpan({ model: 'gpt-4o', latency_ms: 500, tokens_in: 1000, tokens_out: 500, cost_usd: 0.0125, success: true }),
    makeSpan({ model: 'gpt-4o', latency_ms: 1500, tokens_in: 200, tokens_out: 100, cost_usd: 0.0025, success: true }),
    makeSpan({ model: 'gpt-4o-mini', latency_ms: 300, tokens_in: 500, tokens_out: 200, cost_usd: 0.0003, success: false }),
  ];

  it('computeMetrics returns correct counters', () => {
    const m = computeMetrics(spans);
    expect(m.counters.costByModel['gpt-4o']).toBe(0.015);
    expect(m.counters.costByModel['gpt-4o-mini']).toBe(0.0003);
    expect(m.counters.tokensInputByModel['gpt-4o']).toBe(1200);
    expect(m.counters.tokensOutputByModel['gpt-4o']).toBe(600);
    expect(m.counters.callsByModel['gpt-4o'].success).toBe(2);
    expect(m.counters.callsByModel['gpt-4o-mini'].success).toBe(0);
    expect(m.counters.callsByModel['gpt-4o-mini'].failure).toBe(1);
  });

  it('computeMetrics returns latency histogram data', () => {
    const m = computeMetrics(spans);
    expect(m.histograms.latencyByModel['gpt-4o']).toHaveLength(2);
    expect(m.histograms.latencyByModel['gpt-4o-mini']).toHaveLength(1);
  });

  it('generatePrometheusMetrics produces valid output format', () => {
    const output = generatePrometheusMetrics(spans);
    expect(output).toContain('# HELP qhaway_cost_total');
    expect(output).toContain('# TYPE qhaway_cost_total counter');
    expect(output).toContain('qhaway_cost_total{model="gpt-4o"');
    expect(output).toContain('# HELP qhaway_latency_seconds');
    expect(output).toContain('# TYPE qhaway_latency_seconds histogram');
    expect(output).toContain('qhaway_latency_seconds_bucket{model="gpt-4o",le="0.1"}');
    expect(output).toContain('qhaway_latency_seconds_bucket{model="gpt-4o",le="+Inf"}');
    expect(output).toContain('qhaway_latency_seconds_sum{model="gpt-4o"}');
    expect(output).toContain('qhaway_latency_seconds_count{model="gpt-4o"}');
    expect(output).toContain('# HELP qhaway_tokens_input_total');
    expect(output).toContain('# HELP qhaway_tokens_output_total');
    expect(output).toContain('# HELP qhaway_calls_total');
    expect(output).toContain('qhaway_calls_total{model="gpt-4o",success="true"} 2');
    expect(output).toContain('# EOF');
  });

  it('generatePrometheusMetrics handles empty spans', () => {
    const output = generatePrometheusMetrics([]);
    expect(output).toContain('# EOF');
    expect(output).not.toContain('qhaway_cost_total{');
  });

  it('emits rating metrics from spans with rating', () => {
    const rated = [
      makeSpan({ model: 'gpt-4o', rating: 1, cost_usd: 0.01 }),
      makeSpan({ model: 'gpt-4o', rating: -1, cost_usd: 0.05 }),
      makeSpan({ model: 'gpt-4o-mini', rating: 0, cost_usd: 0.001 }),
    ];
    const output = generatePrometheusMetrics(rated);
    expect(output).toContain('qhaway_rating_total{model="gpt-4o",rating="1"} 1');
    expect(output).toContain('qhaway_rating_total{model="gpt-4o",rating="-1"} 1');
    expect(output).toContain('qhaway_rating_total{model="gpt-4o-mini",rating="0"} 1');
    expect(output).toContain('qhaway_cost_by_rating_total{rating="1"} 0.01');
    expect(output).toContain('qhaway_cost_by_rating_total{rating="-1"} 0.05');
  });

  it('emits sayay decisions metric from sayay.check spans', () => {
    const sayay = [
      makeSpan({ model: 'budget-guard', tool_name: 'sayay.check', user_id: 'u1', metadata: { action: 'allow' } }),
      makeSpan({ model: 'budget-guard', tool_name: 'sayay.check', user_id: 'u1', metadata: { action: 'block' } }),
      makeSpan({ model: 'budget-guard', tool_name: 'sayay.check', user_id: 'u2', metadata: { action: 'degrade' } }),
      makeSpan({ model: 'gpt-4o', tool_name: 'agent.run', user_id: 'u1' }),
    ];
    const m = computeMetrics(sayay);
    expect(m.counters.sayayDecisions['u1']).toEqual({ allow: 1, block: 1 });
    expect(m.counters.sayayDecisions['u2']).toEqual({ degrade: 1 });

    const output = generatePrometheusMetrics(sayay);
    expect(output).toContain('# HELP qhaway_sayay_decisions_total');
    expect(output).toContain('qhaway_sayay_decisions_total{action="allow",user="u1"} 1');
    expect(output).toContain('qhaway_sayay_decisions_total{action="block",user="u1"} 1');
    expect(output).toContain('qhaway_sayay_decisions_total{action="degrade",user="u2"} 1');
    expect(output).not.toContain('qhaway_sayay_decisions_total{action="run"');
  });
});

describe('Edge cases', () => {
  it('handles undefined fields in aggregation', () => {
    const spans = [
      makeSpan({ user_id: undefined, model: 'gpt-4o', agent_id: undefined }),
      makeSpan({ user_id: undefined, model: 'gpt-4o', agent_id: undefined }),
    ];
    const byUser = aggregateByUser(spans);
    expect(byUser).toHaveLength(1);
    expect(byUser[0].value).toBe('unknown');
  });

  it('supports provider-specific pricing', async () => {
    const cost = new QhawayCost();
    const noProvider = await cost.calculate('gpt-4o', 1000, 500, 'openai');
    expect(noProvider).toBeGreaterThan(0);
  });
});
