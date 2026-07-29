import type { QhawaySpan, QhawayStorage } from './index.js';

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<{ success: boolean }>;
  batch(statements: D1PreparedStatement[]): Promise<{ results?: unknown[] }[]>;
}

interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  run(): Promise<{ meta: { last_row_id?: number; changes?: number } }>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS qhaway_spans (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  user_id TEXT,
  session_id TEXT,
  agent_id TEXT,
  tool_name TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_spans_timestamp ON qhaway_spans(timestamp);
CREATE INDEX IF NOT EXISTS idx_spans_user ON qhaway_spans(user_id);
CREATE INDEX IF NOT EXISTS idx_spans_session ON qhaway_spans(session_id);
CREATE INDEX IF NOT EXISTS idx_spans_model ON qhaway_spans(model);
`;

export class D1Storage implements QhawayStorage {
  constructor(private db: D1Database) {}

  async write(span: QhawaySpan): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO qhaway_spans (id, timestamp, model, provider, latency_ms, tokens_in, tokens_out,
        cost_usd, user_id, session_id, agent_id, tool_name, success, error, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      span.id, span.timestamp, span.model, span.provider, span.latency_ms,
      span.tokens_in, span.tokens_out, span.cost_usd,
      span.user_id ?? null, span.session_id ?? null,
      span.agent_id ?? null, span.tool_name ?? null,
      span.success ? 1 : 0, span.error ?? null,
      span.metadata ? JSON.stringify(span.metadata) : null,
    );
    await stmt.run();
  }

  async query(filters: Partial<QhawaySpan>, limit = 100): Promise<QhawaySpan[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) {
        conditions.push(`${key} = ?`);
        params.push(value);
      }
    }

    const sql = conditions.length > 0
      ? `SELECT * FROM qhaway_spans WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC LIMIT ?`
      : 'SELECT * FROM qhaway_spans ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const { results } = await this.db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    return results.map(rowToSpan);
  }

  async aggregate(field: string, groupBy: string, period?: string): Promise<Record<string, number>> {
    const timeFilter = period ? `WHERE timestamp >= datetime('now', '-${period}')` : '';
    const sql = `SELECT ${groupBy} AS key, SUM(${field}) AS total
      FROM qhaway_spans ${timeFilter}
      GROUP BY ${groupBy} ORDER BY total DESC`;

    const { results } = await this.db.prepare(sql).all<{ key: string; total: number }>();
    const map: Record<string, number> = {};
    for (const r of results) {
      map[r.key] = r.total;
    }
    return map;
  }
}

function rowToSpan(row: Record<string, unknown>): QhawaySpan {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    model: row.model as string,
    provider: row.provider as string,
    latency_ms: row.latency_ms as number,
    tokens_in: row.tokens_in as number,
    tokens_out: row.tokens_out as number,
    cost_usd: row.cost_usd as number,
    user_id: row.user_id as string | undefined,
    session_id: row.session_id as string | undefined,
    agent_id: row.agent_id as string | undefined,
    tool_name: row.tool_name as string | undefined,
    success: (row.success as number) === 1,
    error: row.error as string | undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}
