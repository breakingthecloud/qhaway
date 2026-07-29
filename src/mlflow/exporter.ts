import type { QhawaySpan } from '../trace/index.js';
import { MlflowClient, type MlflowConfig, type MlflowRunInfo } from './client.js';

export interface QhawayMLflowConfig extends MlflowConfig {
  experimentName?: string;
  batchSize?: number;
}

export class QhawayMLflow {
  private client: MlflowClient;
  private experimentName: string;
  private batchSize: number;
  private pendingSpans: QhawaySpan[] = [];
  private experimentId: string | null = null;

  constructor(config: QhawayMLflowConfig) {
    this.client = new MlflowClient(config);
    this.experimentName = config.experimentName ?? 'qhaway-agent-runs';
    this.batchSize = config.batchSize ?? 10;
  }

  async write(span: QhawaySpan): Promise<void> {
    this.pendingSpans.push(span);
    if (this.pendingSpans.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.pendingSpans.length === 0) return;
    const spans = this.pendingSpans.splice(0);
    await this.exportSpans(spans);
  }

  async exportSpans(spans: QhawaySpan[]): Promise<void> {
    if (spans.length === 0) return;

    if (!this.experimentId) {
      await this.ensureExperiment();
    }

    const bySession = groupBySession(spans);

    for (const [, sessionSpans] of bySession) {
      await this.exportSession(sessionSpans);
    }
  }

  private async ensureExperiment(): Promise<void> {
    const id = await this.client.ensureExperiment(this.experimentName);
    this.experimentId = id;
  }

  private async exportSession(spans: QhawaySpan[]): Promise<void> {
    const first = spans[0];
    const last = spans[spans.length - 1];
    const runName = first.session_id
      ? `agent-${first.session_id.slice(0, 8)}`
      : `run-${Date.now()}`;

    let runInfo: MlflowRunInfo;
    try {
      runInfo = await this.client.createRun(this.experimentId!, runName);
    } catch {
      return;
    }

    try {
      const totalCost = spans.reduce((s, x) => s + x.cost_usd, 0);
      const totalLatency = spans.reduce((s, x) => s + x.latency_ms, 0);
      const tokensIn = spans.reduce((s, x) => s + x.tokens_in, 0);
      const tokensOut = spans.reduce((s, x) => s + x.tokens_out, 0);
      const successCount = spans.filter(x => x.success).length;
      const failCount = spans.filter(x => !x.success).length;
      const modelsUsed = [...new Set(spans.map(x => x.model).filter(Boolean))];
      const toolsUsed = [...new Set(spans.map(x => x.tool_name).filter(Boolean))];

      await Promise.all([
        this.client.logMetric(runInfo.runId, 'cost_usd', totalCost),
        this.client.logMetric(runInfo.runId, 'latency_ms', totalLatency),
        this.client.logMetric(runInfo.runId, 'iterations', spans.length),
        this.client.logMetric(runInfo.runId, 'prompt_tokens', tokensIn),
        this.client.logMetric(runInfo.runId, 'completion_tokens', tokensOut),
        this.client.logMetric(runInfo.runId, 'successful_calls', successCount),
        this.client.logMetric(runInfo.runId, 'failed_calls', failCount),
        this.client.logParam(runInfo.runId, 'models', modelsUsed.join(',')),
        this.client.logParam(runInfo.runId, 'tools', toolsUsed.join(',')),
        this.client.setTag(runInfo.runId, 'qhaway_version', '0.7.0'),
        first.session_id && this.client.setTag(runInfo.runId, 'session_id', first.session_id),
        first.agent_id && this.client.setTag(runInfo.runId, 'agent_name', first.agent_id),
      ].filter(Boolean));

      await this.client.updateRun(runInfo.runId, failCount > 0 ? 'FINISHED' : 'FINISHED');
    } catch {
      await this.client.updateRun(runInfo.runId, 'FAILED').catch(() => {});
    }
  }
}

function groupBySession(spans: QhawaySpan[]): Map<string, QhawaySpan[]> {
  const groups = new Map<string, QhawaySpan[]>();
  for (const span of spans) {
    const key = span.session_id ?? 'no-session';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(span);
  }
  return groups;
}
