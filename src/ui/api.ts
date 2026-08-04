import type { QhawayStorage } from '../trace/index.js';
import type { TraceFilters } from './tree.js';

export interface QhawayUiApi {
  loadSpans(filters?: TraceFilters, limit?: number): Promise<unknown[]>;
}

export class StorageUiApi implements QhawayUiApi {
  constructor(private storage: QhawayStorage) {}

  async loadSpans(filters: TraceFilters = {}, limit = 500): Promise<unknown[]> {
    const partial: Record<string, unknown> = {};
    if (filters.model !== undefined) partial.model = filters.model;
    if (filters.agent !== undefined) partial.agent_id = filters.agent;
    if (filters.sessionId !== undefined) partial.session_id = filters.sessionId;
    if (filters.success !== undefined) partial.success = filters.success;

    const spans = await this.storage.query?.(partial, limit) ?? [];
    return spans.filter((s) => {
      if (filters.from && s.timestamp < filters.from) return false;
      if (filters.to && s.timestamp > filters.to) return false;
      if (filters.toolName && s.tool_name !== filters.toolName) return false;
      return true;
    });
  }
}

export class HttpUiApi implements QhawayUiApi {
  constructor(private endpoint: string) {}

  async loadSpans(_filters: TraceFilters = {}, _limit = 500): Promise<unknown[]> {
    const res = await fetch(this.endpoint);
    if (!res.ok) {
      throw new Error(`Qhaway UI: GET ${this.endpoint} failed with ${res.status}`);
    }
    return res.json() as Promise<unknown[]>;
  }
}

export function getUiApi(source: QhawayStorage | string): QhawayUiApi {
  if (typeof source === 'string') return new HttpUiApi(source);
  return new StorageUiApi(source);
}
