import { describe, it, expect } from 'vitest';
import { aggregateRating, ratingStats } from './rating.js';
import type { QhawaySpan } from '../trace/index.js';

function makeSpan(overrides: Partial<QhawaySpan>): QhawaySpan {
  return {
    id: 'id',
    timestamp: '2026-08-03T12:00:00.000Z',
    model: 'gpt-4o',
    provider: 'openai',
    latency_ms: 100,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.01,
    success: true,
    ...overrides,
  };
}

describe('aggregateRating', () => {
  it('groups spans by model and rating', () => {
    const spans = [
      makeSpan({ model: 'gpt-4o', rating: 1, cost_usd: 0.02, latency_ms: 200 }),
      makeSpan({ model: 'gpt-4o', rating: 1, cost_usd: 0.04, latency_ms: 300 }),
      makeSpan({ model: 'gpt-4o', rating: -1, cost_usd: 0.05, latency_ms: 400 }),
      makeSpan({ model: 'claude-3-5', rating: -1, cost_usd: 0.08, latency_ms: 500 }),
    ];

    const result = aggregateRating(spans);
    expect(result).toHaveLength(3);

    const gptUp = result.find((r) => r.model === 'gpt-4o' && r.rating === 1);
    expect(gptUp).toBeDefined();
    expect(gptUp!.calls).toBe(2);
    expect(gptUp!.costUsd).toBeCloseTo(0.06);
    expect(gptUp!.avgLatencyMs).toBe(250);

    const gptDown = result.find((r) => r.model === 'gpt-4o' && r.rating === -1);
    expect(gptDown!.calls).toBe(1);
    expect(gptDown!.costUsd).toBeCloseTo(0.05);
  });

  it('ignores spans without rating', () => {
    const spans = [
      makeSpan({ rating: 1 }),
      makeSpan({ rating: undefined }),
    ];
    expect(aggregateRating(spans)).toHaveLength(1);
  });

  it('sorts by cost descending', () => {
    const spans = [
      makeSpan({ rating: 1, cost_usd: 0.02 }),
      makeSpan({ rating: -1, cost_usd: 0.1 }),
    ];
    const result = aggregateRating(spans);
    expect(result[0].rating).toBe(-1);
  });
});

describe('ratingStats', () => {
  it('computes thumbs up/down totals and rates', () => {
    const spans = [
      makeSpan({ rating: 1, cost_usd: 0.01 }),
      makeSpan({ rating: 1, cost_usd: 0.03 }),
      makeSpan({ rating: -1, cost_usd: 0.05 }),
      makeSpan({ rating: 0 }),
      makeSpan({ rating: undefined }),
    ];

    const stats = ratingStats(spans);
    expect(stats.totalRated).toBe(4);
    expect(stats.thumbsUp).toBe(2);
    expect(stats.thumbsDown).toBe(1);
    expect(stats.neutral).toBe(1);
    expect(stats.avgCostPerThumbsUp).toBeCloseTo(0.02);
    expect(stats.avgCostPerThumbsDown).toBeCloseTo(0.05);
    expect(stats.thumbsDownRate).toBeCloseTo(0.25);
  });
});
