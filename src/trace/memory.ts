import type { QhawaySpan, QhawayStorage } from './index.js';

export interface MemoryStorageConfig {
  maxSpans?: number;
}

export class MemoryStorage implements QhawayStorage {
  private spans: QhawaySpan[] = [];
  private maxSpans: number;

  constructor(config: MemoryStorageConfig = {}) {
    this.maxSpans = config.maxSpans ?? Infinity;
  }

  async write(span: QhawaySpan): Promise<void> {
    this.spans.push(span);
    if (this.spans.length > this.maxSpans) {
      this.spans.splice(0, this.spans.length - this.maxSpans);
    }
  }

  async query(filters?: Partial<QhawaySpan>, limit?: number): Promise<QhawaySpan[]> {
    let result = this.spans;
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) {
          result = result.filter(s => s[key as keyof QhawaySpan] === value);
        }
      }
    }
    if (limit && limit > 0) {
      result = result.slice(-limit);
    }
    return result;
  }

  async clear(): Promise<void> {
    this.spans = [];
  }

  get count(): number {
    return this.spans.length;
  }
}
