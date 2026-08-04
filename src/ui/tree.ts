import type { QhawaySpan } from '../trace/index.js';

export type TraceNodeType = 'session' | 'iteration' | 'tool' | 'agent';

export interface TraceNode {
  id: string;
  type: TraceNodeType;
  label: string;
  span?: QhawaySpan;
  children: TraceNode[];
  costUsd: number;
  latencyMs: number;
  success: boolean;
}

export interface TraceFilters {
  model?: string;
  agent?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  success?: boolean;
  toolName?: string;
}

export const COST_RED_THRESHOLD = 0.05;
export const COST_YELLOW_THRESHOLD = 0.01;

export function costColor(costUsd: number): string {
  if (costUsd > COST_RED_THRESHOLD) return '#ef4444';
  if (costUsd > COST_YELLOW_THRESHOLD) return '#eab308';
  return '#10b981';
}

export function filterSpans(spans: QhawaySpan[], filters: TraceFilters): QhawaySpan[] {
  return spans.filter((s) => {
    if (filters.model && s.model !== filters.model) return false;
    if (filters.agent && s.agent_id !== filters.agent) return false;
    if (filters.sessionId && s.session_id !== filters.sessionId) return false;
    if (filters.toolName && s.tool_name !== filters.toolName) return false;
    if (filters.success !== undefined && s.success !== filters.success) return false;
    if (filters.from && s.timestamp < filters.from) return false;
    if (filters.to && s.timestamp > filters.to) return false;
    return true;
  });
}

export function buildTraceTree(spans: QhawaySpan[]): TraceNode[] {
  const bySession = new Map<string, QhawaySpan[]>();
  const standalone: QhawaySpan[] = [];

  for (const span of spans) {
    if (span.session_id) {
      const list = bySession.get(span.session_id) || [];
      list.push(span);
      bySession.set(span.session_id, list);
    } else {
      standalone.push(span);
    }
  }

  const roots: TraceNode[] = [];

  for (const [sessionId, sessionSpans] of bySession) {
    roots.push(buildSessionNode(sessionId, sessionSpans));
  }

  for (const span of standalone) {
    roots.push(buildLeaf(span));
  }

  return roots.sort((a, b) => b.latencyMs - a.latencyMs);
}

function buildSessionNode(sessionId: string, spans: QhawaySpan[]): TraceNode {
  const children: TraceNode[] = [];
  const llmSpans = spans.filter((s) => !s.tool_name);
  const toolSpans = spans.filter((s) => s.tool_name);

  for (const span of llmSpans) {
    children.push(buildLeaf(span));
  }
  for (const span of toolSpans) {
    children.push(buildLeaf(span, span.tool_name!));
  }

  const node: TraceNode = {
    id: `session-${sessionId}`,
    type: 'session',
    label: `session ${sessionId.slice(0, 8)}`,
    children,
    costUsd: sumCost(spans),
    latencyMs: sumLatency(spans),
    success: spans.every((s) => s.success),
  };
  return node;
}

function buildLeaf(span: QhawaySpan, toolLabel?: string): TraceNode {
  const isTool = !!span.tool_name;
  const isAgentRun = span.tool_name === 'agent.run';
  return {
    id: span.id,
    type: isTool ? (isAgentRun ? 'agent' : 'tool') : 'iteration',
    label: isTool ? (isAgentRun ? 'agent.run' : `tool ${span.tool_name}`) : `${span.model} (${span.provider})`,
    span,
    children: [],
    costUsd: span.cost_usd,
    latencyMs: span.latency_ms,
    success: span.success,
  };
}

function sumCost(spans: QhawaySpan[]): number {
  return spans.reduce((sum, s) => sum + s.cost_usd, 0);
}

function sumLatency(spans: QhawaySpan[]): number {
  return spans.reduce((sum, s) => sum + s.latency_ms, 0);
}
