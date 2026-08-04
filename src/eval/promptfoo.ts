import type { QhawaySpan } from '../trace/index.js';
import { labelEvalRun, toEvalRun } from './evaluation.js';
import type { EvalRunResult } from './evaluation.js';

export interface PromptfooResult {
  prompt?: { raw?: string };
  response?: { output?: unknown };
  pass?: boolean;
  score?: number;
  latencyMs?: number;
  cost?: number;
  tokens?: { input?: number; output?: number };
  provider?: { id?: string };
}

export interface PromptfooOutput {
  results: PromptfooResult[];
  evalId?: string;
  createdAt?: string;
}

export interface ParseOptions {
  evalRunId?: string;
  model?: string;
  defaultPassThreshold?: number;
}

export function parsePromptfooOutput(raw: unknown, opts: ParseOptions = {}): QhawaySpan[] {
  const output = normalize(raw);
  if (!output || !Array.isArray(output.results)) return [];

  const evalRunId = opts.evalRunId ?? output.evalId ?? `promptfoo-${Date.now()}`;
  const model = opts.model ?? 'promptfoo';

  return output.results
    .map((r) => parseResult(r, evalRunId, model, opts.defaultPassThreshold ?? 0.5))
    .filter((s): s is QhawaySpan => s !== undefined);
}

export function parsePromptfooResults(raw: unknown, opts: ParseOptions = {}): EvalRunResult[] {
  return parsePromptfooOutput(raw, opts)
    .map(toEvalRun)
    .filter((r): r is EvalRunResult => r !== undefined);
}

function normalize(raw: unknown): PromptfooOutput | undefined {
  if (Array.isArray(raw)) return { results: raw };
  if (raw && typeof raw === 'object' && 'results' in raw) {
    return raw as PromptfooOutput;
  }
  return undefined;
}

function parseResult(
  r: PromptfooResult,
  evalRunId: string,
  model: string,
  defaultPassThreshold: number,
): QhawaySpan | undefined {
  const score = typeof r.score === 'number' ? r.score : undefined;
  const pass = typeof r.pass === 'boolean' ? r.pass : score !== undefined ? score >= defaultPassThreshold : true;

  const span: QhawaySpan = {
    id: `eval-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    model: r.provider?.id || model,
    provider: 'promptfoo',
    latency_ms: r.latencyMs ?? 0,
    tokens_in: r.tokens?.input ?? 0,
    tokens_out: r.tokens?.output ?? 0,
    cost_usd: r.cost ?? 0,
    success: pass,
    tool_name: 'eval.case',
  };

  const promptText = typeof r.prompt?.raw === 'string' ? r.prompt.raw : undefined;
  const actualText = extractText(r.response?.output);
  return labelEvalRun(span, evalRunId, { score, pass, prompt: promptText, actual: actualText });
}

function extractText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.content === 'string') return o.content;
    if (typeof o.output === 'string') return o.output;
  }
  return undefined;
}
