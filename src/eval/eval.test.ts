import { describe, it, expect } from 'vitest';
import { labelEvalRun, toEvalRun, aggregateEvalRuns } from './evaluation.js';
import { parsePromptfooOutput, parsePromptfooResults } from './promptfoo.js';
import { generateEvalMetrics, computeEvalMetrics, evalRunIds } from './metrics.js';
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

describe('labelEvalRun', () => {
  it('tags a span with eval_run_id and score metadata', () => {
    const span = makeSpan({});
    const tagged = labelEvalRun(span, 'run-a', { score: 0.8, pass: true });

    const run = toEvalRun(tagged);
    expect(run).toBeDefined();
    expect(run!.eval_run_id).toBe('run-a');
    expect(run!.score).toBe(0.8);
    expect(run!.pass).toBe(true);
    expect(run!.model).toBe('gpt-4o');
  });

  it('returns undefined for spans without eval_run_id', () => {
    expect(toEvalRun(makeSpan({}))).toBeUndefined();
  });
});

describe('aggregateEvalRuns', () => {
  it('groups by eval run and model with pass rate and cost per score point', () => {
    const spans = [
      labelEvalRun(makeSpan({ model: 'gpt-4o', cost_usd: 0.02, latency_ms: 100 }), 'run-a', { score: 1, pass: true }),
      labelEvalRun(makeSpan({ model: 'gpt-4o', cost_usd: 0.05, latency_ms: 300 }), 'run-a', { score: 0.4, pass: false }),
      labelEvalRun(makeSpan({ model: 'claude-3-5', cost_usd: 0.08, latency_ms: 500 }), 'run-a', { score: 0.9, pass: true }),
    ];

    const result = aggregateEvalRuns(spans);
    expect(result).toHaveLength(2);

    const gpt = result.find((r) => r.model === 'gpt-4o');
    expect(gpt!.totalCalls).toBe(2);
    expect(gpt!.passed).toBe(1);
    expect(gpt!.failed).toBe(1);
    expect(gpt!.passRate).toBeCloseTo(0.5);
    expect(gpt!.totalCostUsd).toBeCloseTo(0.07);
    expect(gpt!.avgLatencyMs).toBe(200);
    expect(gpt!.avgScore).toBeCloseTo(0.7);
    expect(gpt!.costPerScorePoint).toBeCloseTo(0.07 / 0.7);
  });
});

describe('parsePromptfooOutput', () => {
  const promptfooRaw = {
    evalId: 'pf-run-1',
    results: [
      {
        prompt: { raw: 'What is 2+2?' },
        response: { output: '4' },
        pass: true,
        score: 1,
        latencyMs: 120,
        cost: 0.001,
        tokens: { input: 50, output: 20 },
        provider: { id: 'openai:gpt-4o-mini' },
      },
      {
        prompt: { raw: 'Explain gravity' },
        response: { output: 'nonsense' },
        pass: false,
        score: 0.2,
        latencyMs: 400,
        cost: 0.01,
        tokens: { input: 100, output: 60 },
        provider: { id: 'openai:gpt-4o-mini' },
      },
    ],
  };

  it('converts promptfoo results into labeled spans', () => {
    const spans = parsePromptfooOutput(promptfooRaw);
    expect(spans).toHaveLength(2);
    expect(spans[0].model).toBe('openai:gpt-4o-mini');
    expect(spans[0].cost_usd).toBe(0.001);

    const run = toEvalRun(spans[0]);
    expect(run!.eval_run_id).toBe('pf-run-1');
    expect(run!.pass).toBe(true);
  });

  it('returns EvalRunResult list via parsePromptfooResults', () => {
    const runs = parsePromptfooResults(promptfooRaw);
    expect(runs).toHaveLength(2);
    expect(runs[1].pass).toBe(false);
    expect(runs[1].eval_run_id).toBe('pf-run-1');
  });

  it('handles invalid input', () => {
    expect(parsePromptfooOutput(null)).toHaveLength(0);
    expect(parsePromptfooOutput({ nope: true })).toHaveLength(0);
  });
});

describe('eval metrics', () => {
  it('computes byRun aggregation and exposes eval run ids', () => {
    const spans = [
      labelEvalRun(makeSpan({ model: 'gpt-4o' }), 'run-a', { score: 1, pass: true }),
      labelEvalRun(makeSpan({ model: 'gpt-4o' }), 'run-b', { score: 0.5, pass: true }),
    ];
    const { byRun } = computeEvalMetrics(spans);
    expect(byRun).toHaveLength(2);
    expect(evalRunIds(spans)).toEqual(['run-a', 'run-b']);
  });

  it('generates Prometheus lines for eval metrics', () => {
    const spans = [
      labelEvalRun(makeSpan({ model: 'gpt-4o', cost_usd: 0.01 }), 'run-a', { score: 1, pass: true }),
      labelEvalRun(makeSpan({ model: 'gpt-4o', cost_usd: 0.02 }), 'run-a', { score: 0.2, pass: false }),
    ];
    const output = generateEvalMetrics(spans);
    expect(output).toContain('qhaway_eval_run_calls_total{eval_run="run-a",model="gpt-4o"} 2');
    expect(output).toContain('qhaway_eval_run_passed_total{eval_run="run-a",model="gpt-4o"} 1');
    expect(output).toContain('qhaway_eval_run_failed_total{eval_run="run-a",model="gpt-4o"} 1');
    expect(output).toContain('qhaway_eval_run_cost_total{eval_run="run-a",model="gpt-4o"} 0.03');
    expect(output).toContain('# EOF');
  });

  it('handles empty spans', () => {
    expect(generateEvalMetrics([])).toContain('# EOF');
    expect(evalRunIds([])).toHaveLength(0);
  });
});
