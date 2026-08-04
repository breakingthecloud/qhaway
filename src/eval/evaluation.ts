import type { QhawaySpan } from '../trace/index.js';

export interface EvalRunResult {
  eval_run_id: string;
  model: string;
  pass: boolean;
  score: number;
  costUsd: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  prompt?: string;
  expected?: string;
  actual?: string;
  timestamp: string;
}

export interface EvalRunAggregation {
  eval_run_id: string;
  model: string;
  totalCalls: number;
  passed: number;
  failed: number;
  passRate: number;
  totalCostUsd: number;
  totalTokens: number;
  avgLatencyMs: number;
  avgScore: number;
  costPerScorePoint: number;
}

const EVAL_RUN_META = 'eval_run_id';
const EVAL_SCORE_META = 'eval_score';
const EVAL_PASS_META = 'eval_pass';

export interface EvalLabelOptions {
  score?: number;
  pass?: boolean;
  prompt?: string;
  expected?: string;
  actual?: string;
}

export function labelEvalRun(span: QhawaySpan, evalRunId: string, opts: EvalLabelOptions = {}): QhawaySpan {
  return {
    ...span,
    metadata: {
      ...span.metadata,
      [EVAL_RUN_META]: evalRunId,
      ...(opts.score !== undefined ? { [EVAL_SCORE_META]: opts.score } : {}),
      ...(opts.pass !== undefined ? { [EVAL_PASS_META]: opts.pass } : {}),
      ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
      ...(opts.expected !== undefined ? { expected: opts.expected } : {}),
      ...(opts.actual !== undefined ? { actual: opts.actual } : {}),
    },
  };
}

export function toEvalRun(span: QhawaySpan): EvalRunResult | undefined {
  const meta = span.metadata || {};
  const evalRunId = meta[EVAL_RUN_META];
  if (typeof evalRunId !== 'string' || evalRunId.length === 0) return undefined;

  const score = typeof meta[EVAL_SCORE_META] === 'number' ? meta[EVAL_SCORE_META] : undefined;
  const pass = typeof meta[EVAL_PASS_META] === 'boolean' ? meta[EVAL_PASS_META] : undefined;

  return {
    eval_run_id: evalRunId,
    model: span.model,
    pass: pass ?? (score !== undefined ? score >= 0.5 : span.success),
    score: score ?? (span.success ? 1 : 0),
    costUsd: span.cost_usd,
    latencyMs: span.latency_ms,
    tokensIn: span.tokens_in,
    tokensOut: span.tokens_out,
    prompt: meta.prompt as string | undefined,
    expected: meta.expected as string | undefined,
    actual: meta.actual as string | undefined,
    timestamp: span.timestamp,
  };
}

export function aggregateEvalRuns(spans: QhawaySpan[]): EvalRunAggregation[] {
  const groups = new Map<string, EvalRunAggregation>();

  for (const span of spans) {
    const run = toEvalRun(span);
    if (!run) continue;
    const key = `${run.eval_run_id}:${run.model}`;
    const existing = groups.get(key) || {
      eval_run_id: run.eval_run_id,
      model: run.model,
      totalCalls: 0,
      passed: 0,
      failed: 0,
      passRate: 0,
      totalCostUsd: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      avgScore: 0,
      costPerScorePoint: 0,
    };
    existing.totalCalls++;
    if (run.pass) existing.passed++;
    else existing.failed++;
    existing.totalCostUsd += run.costUsd;
    existing.totalTokens += run.tokensIn + run.tokensOut;
    existing.avgLatencyMs += run.latencyMs;
    existing.avgScore += run.score;
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .map((g) => {
      const passRate = round(g.passed / g.totalCalls, 4);
      const avgScore = round(g.avgScore / g.totalCalls, 4);
      return {
        ...g,
        passRate,
        avgLatencyMs: round(g.avgLatencyMs / g.totalCalls, 1),
        avgScore,
        costPerScorePoint: avgScore > 0 ? round(g.totalCostUsd / avgScore, 6) : 0,
      };
    })
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

function round(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
