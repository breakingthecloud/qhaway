export interface QhawaySpan {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  user_id?: string;
  session_id?: string;
  agent_id?: string;
  tool_name?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface QhawayStorage {
  write(span: QhawaySpan): Promise<void>;
  query?(filters?: Partial<QhawaySpan>, limit?: number): Promise<QhawaySpan[]>;
  aggregate?(field: string, groupBy: string, period?: string): Promise<Record<string, number>>;
  close?(): Promise<void>;
}

export class QhawayTrace {
  constructor(
    private storage: QhawayStorage,
    private defaultMeta?: Partial<QhawaySpan>,
  ) {}

  wrap<T>(fn: (...args: unknown[]) => Promise<T>, meta?: Partial<QhawaySpan>): (...args: unknown[]) => Promise<T> {
    return async (...args: unknown[]) => {
      const span: Partial<QhawaySpan> = {
        ...this.defaultMeta,
        ...meta,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };
      const start = Date.now();
      try {
        const result = await fn(...args);
        await this.record({ ...span, latency_ms: Date.now() - start, success: true });
        return result;
      } catch (e) {
        await this.record({
          ...span,
          latency_ms: Date.now() - start,
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    };
  }

  private async record(span: Partial<QhawaySpan>): Promise<void> {
    const full: QhawaySpan = {
      id: span.id!,
      timestamp: span.timestamp!,
      model: span.model || 'unknown',
      provider: span.provider || 'unknown',
      latency_ms: span.latency_ms || 0,
      tokens_in: span.tokens_in || 0,
      tokens_out: span.tokens_out || 0,
      cost_usd: span.cost_usd || 0,
      user_id: span.user_id,
      session_id: span.session_id,
      agent_id: span.agent_id,
      tool_name: span.tool_name,
      success: span.success ?? true,
      error: span.error,
      metadata: span.metadata,
    };
    await this.storage.write(full);
  }

  async close(): Promise<void> {
    if (this.storage.close) {
      await this.storage.close();
    }
  }
}
