/**
 * Qhaway + MLflow example — run with `pnpm tsx test/mlflow/example.mjs`
 *
 * Requires: MLflow server running on localhost:5001
 *   docker compose -f test/docker/docker-compose.yml up -d mlflow
 */

import { QhawayMLflow } from '@carloscortezcloud/qhaway/mlflow';

const MLFLOW_URI = process.env.MLFLOW_URI || 'http://localhost:5001';
const EXPERIMENT = process.env.EXPERIMENT || 'qhaway-demo';

const exporter = new QhawayMLflow({
  trackingUri: MLFLOW_URI,
  experimentName: EXPERIMENT,
});

const spans = [
  {
    id: 'span-1',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    provider: 'openai',
    latency_ms: 1200,
    tokens_in: 450,
    tokens_out: 180,
    cost_usd: 0.008,
    success: true,
    session_id: 'session-demo-1',
    agent_id: 'demo-agent',
    tool_name: 'agent.run',
  },
  {
    id: 'span-2',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    provider: 'openai',
    latency_ms: 3400,
    tokens_in: 890,
    tokens_out: 320,
    cost_usd: 0.015,
    success: true,
    session_id: 'session-demo-1',
    agent_id: 'demo-agent',
    tool_name: 'search_knowledge',
  },
  {
    id: 'span-3',
    timestamp: new Date().toISOString(),
    model: 'claude-sonnet-4',
    provider: 'anthropic',
    latency_ms: 500,
    tokens_in: 120,
    tokens_out: 60,
    cost_usd: 0.003,
    success: false,
    error: 'Rate limit exceeded, retried with gpt-4o-mini',
    session_id: 'session-demo-2',
    agent_id: 'demo-agent',
  },
];

console.log(`Exporting ${spans.length} spans to MLflow at ${MLFLOW_URI}...`);
console.log(`Experiment: ${EXPERIMENT}`);
console.log(`Sessions: ${[...new Set(spans.map(s => s.session_id))].join(', ')}`);
console.log('');

await exporter.exportSpans(spans);

console.log('✅ Done! Open MLflow UI:');
console.log(`   http://localhost:5001`);
console.log(`   Experiment: ${EXPERIMENT}`);
console.log(`   You should see ${[...new Set(spans.map(s => s.session_id))].length} runs (one per session)`);
