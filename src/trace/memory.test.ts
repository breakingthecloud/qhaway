import { describe, it, expect } from 'vitest';
import { MemoryStorage } from './memory.js';
import type { QhawaySpan } from './index.js';

function makeSpan(overrides: Partial<QhawaySpan> = {}): QhawaySpan {
  return {
    id: 'test-id',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    provider: 'openai',
    latency_ms: 100,
    tokens_in: 50,
    tokens_out: 30,
    cost_usd: 0.01,
    success: true,
    ...overrides,
  };
}

describe('MemoryStorage', () => {
  it('stores and retrieves spans', async () => {
    const storage = new MemoryStorage();
    await storage.write(makeSpan());
    const spans = await storage.query();
    expect(spans).toHaveLength(1);
  });

  it('filters by model', async () => {
    const storage = new MemoryStorage();
    await storage.write(makeSpan({ model: 'gpt-4o' }));
    await storage.write(makeSpan({ model: 'claude' }));
    const gpt = await storage.query({ model: 'gpt-4o' });
    expect(gpt).toHaveLength(1);
    expect(gpt[0].model).toBe('gpt-4o');
  });

  it('filters by success', async () => {
    const storage = new MemoryStorage();
    await storage.write(makeSpan({ success: true }));
    await storage.write(makeSpan({ success: false }));
    const failed = await storage.query({ success: false });
    expect(failed).toHaveLength(1);
  });

  it('limits results', async () => {
    const storage = new MemoryStorage();
    await storage.write(makeSpan({ id: '1' }));
    await storage.write(makeSpan({ id: '2' }));
    await storage.write(makeSpan({ id: '3' }));
    const limited = await storage.query(undefined, 2);
    expect(limited).toHaveLength(2);
    expect(limited[0].id).toBe('2');
    expect(limited[1].id).toBe('3');
  });

  it('clears all spans', async () => {
    const storage = new MemoryStorage();
    await storage.write(makeSpan());
    await storage.clear();
    expect(await storage.query()).toHaveLength(0);
  });

  it('reports count', async () => {
    const storage = new MemoryStorage();
    expect(storage.count).toBe(0);
    await storage.write(makeSpan());
    expect(storage.count).toBe(1);
  });

  it('evicts oldest spans when maxSpans is exceeded', async () => {
    const storage = new MemoryStorage({ maxSpans: 2 });
    await storage.write(makeSpan({ id: 'a' }));
    await storage.write(makeSpan({ id: 'b' }));
    await storage.write(makeSpan({ id: 'c' }));
    expect(storage.count).toBe(2);
    const spans = await storage.query();
    expect(spans.map(s => s.id)).toEqual(['b', 'c']);
  });

  it('keeps all spans when maxSpans is not set', async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 1000; i++) {
      await storage.write(makeSpan({ id: String(i) }));
    }
    expect(storage.count).toBe(1000);
  });
});
