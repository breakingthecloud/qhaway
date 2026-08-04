/**
 * Qhaway-011 — Eval comparison example.
 *
 * Demonstrates how to label spans with an eval_run_id, aggregate an A/B model
 * comparison, and print Prometheus metrics per eval run.
 *
 * Run with:
 *   pnpm tsx examples/eval-comparison.ts
 */
import { MemoryStorage } from '@carloscortezcloud/qhaway';
import { QhawayTrace } from '@carloscortezcloud/qhaway/trace';
import type { QhawaySpan } from '@carloscortezcloud/qhaway/trace';
import { labelEvalRun, aggregateEvalRuns, generateEvalMetrics } from '@carloscortezcloud/qhaway/eval';

async function main(): Promise<void> {
  const storage = new MemoryStorage();
  const trace = new QhawayTrace(storage);

  const scenarios = [
    { evalRun: 'run-1', model: 'gpt-4o', score: 0.9, cost: 0.021, latency: 250 },
    { evalRun: 'run-1', model: 'gpt-4o', score: 0.4, cost: 0.018, latency: 290 },
    { evalRun: 'run-2', model: 'gpt-4o-mini', score: 0.85, cost: 0.002, latency: 180 },
    { evalRun: 'run-2', model: 'gpt-4o-mini', score: 0.8, cost: 0.0018, latency: 220 },
  ];

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const span = await trace.wrap(
      async () => `eval output for scenario ${i + 1}`,
      {
        model: s.model,
        provider: 'openai',
        tokens_in: 150,
        tokens_out: 40,
        cost_usd: s.cost,
        latency_ms: s.latency,
        session_id: 'eval-comparison-demo',
      },
    )(`Scenario ${i + 1}`);
    void span;

    const last = readSpans(storage)[readSpans(storage).length - 1];
    await storage.write(labelEvalRun(last, s.evalRun, {
      score: s.score,
      pass: s.score >= 0.5,
      actual: `scenario-${i + 1}`,
    }));
  }

  await trace.close();

  const spans = readSpans(storage);

  console.log('=== Eval runs by model ===');
  for (const agg of aggregateEvalRuns(spans)) {
    console.log(
      `${agg.eval_run_id} ${agg.model}: pass=${agg.passRate} cost=$${agg.totalCostUsd.toFixed(4)} ` +
      `score=${agg.avgScore} $/point=${agg.costPerScorePoint.toFixed(6)}`,
    );
  }

  console.log('\n=== Prometheus metrics ===');
  console.log(generateEvalMetrics(spans));
}

function readSpans(storage: MemoryStorage): QhawaySpan[] {
  return (storage as unknown as { spans: QhawaySpan[] }).spans;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
