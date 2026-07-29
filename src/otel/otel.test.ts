import { describe, it, expect, vi } from 'vitest';
import { QhawayOtelExporter, buildTracePayload, buildMetricsPayload } from './exporter.js';
import { CompositeStorage } from './composite.js';
import type { QhawaySpan, QhawayStorage } from '../trace/index.js';

function makeSpan(overrides: Partial<QhawaySpan> = {}): QhawaySpan {
  return {
    id: 'test-id',
    timestamp: '2026-07-29T12:00:00.000Z',
    model: 'gpt-4o',
    provider: 'openai',
    latency_ms: 500,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.0125,
    success: true,
    ...overrides,
  };
}

describe('QhawayOtelExporter', () => {
  it('buildTracePayload creates valid OTLP structure', () => {
    const span = makeSpan();
    const payload = buildTracePayload([span], 'test-service') as any;

    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].resource.attributes[0].value.stringValue).toBe('test-service');
    expect(payload.resourceSpans[0].scopeSpans[0].scope.name).toBe('@carloscortezcloud/qhaway');
    expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });

  it('trace payload includes GenAI semconv attributes', () => {
    const span = makeSpan({ user_id: 'alice', agent_id: 'agent-a', session_id: 'ses-1', tool_name: 'search' });
    const payload = buildTracePayload([span], 'qhaway') as any;
    const attrs = payload.resourceSpans[0].scopeSpans[0].spans[0].attributes;

    expect(attrs).toContainEqual({ key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } });
    expect(attrs).toContainEqual({ key: 'gen_ai.request.provider', value: { stringValue: 'openai' } });
    expect(attrs).toContainEqual({ key: 'gen_ai.usage.input_tokens', value: { intValue: '100' } });
    expect(attrs).toContainEqual({ key: 'gen_ai.usage.output_tokens', value: { intValue: '50' } });
    expect(attrs).toContainEqual({ key: 'gen_ai.response.cost_usd', value: { doubleValue: 0.0125 } });
    expect(attrs).toContainEqual({ key: 'qhaway.user_id', value: { stringValue: 'alice' } });
    expect(attrs).toContainEqual({ key: 'qhaway.agent_id', value: { stringValue: 'agent-a' } });
    expect(attrs).toContainEqual({ key: 'qhaway.session_id', value: { stringValue: 'ses-1' } });
    expect(attrs).toContainEqual({ key: 'qhaway.tool_name', value: { stringValue: 'search' } });
  });

  it('trace payload sets status code based on success', () => {
    const ok = buildTracePayload([makeSpan({ success: true })], 's') as any;
    expect(ok.resourceSpans[0].scopeSpans[0].spans[0].status.code).toBe(1);

    const err = buildTracePayload([makeSpan({ success: false, error: 'boom' })], 's') as any;
    expect(err.resourceSpans[0].scopeSpans[0].spans[0].status.code).toBe(2);
    expect(err.resourceSpans[0].scopeSpans[0].spans[0].status.message).toBe('boom');
  });

  it('trace payload uses tool_name as span name', () => {
    const withTool = buildTracePayload([makeSpan({ tool_name: 'search_db' })], 's') as any;
    expect(withTool.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('tool.search_db');

    const without = buildTracePayload([makeSpan({ tool_name: undefined })], 's') as any;
    expect(without.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('llm.call');
  });

  it('trace payload computes timestamps correctly', () => {
    const span = makeSpan({ timestamp: '2026-07-29T12:00:00.000Z', latency_ms: 1000 });
    const payload = buildTracePayload([span], 's') as any;
    const s = payload.resourceSpans[0].scopeSpans[0].spans[0];
    // July 29 2026 12:00:00 UTC = let me calculate
    // 2026-07-29T12:00:00Z = this is a known timestamp
    const expectedStart = new Date('2026-07-29T12:00:00.000Z').getTime() * 1_000_000;
    const expectedEnd = (new Date('2026-07-29T12:00:00.000Z').getTime() + 1000) * 1_000_000;
    expect(s.startTimeUnixNano).toBe(expectedStart.toString());
    expect(s.endTimeUnixNano).toBe(expectedEnd.toString());
  });

  it('buildMetricsPayload creates OTLP metrics structure', () => {
    const spans = [
      makeSpan({ model: 'gpt-4o', cost_usd: 0.5, tokens_in: 100, tokens_out: 50 }),
      makeSpan({ model: 'gpt-4o', cost_usd: 0.3, tokens_in: 200, tokens_out: 100 }),
      makeSpan({ model: 'claude-sonnet-4', cost_usd: 0.2, tokens_in: 150, tokens_out: 75 }),
    ];
    const payload = buildMetricsPayload(spans, 'test') as any;

    expect(payload.resourceMetrics).toHaveLength(1);
    const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
    expect(metrics).toHaveLength(4);

    const costMetric = metrics.find((m: any) => m.name === 'qhaway.cost.total');
    expect(costMetric).toBeDefined();
    expect(costMetric.unit).toBe('USD');
    expect(costMetric.sum.aggregationTemporality).toBe(2);

    const gpt4oCost = costMetric.sum.dataPoints.find((dp: any) =>
      dp.attributes[0].value.stringValue === 'gpt-4o');
    expect(gpt4oCost.asDouble).toBe(0.8);
  });

  it('buildMetricsPayload handles empty spans', () => {
    const payload = buildMetricsPayload([], 'test') as any;
    const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
    for (const m of metrics) {
      expect(m.sum.dataPoints).toHaveLength(0);
    }
  });
});

describe('CompositeStorage', () => {
  it('writes to all storages in parallel', async () => {
    const s1: QhawayStorage = { write: vi.fn().mockResolvedValue(undefined) };
    const s2: QhawayStorage = { write: vi.fn().mockResolvedValue(undefined) };
    const composite = new CompositeStorage([s1, s2]);

    const span = makeSpan();
    await composite.write(span);

    expect(s1.write).toHaveBeenCalledWith(span);
    expect(s2.write).toHaveBeenCalledWith(span);
  });

  it('does not throw when one storage fails', async () => {
    const s1: QhawayStorage = { write: vi.fn().mockRejectedValue(new Error('fail')) };
    const s2: QhawayStorage = { write: vi.fn().mockResolvedValue(undefined) };
    const composite = new CompositeStorage([s1, s2]);

    const span = makeSpan();
    await expect(composite.write(span)).resolves.toBeUndefined();
    expect(s2.write).toHaveBeenCalled();
  });

  it('supports adding storage after construction', () => {
    const composite = new CompositeStorage([]);
    const s: QhawayStorage = { write: vi.fn() };
    composite.add(s);
    composite.write(makeSpan());
    expect(s.write).toHaveBeenCalled();
  });
});
