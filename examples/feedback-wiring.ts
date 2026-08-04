/**
 * Qhaway-010 — Feedback wiring example.
 *
 * Wire a Tinkuy feedback hook (thumbs up/down) to a Qhaway span with rating.
 * Aggregate the rating vs cost/latency correlation and print stats.
 *
 * Run with:
 *   pnpm tsx examples/feedback-wiring.ts
 */
import { MemoryStorage, aggregateRating, ratingStats } from '@carloscortezcloud/qhaway';
import { QhawayTrace } from '@carloscortezcloud/qhaway/trace';
import type { QhawaySpan } from '@carloscortezcloud/qhaway/trace';

function feedbackHook(
  trace: QhawayTrace,
  sessionId: string,
  userId: string,
): (rating: 1 | -1 | 0, extra?: Partial<QhawaySpan>) => void {
  return (rating, extra = {}) => {
    // A feedback event is a real LLM call with a rating attached.
    const wrapped = trace.wrap(
      async () => ({ ok: true }),
      {
        model: extra.model || 'gpt-4o',
        provider: 'openai',
        session_id: sessionId,
        user_id: userId,
        rating,
        tokens_in: 120,
        tokens_out: 45,
        cost_usd: 0.008,
        latency_ms: 220,
        ...extra,
      },
    );
    void wrapped();
  };
}

async function main(): Promise<void> {
  const storage = new MemoryStorage();
  const trace = new QhawayTrace(storage);

  const thumbs = feedbackHook(trace, 'ses-1', 'alice');
  thumbs(1);          // thumbs up
  thumbs(1);          // thumbs up
  thumbs(-1, { cost_usd: 0.09, latency_ms: 1400 }); // thumbs down, expensive, slow

  // give the async writes a tick
  await new Promise((r) => setTimeout(r, 10));
  await trace.close();

  const spans = (storage as unknown as { spans: QhawaySpan[] }).spans;

  console.log('=== Ratings by model ===');
  for (const row of aggregateRating(spans)) {
    console.log(`${row.model} rating=${row.rating}: ${row.calls} calls, $${row.costUsd.toFixed(4)}, avg ${row.avgLatencyMs}ms`);
  }

  console.log('\n=== Stats ===');
  const stats = ratingStats(spans);
  console.log(
    `thumbs up=${stats.thumbsUp} down=${stats.thumbsDown} | ` +
    `avg cost per UP $${stats.avgCostPerThumbsUp.toFixed(4)} per DOWN $${stats.avgCostPerThumbsDown.toFixed(4)} | ` +
    `down rate=${(stats.thumbsDownRate * 100).toFixed(0)}%`,
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
