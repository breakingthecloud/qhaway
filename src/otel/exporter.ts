import type { QhawaySpan, QhawayStorage } from '../trace/index.js';

export interface OtelConfig {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
}

export class QhawayOtelExporter {
  constructor(private config: OtelConfig) {}

  async export(spans: QhawaySpan[]): Promise<Response> {
    const body = buildTracePayload(spans, this.config.serviceName || 'qhaway');
    return fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.headers },
      body: JSON.stringify(body),
    });
  }

  async exportMetrics(spans: QhawaySpan[]): Promise<Response> {
    const body = buildMetricsPayload(spans, this.config.serviceName || 'qhaway');
    const metricsEndpoint = this.config.endpoint.replace('/traces', '/metrics');
    return fetch(metricsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.headers },
      body: JSON.stringify(body),
    });
  }
}

export function buildTracePayload(spans: QhawaySpan[], serviceName: string): unknown {
  return {
    resourceSpans: [{
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
      },
      scopeSpans: [{
        scope: { name: '@carloscortezcloud/qhaway' },
        spans: spans.map(s => ({
          traceId: generateId(32),
          spanId: generateId(16),
          name: s.tool_name ? `tool.${s.tool_name}` : 'llm.call',
          kind: 3,
          startTimeUnixNano: (new Date(s.timestamp).getTime() * 1_000_000).toString(),
          endTimeUnixNano: ((new Date(s.timestamp).getTime() + s.latency_ms) * 1_000_000).toString(),
          attributes: spanToAttributes(s),
          status: { code: s.success ? 1 : 2, message: s.error || '' },
        })),
      }],
    }],
  };
}

export function buildMetricsPayload(spans: QhawaySpan[], serviceName: string): unknown {
  const costByModel: Record<string, number> = {};
  const tokensInByModel: Record<string, number> = {};
  const tokensOutByModel: Record<string, number> = {};
  const callsByModel: Record<string, number> = {};

  for (const s of spans) {
    costByModel[s.model] = (costByModel[s.model] || 0) + s.cost_usd;
    tokensInByModel[s.model] = (tokensInByModel[s.model] || 0) + s.tokens_in;
    tokensOutByModel[s.model] = (tokensOutByModel[s.model] || 0) + s.tokens_out;
    callsByModel[s.model] = (callsByModel[s.model] || 0) + 1;
  }

  const toDataPoints = (map: Record<string, number>) =>
    Object.entries(map).map(([model, value]) => ({
      attributes: [{ key: 'gen_ai.request.model', value: { stringValue: model } }],
      asDouble: value,
    }));

  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
      scopeMetrics: [{
        scope: { name: '@carloscortezcloud/qhaway' },
        metrics: [
          { name: 'qhaway.cost.total', unit: 'USD', sum: { dataPoints: toDataPoints(costByModel), aggregationTemporality: 2 } },
          { name: 'qhaway.tokens.input', unit: '1', sum: { dataPoints: toDataPoints(tokensInByModel), aggregationTemporality: 2 } },
          { name: 'qhaway.tokens.output', unit: '1', sum: { dataPoints: toDataPoints(tokensOutByModel), aggregationTemporality: 2 } },
          { name: 'qhaway.calls.total', unit: '1', sum: { dataPoints: toDataPoints(callsByModel), aggregationTemporality: 2 } },
        ],
      }],
    }],
  };
}

function spanToAttributes(s: QhawaySpan): Array<{ key: string; value: Record<string, string | number> }> {
  const attrs: Array<{ key: string; value: Record<string, string | number> }> = [
    { key: 'gen_ai.request.model', value: { stringValue: s.model } },
    { key: 'gen_ai.request.provider', value: { stringValue: s.provider } },
    { key: 'gen_ai.usage.input_tokens', value: { intValue: s.tokens_in.toString() } },
    { key: 'gen_ai.usage.output_tokens', value: { intValue: s.tokens_out.toString() } },
    { key: 'gen_ai.response.cost_usd', value: { doubleValue: s.cost_usd } },
    ...(s.user_id ? [{ key: 'qhaway.user_id', value: { stringValue: s.user_id } }] : []),
    ...(s.agent_id ? [{ key: 'qhaway.agent_id', value: { stringValue: s.agent_id } }] : []),
    ...(s.session_id ? [{ key: 'qhaway.session_id', value: { stringValue: s.session_id } }] : []),
    ...(s.tool_name ? [{ key: 'qhaway.tool_name', value: { stringValue: s.tool_name } }] : []),
  ];
  return attrs;
}

export class QhawayOtelStorage implements QhawayStorage {
  constructor(private exporter: QhawayOtelExporter) {}

  async write(span: QhawaySpan): Promise<void> {
    await this.exporter.export([span]);
  }
}

function generateId(len: number): string {
  const arr = new Uint8Array(len / 2);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}
