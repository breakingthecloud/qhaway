import { describe, it, expect, vi } from 'vitest';
import { QhawayTrace } from './index.js';
import { ConsoleStorage } from './console.js';

// Mock StyrRouter — simulates a real LLM call with usage data
function createMockRouter() {
  return {
    call: vi.fn().mockResolvedValue({
      text: 'Hello from the mock LLM!',
      modelUsed: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      latencyMs: 1234,
      usage: { promptTokens: 150, completionTokens: 42, totalTokens: 192 },
      fallbacksTried: 0,
    }),
    stream: vi.fn(),
  };
}

describe('qhaway e2e: trace wrapping a StyrRouter', () => {
  it('captures real span fields from a router.call()', async () => {
    const spans: unknown[] = [];
    const storage: ConsoleStorage = {
      async write(span) {
        spans.push(span);
        // Also log to console for visual verification
        const icon = span.success ? '✓' : '✗';
        console.log(`[e2e] ${icon} ${span.model} (${span.provider}) | ${span.latency_ms}ms | $${span.cost_usd} | user=${span.user_id}`);
      },
    };

    const trace = new QhawayTrace(storage, { agent_id: 'e2e-test-agent' });
    const router = createMockRouter();

    const wrappedCall = trace.wrap(
      (msg: string) => router.call([{ role: 'user', content: msg }]),
      { model: 'nvidia/nemotron-3-ultra-550b-a55b:free', provider: 'openrouter', user_id: 'e2e-user', session_id: 'e2e-session' },
    );

    const result = await wrappedCall('Hello!');

    // Verify the LLM response passes through correctly
    expect(result.text).toBe('Hello from the mock LLM!');
    expect(result.modelUsed).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');

    // Verify the captured span
    expect(spans).toHaveLength(1);
    const span = spans[0] as Record<string, unknown>;
    expect(span.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
    expect(span.provider).toBe('openrouter');
    expect(span.latency_ms).toBeGreaterThanOrEqual(0);
    expect(span.success).toBe(true);
    expect(span.user_id).toBe('e2e-user');
    expect(span.session_id).toBe('e2e-session');
    expect(span.agent_id).toBe('e2e-test-agent');
    expect(span.id).toBeDefined();
    expect(span.timestamp).toBeDefined();
  });

  it('captures error spans when router throws', async () => {
    const spans: unknown[] = [];
    const storage: ConsoleStorage = {
      async write(span) {
        spans.push(span);
        console.log(`[e2e] ✗ ${span.model} | ERROR: ${span.error}`);
      },
    };

    const trace = new QhawayTrace(storage);
    const router = createMockRouter();
    router.call.mockRejectedValue(new Error('Rate limit exceeded'));

    const wrappedCall = trace.wrap(
      (msg: string) => router.call([{ role: 'user', content: msg }]),
      { model: 'gpt-4o', provider: 'openai' },
    );

    await expect(wrappedCall('Hi')).rejects.toThrow('Rate limit exceeded');
    expect(spans).toHaveLength(1);
    const span = spans[0] as Record<string, unknown>;
    expect(span.success).toBe(false);
    expect(span.error).toBe('Rate limit exceeded');
    expect(span.model).toBe('gpt-4o');
  });

  it('wraps the entire router object for convenience', async () => {
    const spans: unknown[] = [];
    const storage: ConsoleStorage = {
      async write(span) { spans.push(span); },
    };

    const trace = new QhawayTrace(storage, { agent_id: 'my-agent' });
    const router = createMockRouter();

    // Simulate wrapRouter utility: wrap the call method
    const tracedRouter = {
      ...router,
      call: trace.wrap(
        (messages: unknown[]) => router.call(messages),
        { provider: 'openrouter' },
      ),
    };

    // First call
    await tracedRouter.call([{ role: 'user', content: 'First' }]);
    // Second call with different model
    await tracedRouter.call([{ role: 'user', content: 'Second' }]);

    expect(spans).toHaveLength(2);
    // Both should have the default provider
    expect((spans[0] as Record<string, unknown>).provider).toBe('openrouter');
    expect((spans[1] as Record<string, unknown>).provider).toBe('openrouter');
  });
});
