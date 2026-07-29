import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import { MlflowClient } from './client.js';
import { QhawayMLflow } from './exporter.js';
import type { QhawaySpan } from '../trace/index.js';

interface MockCall {
  method: string;
  path: string;
  body: unknown;
}

const calls: MockCall[] = [];
let mockPort: number;
let primaryMock: http.Server;
const extraServers: http.Server[] = [];

beforeAll(async () => {
  primaryMock = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method!, path: req.url!, body: JSON.parse(body || '{}') });

    if (req.url?.includes('/experiments/search')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ experiments: [{ experiment_id: '123', name: 'test-exp' }] }));
    } else if (req.url?.includes('/experiments/create')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ experiment_id: '123' }));
    } else if (req.url?.includes('/runs/create')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        run: { info: { run_id: 'run-abc-123', experiment_id: '123' } },
      }));
    } else if (req.url?.includes('/runs/log-metric')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } else if (req.url?.includes('/runs/log-parameter')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } else if (req.url?.includes('/runs/set-tag')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } else if (req.url?.includes('/runs/update')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => {
    primaryMock.listen(0, () => {
      mockPort = (primaryMock.address()! as any).port;
      resolve();
    });
  });
});

afterAll(() => {
  primaryMock?.close();
  extraServers.forEach(s => s.close());
});

afterEach(() => {
  calls.length = 0;
});

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

describe('MlflowClient', () => {
  it('creates an experiment', async () => {
    const client = new MlflowClient({ trackingUri: `http://localhost:${mockPort}` });
    const id = await client.ensureExperiment('test-exp');
    expect(id).toBe('123');
    expect(calls[0].path).toContain('/experiments/create');
  });

  it('creates a run', async () => {
    const client = new MlflowClient({ trackingUri: `http://localhost:${mockPort}` });
    const run = await client.createRun('123', 'my-run');
    expect(run.runId).toBe('run-abc-123');
    expect(run.experimentId).toBe('123');
    expect(calls[0].body).toMatchObject({ experiment_id: '123', run_name: 'my-run' });
  });

  it('logs a metric', async () => {
    const client = new MlflowClient({ trackingUri: `http://localhost:${mockPort}` });
    await client.logMetric('run-1', 'cost_usd', 0.05);
    expect(calls[0].body).toMatchObject({ run_id: 'run-1', key: 'cost_usd', value: 0.05 });
  });

  it('logs a param', async () => {
    const client = new MlflowClient({ trackingUri: `http://localhost:${mockPort}` });
    await client.logParam('run-1', 'model', 'gpt-4o');
    expect(calls[0].body).toMatchObject({ run_id: 'run-1', key: 'model', value: 'gpt-4o' });
  });

  it('sets a tag', async () => {
    const client = new MlflowClient({ trackingUri: `http://localhost:${mockPort}` });
    await client.setTag('run-1', 'agent_name', 'my-agent');
    expect(calls[0].body).toMatchObject({ run_id: 'run-1', key: 'agent_name', value: 'my-agent' });
  });

  it('updates a run status', async () => {
    const client = new MlflowClient({ trackingUri: `http://localhost:${mockPort}` });
    await client.updateRun('run-1', 'FINISHED');
    expect(calls[0].body).toMatchObject({ run_id: 'run-1', status: 'FINISHED' });
  });

  it('handles experiment already exists', async () => {
    const s = http.createServer((req, res) => {
      if (req.url?.includes('/experiments/search')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ experiments: [{ experiment_id: 'existing-456', name: 'existing-exp' }] }));
      } else if (req.url?.includes('/experiments/create')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error_code: 'RESOURCE_ALREADY_EXISTS', message: 'already exists' }));
      }
    });
    const port = await new Promise<number>((resolve) => {
      s.listen(0, () => resolve((s.address()! as any).port));
    });
    extraServers.push(s);
    const client = new MlflowClient({ trackingUri: `http://localhost:${port}` });
    const id = await client.ensureExperiment('existing-exp');
    expect(id).toBe('existing-456');
  });
});

describe('QhawayMLflow', () => {
  it('exports spans grouped by session', async () => {
    const exporter = new QhawayMLflow({
      trackingUri: `http://localhost:${mockPort}`,
      experimentName: 'agent-tracking',
    });

    await exporter.exportSpans([
      makeSpan({ session_id: 'session-1', cost_usd: 0.01, model: 'gpt-4o', latency_ms: 100 }),
      makeSpan({ session_id: 'session-1', cost_usd: 0.02, model: 'claude', latency_ms: 200 }),
    ]);

    const paths = calls.map(c => c.path);
    expect(paths).toContain('/api/2.0/mlflow/runs/create');
    expect(paths).toContain('/api/2.0/mlflow/runs/log-metric');
    expect(paths).toContain('/api/2.0/mlflow/runs/update');

    const logMetrics = calls.filter(c => c.path.includes('/log-metric'));
    expect(logMetrics.length).toBeGreaterThanOrEqual(7);
  });

  it('buffers spans and flushes on batchSize', async () => {
    const exporter = new QhawayMLflow({
      trackingUri: `http://localhost:${mockPort}`,
      experimentName: 'test',
      batchSize: 3,
    });

    await exporter.write(makeSpan({ session_id: 'buf-1' }));
    await exporter.write(makeSpan({ session_id: 'buf-1' }));

    const before = calls.filter(c => c.path.includes('/runs/create')).length;
    expect(before).toBe(0);

    await exporter.write(makeSpan({ session_id: 'buf-1' }));

    const after = calls.filter(c => c.path.includes('/runs/create')).length;
    expect(after).toBe(1);
  });

  it('handles empty spans gracefully', async () => {
    const exporter = new QhawayMLflow({
      trackingUri: `http://localhost:${mockPort}`,
    });
    await exporter.exportSpans([]);
    const createCalls = calls.filter(c => c.path.includes('/runs/create'));
    expect(createCalls).toHaveLength(0);
  });
});
