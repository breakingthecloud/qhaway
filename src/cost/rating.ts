import type { QhawaySpan } from '../trace/index.js';

export type Rating = 1 | -1 | 0;

export interface RatingAggregation {
  model: string;
  rating: Rating;
  calls: number;
  costUsd: number;
  avgLatencyMs: number;
  successCount: number;
  failureCount: number;
}

export interface RatingStats {
  totalRated: number;
  thumbsUp: number;
  thumbsDown: number;
  neutral: number;
  avgCostPerThumbsUp: number;
  avgCostPerThumbsDown: number;
  thumbsDownRate: number;
}

export function aggregateRating(spans: QhawaySpan[]): RatingAggregation[] {
  const groups = new Map<string, RatingAggregation>();

  for (const span of spans) {
    if (span.rating === undefined) continue;
    const key = `${span.model}:${span.rating}`;
    const existing = groups.get(key) || {
      model: span.model,
      rating: span.rating,
      calls: 0,
      costUsd: 0,
      avgLatencyMs: 0,
      successCount: 0,
      failureCount: 0,
    };
    existing.calls++;
    existing.costUsd += span.cost_usd;
    existing.avgLatencyMs += span.latency_ms;
    if (span.success) existing.successCount++;
    else existing.failureCount++;
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .map((g) => ({ ...g, avgLatencyMs: round(g.avgLatencyMs / g.calls, 1) }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

export function ratingStats(spans: QhawaySpan[]): RatingStats {
  const rated = spans.filter((s) => s.rating !== undefined);
  const costFor = (r: Rating) =>
    rated.filter((s) => s.rating === r).reduce((sum, s) => sum + s.cost_usd, 0);

  const thumbsUp = rated.filter((s) => s.rating === 1).length;
  const thumbsDown = rated.filter((s) => s.rating === -1).length;
  const neutral = rated.filter((s) => s.rating === 0).length;

  return {
    totalRated: rated.length,
    thumbsUp,
    thumbsDown,
    neutral,
    avgCostPerThumbsUp: thumbsUp > 0 ? round(costFor(1) / thumbsUp, 6) : 0,
    avgCostPerThumbsDown: thumbsDown > 0 ? round(costFor(-1) / thumbsDown, 6) : 0,
    thumbsDownRate: rated.length > 0 ? round(thumbsDown / rated.length, 4) : 0,
  };
}

function round(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
