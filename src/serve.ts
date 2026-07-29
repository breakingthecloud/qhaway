import http from 'node:http';
import type { QhawaySpan, QhawayStorage } from './trace/index.js';
import { MemoryStorage } from './trace/memory.js';
import { generatePrometheusMetrics } from './cost/metrics.js';

export interface ServeMetricsConfig {
  port?: number;
  storage?: QhawayStorage;
}

export function serveMetrics(config: ServeMetricsConfig = {}): {
  server: http.Server;
  storage: QhawayStorage;
  close: () => Promise<void>;
} {
  const port = config.port ?? 9090;
  const storage = config.storage ?? new MemoryStorage();

  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      try {
        const spans = storage.query
          ? await storage.query()
          : [];
        const metrics = generatePrometheusMetrics(spans);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(metrics);
      } catch (err) {
        res.writeHead(500);
        res.end('Internal Server Error\n');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Qhaway metrics server — GET /metrics\n');
  });

  server.listen(port, () => {
    console.log(`[Qhaway] metrics server listening on http://0.0.0.0:${port}/metrics`);
  });

  const close = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return { server, storage, close };
}
