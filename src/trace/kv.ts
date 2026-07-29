import type { QhawaySpan, QhawayStorage } from './index.js';

export interface KVNamespace {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  get(key: string): Promise<string | null>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
  delete(key: string): Promise<void>;
}

export class KVStorage implements QhawayStorage {
  private prefix: string;

  constructor(
    private kv: KVNamespace,
    prefix = 'qhaway:',
  ) {
    this.prefix = prefix;
  }

  async write(span: QhawaySpan): Promise<void> {
    const key = `${this.prefix}${span.timestamp}:${span.id}`;
    await this.kv.put(key, JSON.stringify(span));
  }

  async query(filters: Partial<QhawaySpan>, limit = 100): Promise<QhawaySpan[]> {
    const { keys } = await this.kv.list({ prefix: this.prefix, limit });
    const spans: QhawaySpan[] = [];

    for (const { name } of keys) {
      const raw = await this.kv.get(name);
      if (!raw) continue;
      const span: QhawaySpan = JSON.parse(raw);
      if (matches(span, filters)) {
        spans.push(span);
      }
    }

    return spans.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }
}

function matches(span: QhawaySpan, filters: Partial<QhawaySpan>): boolean {
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && (span as unknown as Record<string, unknown>)[key] !== value) {
      return false;
    }
  }
  return true;
}
