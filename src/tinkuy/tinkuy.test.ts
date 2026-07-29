import { describe, it, expect, vi } from 'vitest';
import { QhawayTinkuyPlugin } from './index.js';
import type { QhawaySpan, QhawayStorage } from '../trace/index.js';
import type { IterationEvent, ToolCallEvent, CompleteEvent } from './index.js';

function makeStorage(): QhawayStorage & { spans: QhawaySpan[] } {
  const spans: QhawaySpan[] = [];
  return {
    spans,
    async write(span: QhawaySpan) { spans.push(span); },
  };
}

describe('QhawayTinkuyPlugin', () => {
  it('generates a session ID on construction', () => {
    const plugin = new QhawayTinkuyPlugin({ storage: makeStorage(), agentName: 'test-agent' });
    expect(plugin.sessionId).toBeDefined();
    expect(plugin.sessionId.length).toBeGreaterThan(0);
  });

  it('each instance has unique session ID', () => {
    const a = new QhawayTinkuyPlugin({ storage: makeStorage() });
    const b = new QhawayTinkuyPlugin({ storage: makeStorage() });
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('hooks has all three callbacks', () => {
    const plugin = new QhawayTinkuyPlugin({ storage: makeStorage() });
    expect(plugin.hooks.onIteration).toBeDefined();
    expect(plugin.hooks.onToolCall).toBeDefined();
    expect(plugin.hooks.onComplete).toBeDefined();
  });
});

describe('onIteration', () => {
  it('writes a span for each iteration', async () => {
    const storage = makeStorage();
    const plugin = new QhawayTinkuyPlugin({ storage, agentName: 'agent-x' });

    const event: IterationEvent = {
      iteration: 1,
      modelUsed: 'gpt-4o',
      latencyMs: 1200,
      hasToolCalls: false,
    };

    plugin.hooks.onIteration(event);
    await vi.waitFor(() => expect(storage.spans).toHaveLength(1));

    const span = storage.spans[0];
    expect(span.model).toBe('gpt-4o');
    expect(span.latency_ms).toBe(1200);
    expect(span.agent_id).toBe('agent-x');
    expect(span.session_id).toBe(plugin.sessionId);
    expect(span.success).toBe(true);
  });

  it('writes separate spans for multiple iterations', async () => {
    const storage = makeStorage();
    const plugin = new QhawayTinkuyPlugin({ storage });

    plugin.hooks.onIteration({ iteration: 1, modelUsed: 'gpt-4o', latencyMs: 500, hasToolCalls: true });
    plugin.hooks.onIteration({ iteration: 2, modelUsed: 'claude-sonnet-4', latencyMs: 800, hasToolCalls: false });

    await vi.waitFor(() => expect(storage.spans).toHaveLength(2));

    expect(storage.spans[0].model).toBe('gpt-4o');
    expect(storage.spans[1].model).toBe('claude-sonnet-4');
    expect(storage.spans[0].session_id).toBe(plugin.sessionId);
    expect(storage.spans[1].session_id).toBe(plugin.sessionId);
  });
});

describe('onToolCall', () => {
  it('writes a span for tool execution', async () => {
    const storage = makeStorage();
    const plugin = new QhawayTinkuyPlugin({ storage, agentName: 'agent-x' });

    const event: ToolCallEvent = {
      iteration: 1,
      tool: 'search_knowledge',
      arguments: { query: 'hello' },
      result: { found: true },
      durationMs: 450,
    };

    plugin.hooks.onToolCall(event);
    await vi.waitFor(() => expect(storage.spans).toHaveLength(1));

    const span = storage.spans[0];
    expect(span.tool_name).toBe('search_knowledge');
    expect(span.latency_ms).toBe(450);
    expect(span.success).toBe(true);
    expect(span.agent_id).toBe('agent-x');
  });

  it('marks span as failed on error', async () => {
    const storage = makeStorage();
    const plugin = new QhawayTinkuyPlugin({ storage });

    plugin.hooks.onToolCall({
      iteration: 1,
      tool: 'broken_tool',
      arguments: {},
      result: null,
      durationMs: 100,
      error: 'Timeout',
    });

    await vi.waitFor(() => expect(storage.spans).toHaveLength(1));
    expect(storage.spans[0].success).toBe(false);
    expect(storage.spans[0].error).toBe('Timeout');
  });

  it('captures tool payloads when configured', async () => {
    const storage = makeStorage();
    const plugin = new QhawayTinkuyPlugin({ storage, captureToolPayloads: true });

    plugin.hooks.onToolCall({
      iteration: 1,
      tool: 'calc',
      arguments: { x: 1, y: 2 },
      result: 3,
      durationMs: 5,
    });

    await vi.waitFor(() => expect(storage.spans).toHaveLength(1));
    expect(storage.spans[0].metadata).toBeDefined();
    expect((storage.spans[0].metadata as any)?.toolArgs).toEqual({ x: 1, y: 2 });
  });
});

describe('onComplete', () => {
  it('writes aggregated summary span', async () => {
    const storage = makeStorage();
    const plugin = new QhawayTinkuyPlugin({ storage, agentName: 'agent-x' });

    const event: CompleteEvent = {
      iterations: 3,
      totalLatencyMs: 5000,
      modelsUsed: ['gpt-4o', 'claude-sonnet-4'],
      toolsUsed: ['search', 'calc'],
      result: {
        text: 'Final answer',
        blocked: false,
        iterations: 3,
        toolsUsed: ['search', 'calc'],
        modelsUsed: ['gpt-4o', 'claude-sonnet-4'],
        estimatedCostUsd: 0.042,
      },
    };

    plugin.hooks.onComplete(event);
    await vi.waitFor(() => expect(storage.spans).toHaveLength(1));

    const span = storage.spans[0];
    expect(span.tool_name).toBe('agent.run');
    expect(span.latency_ms).toBe(5000);
    expect(span.cost_usd).toBe(0.042);
    expect(span.model).toBe('gpt-4o,claude-sonnet-4');
    expect(span.success).toBe(true);
    expect(span.agent_id).toBe('agent-x');
    expect((span.metadata as any)?.iterations).toBe(3);
  });

  it('marks blocked runs as failed', async () => {
    const storage = makeStorage();
    const plugin = new QhawayTinkuyPlugin({ storage });

    plugin.hooks.onComplete({
      iterations: 1,
      totalLatencyMs: 200,
      modelsUsed: ['gpt-4o'],
      toolsUsed: [],
      result: {
        text: '',
        blocked: true,
        blockReason: 'Budget exceeded',
        iterations: 1,
        toolsUsed: [],
        modelsUsed: ['gpt-4o'],
      },
    });

    await vi.waitFor(() => expect(storage.spans).toHaveLength(1));
    expect(storage.spans[0].success).toBe(false);
    expect(storage.spans[0].error).toBe('Budget exceeded');
  });
});
