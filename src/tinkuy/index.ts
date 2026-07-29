import type { QhawaySpan, QhawayStorage } from '../trace/index.js';

export interface IterationEvent {
  iteration: number;
  modelUsed: string;
  latencyMs: number;
  hasToolCalls: boolean;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export interface ToolCallEvent {
  iteration: number;
  tool: string;
  arguments: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  error?: string;
}

export interface CompleteEvent {
  iterations: number;
  totalLatencyMs: number;
  modelsUsed: string[];
  toolsUsed: string[];
  result: {
    text: string;
    blocked: boolean;
    blockReason?: string;
    estimatedCostUsd?: number;
    iterations: number;
    toolsUsed: string[];
    modelsUsed: string[];
  };
}

export interface TinkuyPluginHooks {
  onIteration: (event: IterationEvent) => void;
  onToolCall: (event: ToolCallEvent) => void;
  onComplete: (event: CompleteEvent) => void;
}

export interface TinkuyPluginConfig {
  storage: QhawayStorage;
  agentName?: string;
  captureToolPayloads?: boolean;
}

export class QhawayTinkuyPlugin {
  public sessionId: string;

  constructor(private config: TinkuyPluginConfig) {
    this.sessionId = crypto.randomUUID();
  }

  get hooks(): TinkuyPluginHooks {
    return {
      onIteration: (event) => { this.onIteration(event); },
      onToolCall: (event) => { this.onToolCall(event); },
      onComplete: (event) => { this.onComplete(event); },
    };
  }

  private async onIteration(event: IterationEvent): Promise<void> {
    const span: QhawaySpan = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      model: event.modelUsed,
      provider: 'unknown',
      latency_ms: event.latencyMs,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      agent_id: this.config.agentName,
      session_id: this.sessionId,
      success: true,
    };
    await this.config.storage.write(span);
  }

  private async onToolCall(event: ToolCallEvent): Promise<void> {
    const span: QhawaySpan = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      model: '',
      provider: '',
      latency_ms: event.durationMs,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      tool_name: event.tool,
      agent_id: this.config.agentName,
      session_id: this.sessionId,
      success: !event.error,
      error: event.error,
      metadata: this.config.captureToolPayloads
        ? { toolArgs: event.arguments, toolResult: event.result }
        : undefined,
    };
    await this.config.storage.write(span);
  }

  private async onComplete(event: CompleteEvent): Promise<void> {
    const span: QhawaySpan = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      model: event.modelsUsed.join(',') || 'unknown',
      provider: 'tinkuy',
      latency_ms: event.totalLatencyMs,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: event.result.estimatedCostUsd ?? 0,
      agent_id: this.config.agentName,
      session_id: this.sessionId,
      tool_name: 'agent.run',
      success: !event.result.blocked,
      error: event.result.blockReason,
      metadata: {
        iterations: event.iterations,
        toolsUsed: event.toolsUsed,
        modelsUsed: event.modelsUsed,
        blocked: event.result.blocked,
      },
    };
    await this.config.storage.write(span);
  }
}
