import { QhawayTrace, ConsoleStorage, CompositeStorage, QhawayOtelExporter, QhawayOtelStorage } from '@carloscortezcloud/qhaway';

const API_KEY = process.env.HONEYCOMB_API_KEY || '';

const otel = new QhawayOtelExporter({
  endpoint: 'https://api.honeycomb.io/v1/traces',
  headers: { 'X-Honeycomb-Team': API_KEY },
  serviceName: 'my-agent',
});

const storage = new CompositeStorage([
  new ConsoleStorage(),
  new QhawayOtelStorage(otel),
]);

const trace = new QhawayTrace(storage, { agent_id: 'finops-agent' });

const askLLM = trace.wrap(
  async (prompt: string) => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json() as any;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
    };
  },
  { provider: 'openrouter', session_id: crypto.randomUUID() },
);

const result = await askLLM('What is the capital of France?');
console.log('Response:', result.text);
