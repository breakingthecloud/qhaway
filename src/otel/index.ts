/**
 * Qhaway OTEL Exporter — Export spans via OTLP/HTTP JSON
 *
 * Zero dependencies. Works in CF Workers, Node.js, Deno, Bun.
 * Follows OpenTelemetry GenAI semantic conventions.
 *
 * @example
 * import { QhawayOtelExporter } from '@carloscortezcloud/qhaway/otel';
 *
 * const otel = new QhawayOtelExporter({
 *   endpoint: 'http://localhost:4318/v1/traces',
 *   serviceName: 'my-agent',
 * });
 * await otel.export([span1, span2]);
 */

import type { QhawaySpan } from '../trace/index.js';

export interface OtelConfig {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
}

export class QhawayOtelExporter {
  constructor(private config: OtelConfig) {}

  async export(spans: QhawaySpan[]): Promise<Response> {
    const body = this.buildPayload(spans);
    return fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.headers },
      body: JSON.stringify(body),
    });
  }

  private buildPayload(spans: QhawaySpan[]): unknown {
    return {
      resourceSpans: [{
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: this.config.serviceName || 'qhaway' } }],
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
            attributes: [
              { key: 'gen_ai.request.model', value: { stringValue: s.model } },
              { key: 'gen_ai.request.provider', value: { stringValue: s.provider } },
              { key: 'gen_ai.usage.input_tokens', value: { intValue: s.tokens_in.toString() } },
              { key: 'gen_ai.usage.output_tokens', value: { intValue: s.tokens_out.toString() } },
              { key: 'gen_ai.response.cost_usd', value: { doubleValue: s.cost_usd } },
              ...(s.user_id ? [{ key: 'qhaway.user_id', value: { stringValue: s.user_id } }] : []),
              ...(s.agent_id ? [{ key: 'qhaway.agent_id', value: { stringValue: s.agent_id } }] : []),
              ...(s.session_id ? [{ key: 'qhaway.session_id', value: { stringValue: s.session_id } }] : []),
              ...(s.tool_name ? [{ key: 'qhaway.tool_name', value: { stringValue: s.tool_name } }] : []),
            ],
            status: { code: s.success ? 1 : 2, message: s.error || '' },
          })),
        }],
      }],
    };
  }
}

function generateId(len: number): string {
  const arr = new Uint8Array(len / 2);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}
