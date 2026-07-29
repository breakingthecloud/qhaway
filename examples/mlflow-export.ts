import { QhawayMLflow } from '@carloscortezcloud/qhaway/mlflow';

const exporter = new QhawayMLflow({
  trackingUri: 'http://localhost:5000',
  experimentName: 'finops-agent-runs',
});

// Streaming mode — implementa QhawayStorage, úsalo con CompositeStorage
// import { CompositeStorage } from '@carloscortezcloud/qhaway';
// const storage = new CompositeStorage([d1Storage, exporter]);

// Batch mode — exporta spans existentes agrupados por session_id
await exporter.exportSpans([
  {
    id: 'span-1', timestamp: new Date().toISOString(),
    model: 'gpt-4o', provider: 'openai',
    latency_ms: 1200, tokens_in: 450, tokens_out: 180,
    cost_usd: 0.008, success: true,
    session_id: 'session-abc',
    agent_id: 'my-agent',
  },
  {
    id: 'span-2', timestamp: new Date().toISOString(),
    model: 'claude-sonnet-4', provider: 'anthropic',
    latency_ms: 3400, tokens_in: 890, tokens_out: 320,
    cost_usd: 0.015, success: true,
    session_id: 'session-abc',
    agent_id: 'my-agent',
  },
]);

console.log('Spans exported to MLflow!');
