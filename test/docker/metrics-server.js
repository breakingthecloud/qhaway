const http = require('http');

let counter = 0;

const models = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4'];
const users = ['alice', 'bob', 'charlie'];

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function generateMetrics() {
  counter++;
  const lines = [];

  lines.push('# HELP qhaway_cost_total Total cost by model and user');
  lines.push('# TYPE qhaway_cost_total counter');
  for (const model of models) {
    for (const user of users) {
      const cost = (counter * rand(0.001, 0.02)).toFixed(4);
      lines.push(`qhaway_cost_total{model="${model}",provider="openai",user="${user}"} ${cost}`);
    }
  }

  lines.push('');
  lines.push('# HELP qhaway_latency_seconds LLM call latency distribution');
  lines.push('# TYPE qhaway_latency_seconds histogram');
  for (const model of models) {
    const baseCount = counter;
    lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="0.1"} ${Math.floor(baseCount * rand(0.05, 0.2))}`);
    lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="0.5"} ${Math.floor(baseCount * rand(0.3, 0.5))}`);
    lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="1"} ${Math.floor(baseCount * rand(0.6, 0.8))}`);
    lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="2"} ${Math.floor(baseCount * rand(0.8, 0.95))}`);
    lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="5"} ${Math.floor(baseCount * rand(0.95, 1))}`);
    lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="10"} ${Math.floor(baseCount * rand(0.98, 1))}`);
    lines.push(`qhaway_latency_seconds_bucket{model="${model}",le="+Inf"} ${baseCount}`);
    lines.push(`qhaway_latency_seconds_sum{model="${model}"} ${(baseCount * rand(0.3, 1.5)).toFixed(2)}`);
    lines.push(`qhaway_latency_seconds_count{model="${model}"} ${baseCount}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_tokens_input_total Input tokens consumed');
  lines.push('# TYPE qhaway_tokens_input_total counter');
  for (const model of models) {
    lines.push(`qhaway_tokens_input_total{model="${model}"} ${counter * Math.floor(rand(50, 500))}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_tokens_output_total Output tokens generated');
  lines.push('# TYPE qhaway_tokens_output_total counter');
  for (const model of models) {
    lines.push(`qhaway_tokens_output_total{model="${model}"} ${counter * Math.floor(rand(20, 200))}`);
  }

  lines.push('');
  lines.push('# HELP qhaway_calls_total Total LLM calls');
  lines.push('# TYPE qhaway_calls_total counter');
  for (const model of models) {
    const success = Math.floor(counter * rand(0.85, 1));
    const failed = counter - success;
    lines.push(`qhaway_calls_total{model="${model}",success="true"} ${success}`);
    lines.push(`qhaway_calls_total{model="${model}",success="false"} ${failed}`);
  }

  return lines.join('\n') + '\n';
}

const server = http.createServer((req, res) => {
  if (req.url === '/metrics') {
    const body = generateMetrics();
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body);
  } else {
    res.writeHead(200);
    res.end('Qhaway test metrics server. Try GET /metrics\n');
  }
});

server.listen(9090, () => {
  console.log('Qhaway test metrics server on http://0.0.0.0:9090/metrics');
  console.log('Generates random metrics on every request — refresh rate depends on Grafana scrape interval (30s default)');
});
