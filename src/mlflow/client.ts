export interface MlflowConfig {
  trackingUri: string;
  experimentName?: string;
  token?: string;
  headers?: Record<string, string>;
}

export interface MlflowRunInfo {
  runId: string;
  experimentId: string;
}

interface MlflowResponse {
  run?: { info: { run_id: string; experiment_id: string } };
  experiment_id?: string;
}

export class MlflowClient {
  private uri: string;
  private headers: Record<string, string>;

  constructor(private config: MlflowConfig) {
    this.uri = config.trackingUri.replace(/\/+$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    };
  }

  private async request(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.uri}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
  }

  async ensureExperiment(name: string): Promise<string> {
    const res = await fetch(`${this.uri}/api/2.0/mlflow/experiments/create`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 409 || body.includes('RESOURCE_ALREADY_EXISTS')) {
        return this.getExperimentId(name);
      }
      throw new Error(`MLflow create experiment failed: ${res.status} ${body}`);
    }
    const data: MlflowResponse = await res.json();
    return data.experiment_id ?? name;
  }

  private async getExperimentId(name: string): Promise<string> {
    const res = await this.request('/api/2.0/mlflow/experiments/search', { max_results: 100 });
    if (!res.ok) throw new Error(`MLflow search experiments failed: ${res.status}`);
    const data = await res.json();
    const exp = data.experiments?.find((e: any) => e.name === name);
    if (!exp) throw new Error(`MLflow experiment '${name}' not found after creation attempt`);
    return exp.experiment_id;
  }

  async createRun(experimentId: string, runName?: string): Promise<MlflowRunInfo> {
    const res = await this.request('/api/2.0/mlflow/runs/create', {
      experiment_id: experimentId,
      run_name: runName,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MLflow create run failed: ${res.status} ${body}`);
    }
    const data: MlflowResponse = await res.json();
    return {
      runId: data.run!.info.run_id,
      experimentId: data.run!.info.experiment_id,
    };
  }

  async logMetric(runId: string, key: string, value: number, step?: number): Promise<void> {
    const res = await this.request('/api/2.0/mlflow/runs/log-metric', {
      run_id: runId, key, value, timestamp: Date.now(), step: step ?? 0,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MLflow log metric failed: ${res.status} ${body}`);
    }
  }

  async logParam(runId: string, key: string, value: string): Promise<void> {
    const res = await this.request('/api/2.0/mlflow/runs/log-parameter', {
      run_id: runId, key, value,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MLflow log param failed: ${res.status} ${body}`);
    }
  }

  async setTag(runId: string, key: string, value: string): Promise<void> {
    const res = await this.request('/api/2.0/mlflow/runs/set-tag', {
      run_id: runId, key, value,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MLflow set tag failed: ${res.status} ${body}`);
    }
  }

  async updateRun(runId: string, status: 'RUNNING' | 'FINISHED' | 'FAILED' = 'FINISHED'): Promise<void> {
    const res = await this.request('/api/2.0/mlflow/runs/update', {
      run_id: runId, status,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MLflow update run failed: ${res.status} ${body}`);
    }
  }
}
