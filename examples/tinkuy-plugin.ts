import { Agent, defineTool, simpleTask } from '@carloscortezcloud/tinkuy-agent';
import { StyrRouter } from '@carloscortezcloud/styrr-llm';
import { SayayGuard, MemoryStorage } from '@carloscortezcloud/sayay-guard';
import { QhawayTrace, ConsoleStorage } from '@carloscortezcloud/qhaway';
import { QhawayTinkuyPlugin } from '@carloscortezcloud/qhaway/tinkuy';
import { QhawayCost, aggregateByAgent, getCostBySession } from '@carloscortezcloud/qhaway/cost';

const storage = new ConsoleStorage();
const trace = new QhawayTrace(storage, { agent_id: 'demo-agent' });

const qhawayPlugin = new QhawayTinkuyPlugin({
  storage,
  agentName: 'demo-agent',
  captureToolPayloads: false,
});

const router = new StyrRouter({
  models: [{ id: 'openai/gpt-4o-mini', provider: 'openrouter' }],
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const agent = new Agent({
  router,
  tools: [
    simpleTask('get_time', 'Get the current time', async () => new Date().toISOString()),
    defineTool({
      name: 'calculate',
      description: 'Perform arithmetic',
      parameters: { type: 'object', properties: { expr: { type: 'string' } }, required: ['expr'] },
      async execute(args) { return eval(args.expr as string); },
    }),
  ],
  systemPrompt: 'You are a helpful assistant. Use tools when needed.',
  onIteration: (e) => qhawayPlugin.hooks.onIteration(e),
  onToolCall: (e) => qhawayPlugin.hooks.onToolCall(e),
  onComplete: (e) => qhawayPlugin.hooks.onComplete(e),
});

const result = await agent.run('What time is it? Also calculate 42 * 7.');
console.log('Agent:', result.text);
console.log(`Iterations: ${result.iterations}, Cost: $${result.estimatedCostUsd}`);
