import { describe, it, expect } from 'vitest';
import { buildTraceTree, filterSpans, costColor, COST_RED_THRESHOLD, COST_YELLOW_THRESHOLD } from './tree.js';
import type { TraceNode } from './tree.js';
import { StorageUiApi, HttpUiApi, getUiApi } from './api.js';
import type { QhawaySpan, QhawayStorage } from '../trace/index.js';

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

describe('costColor', () => {
  it('returns red above red threshold, yellow above yellow threshold, green otherwise', () => {
    expect(costColor(COST_RED_THRESHOLD + 0.001)).toBe('#ef4444');
    expect(costColor(COST_YELLOW_THRESHOLD + 0.001)).toBe('#eab308');
    expect(costColor(0.0001)).toBe('#10b981');
  });
});

describe('filterSpans', () => {
  const spans = [
    makeSpan({ model: 'gpt-4o', agent_id: 'agent-a', success: true, session_id: 's1', timestamp: '2026-08-01T10:00:00Z' }),
    makeSpan({ model: 'gpt-4o-mini', agent_id: 'agent-a', success: false, session_id: 's1', timestamp: '2026-08-02T10:00:00Z' }),
    makeSpan({ model: 'claude-3-5', agent_id: 'agent-b', success: true, session_id: 's2', timestamp: '2026-08-03T10:00:00Z' }),
  ];

  it('filters by model', () => {
    const result = filterSpans(spans, { model: 'gpt-4o' });
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe('gpt-4o');
  });

  it('filters by agent', () => {
    const result = filterSpans(spans, { agent: 'agent-b' });
    expect(result).toHaveLength(1);
  });

  it('filters by success', () => {
    const result = filterSpans(spans, { success: false });
    expect(result).toHaveLength(1);
  });

  it('filters by date range', () => {
    const result = filterSpans(spans, { from: '2026-08-02T00:00:00Z', to: '2026-08-02T23:59:59Z' });
    expect(result).toHaveLength(1);
  });

  it('filters by session', () => {
    const result = filterSpans(spans, { sessionId: 's2' });
    expect(result).toHaveLength(1);
  });

  it('returns all when filters empty', () => {
    expect(filterSpans(spans, {})).toHaveLength(3);
  });
});

describe('buildTraceTree', () => {
  it('groups spans by session into root nodes', () => {
    const spans = [
      makeSpan({ id: 'a', session_id: 's1', model: 'gpt-4o', latency_ms: 100, cost_usd: 0.01 }),
      makeSpan({ id: 'b', session_id: 's1', model: 'gpt-4o-mini', latency_ms: 200, cost_usd: 0.02 }),
      makeSpan({ id: 'c', session_id: 's2', model: 'claude-3-5', latency_ms: 300, cost_usd: 0.03 }),
    ];
    const roots = buildTraceTree(spans);
    expect(roots).toHaveLength(2);

    const s1 = roots.find((r) => r.id === 'session-s1');
    expect(s1).toBeDefined();
    expect(s1!.children).toHaveLength(2);
    expect(s1!.costUsd).toBeCloseTo(0.03);
    expect(s1!.latencyMs).toBe(300);
  });

  it('puts standalone spans (no session) as roots', () => {
    const roots = buildTraceTree([makeSpan({ id: 'x', session_id: undefined })]);
    expect(roots).toHaveLength(1);
    expect(roots[0].type).toBe('iteration');
  });

  it('classifies tool calls and agent.run correctly', () => {
    const spans = [
      makeSpan({ id: 'tool', session_id: 's1', tool_name: 'web_search' }),
      makeSpan({ id: 'agent', session_id: 's1', tool_name: 'agent.run' }),
      makeSpan({ id: 'llm', session_id: 's1', tool_name: undefined }),
    ];
    const roots = buildTraceTree(spans);
    const children = roots[0].children;
    const byId = new Map<string, TraceNode>(children.map((c) => [c.id, c]));
    expect(byId.get('tool')!.type).toBe('tool');
    expect(byId.get('agent')!.type).toBe('agent');
    expect(byId.get('llm')!.type).toBe('iteration');
  });

  it('sorts roots by latency descending', () => {
    const roots = buildTraceTree([
      makeSpan({ id: 'slow', session_id: 's1', latency_ms: 500 }),
      makeSpan({ id: 'fast', session_id: 's2', latency_ms: 50 }),
    ]);
    expect(roots[0].latencyMs).toBe(500);
    expect(roots[1].latencyMs).toBe(50);
  });
});

describe('StorageUiApi', () => {
  class FakeStorage implements QhawayStorage {
    spans: QhawaySpan[] = [];
    constructor(spans: QhawaySpan[]) { this.spans = spans; }
    async write(span: QhawaySpan): Promise<void> { this.spans.push(span); }
    async query(filters?: Partial<QhawaySpan>): Promise<QhawaySpan[]> {
      return this.spans.filter((s) => {
        for (const [k, v] of Object.entries(filters || {})) {
          if (v !== undefined && (s as unknown as Record<string, unknown>)[k] !== v) return false;
        }
        return true;
      });
    }
  }

  it('loads spans from storage with filters', async () => {
    const storage = new FakeStorage([
      makeSpan({ model: 'gpt-4o', agent_id: 'agent-a', timestamp: '2026-08-03T10:00:00Z' }),
      makeSpan({ model: 'claude-3-5', agent_id: 'agent-b', timestamp: '2026-08-03T11:00:00Z' }),
    ]);
    const api = new StorageUiApi(storage);
    const result = await api.loadSpans({ agent: 'agent-a' });
    expect(result).toHaveLength(1);
  });

  it('getUiApi returns StorageUiApi for storage and HttpUiApi for string', () => {
    const storage = new FakeStorage([]);
    expect(getUiApi(storage)).toBeInstanceOf(StorageUiApi);
    expect(getUiApi('http://localhost:9090/spans')).toBeInstanceOf(HttpUiApi);
  });

  it('HttpUiApi throws on non-ok response', async () => {
    const api = new HttpUiApi('http://localhost:9999/spans');
    await expect(api.loadSpans()).rejects.toThrow();
  });
});
