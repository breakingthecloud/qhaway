import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('qhaway-eval-dashboard.json', () => {
  const jsonPath = resolve(__dirname, 'qhaway-eval-dashboard.json');
  const raw = readFileSync(jsonPath, 'utf-8');
  const dashboard = JSON.parse(raw);

  it('is valid JSON', () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has required top-level fields', () => {
    expect(dashboard.title).toBe('Qhaway \u2014 Agent Eval Overview');
    expect(dashboard.schemaVersion).toBeGreaterThanOrEqual(39);
  });

  it('has 4 panels', () => {
    expect(dashboard.panels).toHaveLength(4);
  });

  it('panels have expected titles', () => {
    const titles = dashboard.panels.map((p: any) => p.title);
    expect(titles).toContain('Eval Pass Rate');
    expect(titles).toContain('Cost per Score Point');
    expect(titles).toContain('Cost vs Score by Model');
    expect(titles).toContain('Eval Run Comparison');
  });

  it('panels reference Prometheus and eval metrics', () => {
    for (const panel of dashboard.panels) {
      expect(panel.datasource.type).toBe('prometheus');
      for (const target of panel.targets) {
        expect(target.expr).toMatch(/qhaway_eval_/);
      }
    }
  });

  it('Cost per Score Point computes cost per score point', () => {
    const panel = dashboard.panels.find((p: any) => p.title === 'Cost per Score Point');
    expect(panel.targets[0].expr).toContain('qhaway_eval_run_cost_total');
    expect(panel.targets[0].expr).toContain('qhaway_eval_run_score');
    expect(panel.fieldConfig.defaults.unit).toBe('usd');
  });
});
