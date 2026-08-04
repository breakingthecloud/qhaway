import type { QhawaySpan } from '../trace/index.js';

export interface PrometheusMetrics {
  raw: string;
  counters: {
    costByModel: Record<string, number>;
    tokensInputByModel: Record<string, number>;
    tokensOutputByModel: Record<string, number>;
    callsByModel: Record<string, { success: number; failure: number }>;
    ratingByModel: Record<string, { '1': number; '-1': number; '0': number }>;
    costByRating: Record<string, number>;
  };
  histograms: {
    latencyByModel: Record<string, number[]>;
  };
}

export function generatePrometheusMetrics(spans: QhawaySpan[]): string {
  const { counters, histograms } = computeMetrics(spans);
  const lines: string[] = [];

  lines.push('# HELP qhaway_cost_total Total cost by model and user');
  lines.push('# TYPE qhaway_cost_total counter');
  for (const [model, cost] of Object.entries(counters.costByModel)) {
    lines.push(`qhaway_cost_total{model="${model}",provider="",user=""} ${cost}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_latency_seconds LLM call latency distribution');
  lines.push('# TYPE qhaway_latency_seconds histogram');
  const buckets = [0.1, 0.5, 1, 2, 5, 10];
  for (const [model, latencies] of Object.entries(histograms.latencyByModel)) {
    const sorted = [...latencies].sort((a, b) => a - b);
    for (const le of buckets) {
      const count = sorted.filter(l => l <= le).length;
      lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="${le}"} ${count}`);
    }
    const sum = latencies.reduce((a, b) => a + b, 0);
    lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="+Inf"} ${latencies.length}`);
    lines.push(`qhaway_latency_seconds_sum{model="${model}"} ${round(sum / 1000, 4)}`);
    lines.push(`qhaway_latency_seconds_count{model="${model}"} ${latencies.length}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_tokens_input_total Input tokens consumed');
  lines.push('# TYPE qhaway_tokens_input_total counter');
  for (const [model, tokens] of Object.entries(counters.tokensInputByModel)) {
    lines.push(`qhaway_tokens_input_total{model="${model}"} ${tokens}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_tokens_output_total Output tokens generated');
  lines.push('# TYPE qhaway_tokens_output_total counter');
  for (const [model, tokens] of Object.entries(counters.tokensOutputByModel)) {
    lines.push(`qhaway_tokens_output_total{model="${model}"} ${tokens}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_calls_total Total LLM calls');
  lines.push('# TYPE qhaway_calls_total counter');
  for (const [model, counts] of Object.entries(counters.callsByModel)) {
    lines.push(`qhaway_calls_total{model="${model}",success="true"} ${counts.success}`);
    lines.push(`qhaway_calls_total{model="${model}",success="false"} ${counts.failure}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_rating_total Total user feedback ratings by model and rating');
  lines.push('# TYPE qhaway_rating_total counter');
  for (const [model, ratings] of Object.entries(counters.ratingByModel)) {
    for (const rating of ['1', '-1', '0']) {
      const count = ratings[rating as keyof typeof ratings];
      if (count > 0) {
        lines.push(`qhaway_rating_total{model="${model}",rating="${rating}"} ${count}`);
      }
    }
  }

  lines.push('');
  lines.push('# HELP qhaway_cost_by_rating_total Cost attributed to rated calls by rating');
  lines.push('# TYPE qhaway_cost_by_rating_total counter');
  for (const [rating, cost] of Object.entries(counters.costByRating)) {
    if (cost > 0) {
      lines.push(`qhaway_cost_by_rating_total{rating="${rating}"} ${cost}`);
    }
  }

  lines.push('');
  lines.push('# EOF');
  return lines.join('\n');
}

export function computeMetrics(spans: QhawaySpan[]): PrometheusMetrics {
  const costByModel: Record<string, number> = {};
  const tokensInputByModel: Record<string, number> = {};
  const tokensOutputByModel: Record<string, number> = {};
  const callsByModel: Record<string, { success: number; failure: number }> = {};
  const ratingByModel: Record<string, { '1': number; '-1': number; '0': number }> = {};
  const costByRating: Record<string, number> = {};
  const latencyByModel: Record<string, number[]> = {};

  for (const span of spans) {
    const m = span.model;
    costByModel[m] = (costByModel[m] || 0) + span.cost_usd;
    tokensInputByModel[m] = (tokensInputByModel[m] || 0) + span.tokens_in;
    tokensOutputByModel[m] = (tokensOutputByModel[m] || 0) + span.tokens_out;

    if (!callsByModel[m]) callsByModel[m] = { success: 0, failure: 0 };
    if (span.success) callsByModel[m].success++;
    else callsByModel[m].failure++;

    if (span.rating !== undefined) {
      if (!ratingByModel[m]) ratingByModel[m] = { '1': 0, '-1': 0, '0': 0 };
      ratingByModel[m][String(span.rating) as '1' | '-1' | '0']++;
      costByRating[String(span.rating)] = (costByRating[String(span.rating)] || 0) + span.cost_usd;
    }

    if (!latencyByModel[m]) latencyByModel[m] = [];
    latencyByModel[m].push(span.latency_ms);
  }

  return {
    raw: '',
    counters: {
      costByModel: roundAll(costByModel, 6),
      tokensInputByModel,
      tokensOutputByModel,
      callsByModel,
      ratingByModel,
      costByRating: roundAll(costByRating, 6),
    },
    histograms: { latencyByModel },
  };
}

function roundAll(record: Record<string, number>, decimals: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = round(v, decimals);
  }
  return result;
}

function round(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
