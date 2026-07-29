import { StyrRouter } from '@carloscortezcloud/styrr-llm';
import { SayayGuard, MemoryStorage } from '@carloscortezcloud/sayay-guard';
import { Agent } from '@carloscortezcloud/tinkuy-agent';
import { QhawayTrace, ConsoleStorage } from '@carloscortezcloud/qhaway';
import { QhawayCost, generatePrometheusMetrics, getCostByUser, aggregateByModel } from '@carloscortezcloud/qhaway/cost';
import type { QhawaySpan } from '@carloscortezcloud/qhaway/trace';

const API_KEY = process.env.OPENROUTER_API_KEY!;

const router = new StyrRouter({
  models: [
    { id: 'openai/gpt-4o', provider: 'openrouter' },
    { id: 'anthropic/claude-sonnet-4', provider: 'openrouter' },
  ],
  apiKey: API_KEY,
});

const storage: ConsoleStorage & { spans: QhawaySpan[] } = {
  spans: [],
  async write(span) {
    this.spans.push(span);
    console.log(`[qhaway] ${span.model} | ${span.latency_ms}ms | $${span.cost_usd} | success=${span.success}`);
  },
};

const trace = new QhawayTrace(storage, { agent_id: 'sstt-demo' });
const costCalc = new QhawayCost();

const sayay = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 5.0, perCallMaxUsd: 0.10 },
  warnThreshold: 0.8,
  degradeThreshold: 0.9,
  degradeToModel: 'openai/gpt-4o-mini',
});

const tracedCall = trace.wrap(
  (messages: Parameters<typeof router.call>[0]) => router.call(messages),
  { provider: 'openrouter' },
);

async function askLLM(userId: string, prompt: string) {
  const decision = await sayay.check(userId);
  if (decision.action === 'block') {
    console.log(`[sayay] BLOCKED: ${decision.reason}`);
    return null;
  }

  const model = decision.action === 'degrade' ? decision.suggestedModel : undefined;
  const result = await tracedCall([
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: prompt },
  ]);

  const usage = result.usage ?? { promptTokens: 0, completionTokens: 0 };
  const span: QhawaySpan = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    model: model ?? result.modelUsed,
    provider: 'openrouter',
    latency_ms: result.latencyMs,
    tokens_in: usage.promptTokens ?? 0,
    tokens_out: usage.completionTokens ?? 0,
    cost_usd: 0,
    user_id: userId,
    success: true,
  };

  const enriched = await costCalc.apply(span);
  await sayay.record(userId, enriched.cost_usd);
  await storage.write(enriched);

  return result.text;
}

async function fullStackDemo() {
  const response1 = await askLLM('alice', 'What is the capital of France?');
  console.log('Response:', response1);

  const response2 = await askLLM('alice', 'Explain quantum computing in 3 sentences.');
  console.log('Response:', response2);

  const aliceCost = getCostByUser(storage.spans, 'alice');
  console.log(`\nTotal cost for alice: $${aliceCost}`);

  const byModel = aggregateByModel(storage.spans);
  for (const agg of byModel) {
    console.log(`${agg.value}: $${agg.totalCostUsd} (${agg.callCount} calls)`);
  }

  const promMetrics = generatePrometheusMetrics(storage.spans);
  console.log('\nPrometheus metrics:\n' + promMetrics);
}

const tinkuyAgent = new Agent({
  router,
  guard: sayay,
  userId: 'bob',
  tools: [],
  systemPrompt: 'You are a helpful assistant with budget awareness.',
  onIteration: async (iteration, ctx) => {
    const span: QhawaySpan = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      model: ctx.modelUsed ?? 'unknown',
      provider: 'openrouter',
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      user_id: 'bob',
      success: true,
    };
    const enriched = await costCalc.apply(span);
    await storage.write(enriched);
  },
});
