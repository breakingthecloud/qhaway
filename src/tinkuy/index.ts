/**
 * Qhaway Tinkuy Plugin — Auto-instrument TinkuyAgent
 *
 * Hooks into onIteration, onToolCall, onComplete to capture spans.
 *
 * @example
 * import { Agent } from '@carloscortezcloud/tinkuy-agent';
 * import { QhawayTinkuyPlugin } from '@carloscortezcloud/qhaway/tinkuy';
 *
 * const agent = new Agent({
 *   router: styrRouter,
 *   tools: [myTool],
 *   systemPrompt: 'Helpful assistant.',
 *   plugins: [new QhawayTinkuyPlugin({ trace: myQhawayTrace })],
 * });
 */

import type { QhawayTrace, QhawaySpan } from '../trace/index.js';

export interface TinkuyPluginConfig {
  trace: QhawayTrace;
  agentName?: string;
}

export class QhawayTinkuyPlugin {
  constructor(private config: TinkuyPluginConfig) {}

  onIteration(event: { iteration: number; modelUsed: string; latencyMs: number }): void {
    // Will be implemented in Sprint 1
    console.log(`[qhaway/tinkuy] Iteration ${event.iteration}: ${event.modelUsed} (${event.latencyMs}ms)`);
  }

  onToolCall(event: { tool: string; durationMs: number; error?: string }): void {
    // Will be implemented in Sprint 1
    console.log(`[qhaway/tinkuy] Tool call: ${event.tool} (${event.durationMs}ms)`);
  }

  onComplete(event: { iterations: number; totalLatencyMs: number; modelsUsed: string[] }): void {
    // Will be implemented in Sprint 1
    console.log(`[qhaway/tinkuy] Complete: ${event.iterations} iters, ${event.totalLatencyMs}ms total`);
  }
}
