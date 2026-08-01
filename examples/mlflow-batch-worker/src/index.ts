import { QhawayMLflow } from '@carloscortezcloud/qhaway/mlflow';

export interface Env {
  DB: D1Database;
  MLFLOW_TRACKING_URI: string;
  MLFLOW_TOKEN?: string;
  MLFLOW_EXPERIMENT?: string;
}

// Cron worker: batch-export spans from D1 to MLflow.
// Requires a D1 `exported` flag on spans (or a watermark table).
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const exporter = new QhawayMLflow({
      trackingUri: env.MLFLOW_TRACKING_URI,
      token: env.MLFLOW_TOKEN,
      experimentName: env.MLFLOW_EXPERIMENT ?? 'qhaway-agent-runs',
      batchSize: 25,
    });

    const { results } = await env.DB.prepare(
      `SELECT * FROM traces WHERE exported = 0 ORDER BY timestamp ASC LIMIT 500`,
    ).bind().all();

    if (!results || results.length === 0) return;

    const spans = results.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      model: row.model,
      provider: row.provider ?? 'unknown',
      latency_ms: row.latency_ms ?? 0,
      tokens_in: row.tokens_in ?? 0,
      tokens_out: row.tokens_out ?? 0,
      cost_usd: row.cost_usd ?? 0,
      user_id: row.user_id,
      session_id: row.session_id,
      agent_id: row.agent_id,
      tool_name: row.tool_name,
      success: row.success === 1,
      error: row.error,
    }));

    await exporter.exportSpans(spans);

    // Mark exported so the cron only picks up new spans next run
    await env.DB.prepare(
      `UPDATE traces SET exported = 1 WHERE id IN (SELECT id FROM traces WHERE exported = 0 LIMIT 500)`,
    ).bind().all();

    console.log(`[Qhaway MLflow] exported ${spans.length} spans to ${env.MLFLOW_TRACKING_URI}`);
  },
} satisfies ExportedHandler<Env>;
