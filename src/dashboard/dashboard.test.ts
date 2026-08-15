import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('qhaway-dashboard.json', () => {
  const jsonPath = resolve(__dirname, 'qhaway-dashboard.json');
  const raw = readFileSync(jsonPath, 'utf-8');
  const dashboard = JSON.parse(raw);

  it('is valid JSON', () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has required top-level fields', () => {
    expect(dashboard.title).toBe('Qhaway — AI Agent Observability');
    expect(dashboard.schemaVersion).toBeGreaterThanOrEqual(39);
    expect(dashboard.editable).toBe(true);
  });

  it('panels reference Prometheus data source', () => {
    const panel = dashboard.panels[0];
    expect(panel.datasource.type).toBe('prometheus');
    expect(panel.datasource.uid).toBe('prometheus-uid');
  });

  it('has 8 panels', () => {
    expect(dashboard.panels).toHaveLength(8);
  });

  it('panels have expected titles', () => {
    const titles = dashboard.panels.map((p: any) => p.title);
    expect(titles).toContain('Daily Spend');
    expect(titles).toContain('Cost by Model');
    expect(titles).toContain('Latency P99');
    expect(titles).toContain('Cost by User');
    expect(titles).toContain('Token Usage (Input vs Output)');
    expect(titles).toContain('LLM Calls');
    expect(titles).toContain('Satisfaction vs Cost');
    expect(titles).toContain('Budget Guardrails (Sayay)');
  });

  it('Budget Guardrails panel references sayay decisions metric', () => {
    const panel = dashboard.panels.find((p: any) => p.title === 'Budget Guardrails (Sayay)');
    expect(panel).toBeDefined();
    expect(panel.type).toBe('barchart');
    expect(panel.targets[0].expr).toContain('qhaway_sayay_decisions_total');
  });

  it('Satisfaction vs Cost is a scatter panel referencing rating metrics', () => {
    const panel = dashboard.panels.find((p: any) => p.title === 'Satisfaction vs Cost');
    expect(panel.type).toBe('scatter');
    const exprs = panel.targets.map((t: any) => t.expr).join(' ');
    expect(exprs).toContain('qhaway_cost_by_rating_total');
    expect(exprs).toContain('qhaway_rating_total');
  });

  it('Daily Spend has USD unit and thresholds', () => {
    const spend = dashboard.panels.find((p: any) => p.title === 'Daily Spend');
    expect(spend.fieldConfig.defaults.unit).toBe('usd');
    expect(spend.fieldConfig.defaults.thresholds.steps).toHaveLength(3);
  });

  it('Cost by Model uses topk(10)', () => {
    const panel = dashboard.panels.find((p: any) => p.title === 'Cost by Model');
    expect(panel.targets[0].expr).toContain('topk(10');
  });

  it('Latency P99 uses histogram_quantile', () => {
    const panel = dashboard.panels.find((p: any) => p.title === 'Latency P99');
    expect(panel.targets[0].expr).toContain('histogram_quantile');
    expect(panel.fieldConfig.defaults.unit).toBe('s');
  });

  it('Token Usage has stacking enabled', () => {
    const panel = dashboard.panels.find((p: any) => p.title === 'Token Usage (Input vs Output)');
    expect(panel.options.stacking.mode).toBe('normal');
  });

  it('has alert rule for daily spend', () => {
    expect(dashboard.alerting).toBeDefined();
    expect(dashboard.alerting.alerts).toHaveLength(1);
    expect(dashboard.alerting.alerts[0].title).toContain('Daily spend exceeded');
  });
});
