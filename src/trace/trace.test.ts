import { describe, it, expect, vi } from 'vitest';
import { QhawayTrace } from './index.js';
import type { QhawaySpan, QhawayStorage } from './index.js';

class MockStorage implements QhawayStorage {
  spans: QhawaySpan[] = [];
  async write(span: QhawaySpan): Promise<void> {
    this.spans.push(span);
  }
}

describe('QhawayTrace', () => {
  it('wraps a function and captures success span', async () => {
    const storage = new MockStorage();
    const trace = new QhawayTrace(storage);

    const fn = async (x: number) => x * 2;
    const wrapped = trace.wrap(fn, { model: 'gpt-4o', provider: 'openai' });

    const result = await wrapped(21);
    expect(result).toBe(42);
    expect(storage.spans).toHaveLength(1);
    const span = storage.spans[0];
    expect(span.model).toBe('gpt-4o');
    expect(span.provider).toBe('openai');
    expect(span.success).toBe(true);
    expect(span.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('captures error spans on thrown exceptions', async () => {
    const storage = new MockStorage();
    const trace = new QhawayTrace(storage);

    const fn = async () => { throw new Error('boom'); };
    const wrapped = trace.wrap(fn, { model: 'gpt-4o' });

    await expect(wrapped()).rejects.toThrow('boom');
    expect(storage.spans).toHaveLength(1);
    expect(storage.spans[0].success).toBe(false);
    expect(storage.spans[0].error).toBe('boom');
  });

  it('attaches metadata to spans', async () => {
    const storage = new MockStorage();
    const trace = new QhawayTrace(storage, { agent_id: 'my-agent' });

    const wrapped = trace.wrap(async () => 'ok', { user_id: 'user-1', session_id: 'ses-1' });
    await wrapped();

    const span = storage.spans[0];
    expect(span.agent_id).toBe('my-agent');
    expect(span.user_id).toBe('user-1');
    expect(span.session_id).toBe('ses-1');
  });

  it('generates unique span IDs', async () => {
    const storage = new MockStorage();
    const trace = new QhawayTrace(storage);

    const fn = async () => 'ok';
    const wrapped = trace.wrap(fn);

    await wrapped();
    await wrapped();
    expect(storage.spans[0].id).toBeDefined();
    expect(storage.spans[0].id).not.toBe(storage.spans[1].id);
  });
});
