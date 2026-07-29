import type { QhawaySpan, QhawayStorage } from '../trace.js';

export class ConsoleStorage implements QhawayStorage {
  async write(span: QhawaySpan): Promise<void> {
    const icon = span.success ? '✓' : '✗';
    const cost = span.cost_usd > 0 ? ` $${span.cost_usd.toFixed(6)}` : '';
    const tokens = span.tokens_in + span.tokens_out > 0
      ? ` | ${span.tokens_in}→${span.tokens_out} tok`
      : '';
    const tags = [
      span.user_id && `user=${span.user_id}`,
      span.agent_id && `agent=${span.agent_id}`,
      span.tool_name && `tool=${span.tool_name}`,
      span.session_id && `session=${span.session_id}`,
    ].filter(Boolean).join(' ');

    console.log(
      `[Qhaway] ${icon} ${span.model} (${span.provider})`
      + `${cost}${tokens}`
      + ` | ${span.latency_ms}ms`
      + (tags ? ` | ${tags}` : '')
      + (span.error ? ` | ERROR: ${span.error}` : ''),
    );
  }
}
