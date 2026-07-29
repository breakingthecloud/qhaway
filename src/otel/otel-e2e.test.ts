import { describe, it, expect, vi } from 'vitest';
import { QhawayTrace } from '../trace/index.js';
import { ConsoleStorage } from '../trace/console.js';
import { QhawayOtelExporter, QhawayOtelStorage, CompositeStorage } from './index.js';
import type { QhawaySpan } from '../trace/index.js';

describe('otel e2e: integration with QhawayTrace', () => {
  it('exports spans through CompositeStorage', async () => {
    const capturedSpans: QhawaySpan[] = [];

    const consoleStore = new ConsoleStorage();
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const exporter = new QhawayOtelExporter({
      endpoint: 'http://localhost:4318/v1/traces',
    });

    const otelStore = new QhawayOtelStorage(exporter);

    const composite = new CompositeStorage([
      {
        async write(span) { capturedSpans.push(span); },
      },
      otelStore,
    ]);

    const trace = new QhawayTrace(composite, { agent_id: 'otel-e2e' });
    const fn = async () => 'e2e ok';
    const wrapped = trace.wrap(fn, { model: 'gpt-4o', provider: 'openai', user_id: 'test-user' });

    await wrapped();

    expect(capturedSpans).toHaveLength(1);
    expect(capturedSpans[0].model).toBe('gpt-4o');
    expect(capturedSpans[0].agent_id).toBe('otel-e2e');
    expect(capturedSpans[0].user_id).toBe('test-user');
  });

  it('composite storage tolerates individual failures', async () => {
    const good: QhawaySpan[] = [];
    const badStore = { write: vi.fn().mockRejectedValue(new Error('network error')) };
    const goodStore = { write: vi.fn().mockImplementation(async (s: QhawaySpan) => { good.push(s); }) };

    const composite = new CompositeStorage([badStore, goodStore]);
    const trace = new QhawayTrace(composite);

    const wrapped = trace.wrap(async () => 'data', { model: 'gpt-4o' });
    await wrapped();

    expect(good).toHaveLength(1);
    expect(good[0].model).toBe('gpt-4o');
  });
});
