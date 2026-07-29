import type { QhawaySpan } from '../trace/index.js';

export interface CostAggregation {
  dimension: string;
  value: string;
  totalCostUsd: number;
  totalTokens: number;
  callCount: number;
}

export function aggregateByUser(spans: QhawaySpan[], userId?: string): CostAggregation[] {
  return aggregate(spans, 'user_id', userId);
}

export function aggregateByModel(spans: QhawaySpan[], model?: string): CostAggregation[] {
  return aggregate(spans, 'model', model);
}

export function aggregateByAgent(spans: QhawaySpan[], agentId?: string): CostAggregation[] {
  return aggregate(spans, 'agent_id', agentId);
}

export function aggregateByDay(spans: QhawaySpan[], day?: string): CostAggregation[] {
  return aggregate(spans, 'day', day, spanToDayKey);
}

export function getCostByUser(spans: QhawaySpan[], userId: string, period?: { start: string; end: string }): number {
  return filterByPeriod(spans, period)
    .filter(s => s.user_id === userId)
    .reduce((sum, s) => sum + s.cost_usd, 0);
}

export function getCostByModel(spans: QhawaySpan[], model: string, period?: { start: string; end: string }): number {
  return filterByPeriod(spans, period)
    .filter(s => s.model === model)
    .reduce((sum, s) => sum + s.cost_usd, 0);
}

export function getCostByAgent(spans: QhawaySpan[], agentId: string, period?: { start: string; end: string }): number {
  return filterByPeriod(spans, period)
    .filter(s => s.agent_id === agentId)
    .reduce((sum, s) => sum + s.cost_usd, 0);
}

export function getCostByDay(spans: QhawaySpan[], day: string, period?: { start: string; end: string }): number {
  return filterByPeriod(spans, period)
    .filter(s => spanToDayKey(s) === day)
    .reduce((sum, s) => sum + s.cost_usd, 0);
}

function aggregate(
  spans: QhawaySpan[],
  dimension: string,
  filterValue?: string,
  keyFn: (s: QhawaySpan) => string = spanDimensionKey(dimension),
): CostAggregation[] {
  let filtered = spans;
  if (filterValue) {
    filtered = spans.filter(s => getSpanField(s, dimension) === filterValue);
  }

  const groups = new Map<string, { cost: number; tokens: number; count: number }>();

  for (const span of filtered) {
    const key = keyFn(span);
    const existing = groups.get(key) || { cost: 0, tokens: 0, count: 0 };
    existing.cost += span.cost_usd;
    existing.tokens += span.tokens_in + span.tokens_out;
    existing.count++;
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([key, data]) => ({
      dimension,
      value: key,
      totalCostUsd: round(data.cost),
      totalTokens: data.tokens,
      callCount: data.count,
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

function spanToDayKey(s: QhawaySpan): string {
  return s.timestamp.slice(0, 10);
}

function spanDimensionKey(dimension: string): (s: QhawaySpan) => string {
  return (s: QhawaySpan) => getSpanField(s, dimension);
}

function getSpanField(s: QhawaySpan, field: string): string {
  switch (field) {
    case 'user_id': return s.user_id || 'unknown';
    case 'model': return s.model;
    case 'agent_id': return s.agent_id || 'unknown';
    case 'day': return spanToDayKey(s);
    default: return (s as unknown as Record<string, string>)[field] || 'unknown';
  }
}

function filterByPeriod(spans: QhawaySpan[], period?: { start: string; end: string }): QhawaySpan[] {
  if (!period) return spans;
  return spans.filter(s => {
    const t = s.timestamp;
    return t >= period.start && t <= period.end;
  });
}

function round(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}
