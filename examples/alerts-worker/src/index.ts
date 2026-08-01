import { createCronWorker } from '@carloscortezcloud/qhaway/alerts';
import { D1Storage } from '@carloscortezcloud/qhaway/trace';

export interface Env {
  DB: D1Database;
  ALERT_RULES_JSON?: string;
  SLACK_WEBHOOK_URL?: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const worker = createCronWorker({
      storage: new D1Storage(env.DB),
      env: {
        DB: env.DB,
        ALERT_RULES_JSON: env.ALERT_RULES_JSON,
      },
      ctx,
      onError: (err) => console.error('[Qhaway Alerts] error:', err),
    });
    await worker.scheduled(event);
  },
} satisfies ExportedHandler<Env>;
