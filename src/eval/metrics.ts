import type { QhawaySpan } from '../trace/index.js';
import { aggregateEvalRuns, toEvalRun } from './evaluation.js';

export interface EvalMetrics {
  raw: string;
  byRun: {
    eval_run_id: string;
    model: string;
    cost: number;
    calls: number;
    passed: number;
    failed: number;
    tokens: number;
    score: number;
  }[];
}

export function generateEvalMetrics(spans: QhawaySpan[]): string {
  const { byRun } = computeEvalMetrics(spans);
  const lines: string[] = [];

  lines.push('# HELP qhaway_eval_run_calls_total Total eval cases by run and model');
  lines.push('# TYPE qhaway_eval_run_calls_total counter');
  for (const r of byRun) {
    lines.push(`qhaway_eval_run_calls_total{eval_run="${r.eval_run_id}",model="${r.model}"} ${r.calls}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_eval_run_passed_total Passed eval cases by run and model');
  lines.push('# TYPE qhaway_eval_run_passed_total counter');
  for (const r of byRun) {
    lines.push(`qhaway_eval_run_passed_total{eval_run="${r.eval_run_id}",model="${r.model}"} ${r.passed}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_eval_run_failed_total Failed eval cases by run and model');
  lines.push('# TYPE qhaway_eval_run_failed_total counter');
  for (const r of byRun) {
    lines.push(`qhaway_eval_run_failed_total{eval_run="${r.eval_run_id}",model="${r.model}"} ${r.failed}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_eval_run_cost_total Cost by eval run and model');
  lines.push('# TYPE qhaway_eval_run_cost_total counter');
  for (const r of byRun) {
    lines.push(`qhaway_eval_run_cost_total{eval_run="${r.eval_run_id}",model="${r.model}"} ${r.cost}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_eval_run_tokens_total Tokens consumed by eval run and model');
  lines.push('# TYPE qhaway_eval_run_tokens_total counter');
  for (const r of byRun) {
    lines.push(`qhaway_eval_run_tokens_total{eval_run="${r.eval_run_id}",model="${r.model}"} ${r.tokens}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_eval_run_score Avg score by eval run and model');
  lines.push('# TYPE qhaway_eval_run_score gauge');
  for (const r of byRun) {
    lines.push(`qhaway_eval_run_score{eval_run="${r.eval_run_id}",model="${r.model}"} ${r.score}`);
  }

  lines.push('');
  lines.push('# EOF');
  return lines.join('\n');
}

export function computeEvalMetrics(spans: QhawaySpan[]): EvalMetrics {
  const agg = aggregateEvalRuns(spans);
  const byRun = agg.map((a) => ({
    eval_run_id: a.eval_run_id,
    model: a.model,
    cost: round(a.totalCostUsd, 6),
    calls: a.totalCalls,
    passed: a.passed,
    failed: a.failed,
    tokens: a.totalTokens,
    score: a.avgScore,
  }));

  return { raw: '', byRun };
}

export function evalRunIds(spans: QhawaySpan[]): string[] {
  const ids = new Set<string>();
  for (const span of spans) {
    const run = toEvalRun(span);
    if (run) ids.add(run.eval_run_id);
  }
  return Array.from(ids).sort();
}

function round(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
