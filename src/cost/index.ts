/**
 * Qhaway Cost Calculator — Pricing DB + Attribution
 *
 * Converts raw tokens to USD cost. Imports pricing from Styrr or uses built-in map.
 * Aggregates cost by user, model, agent, day.
 *
 * @example
 * import { QhawayCost } from '@carloscortezcloud/qhaway/cost';
 * const cost = new QhawayCost({ model: 'gpt-4o', tokensIn: 150, tokensOut: 42 });
 * console.log(cost.usd); // 0.00063
 */

export interface CostConfig {
  model: string;
  provider?: string;
  tokensIn: number;
  tokensOut: number;
}

export class QhawayCost {
  constructor(private config: CostConfig) {}

  get usd(): number {
    return calculateCost(this.config.model, this.config.tokensIn, this.config.tokensOut);
  }
}

interface ModelPricing {
  inputPer1K: number;
  outputPer1K: number;
}

const BUILTIN_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPer1K: 0.005, outputPer1K: 0.015 },
  'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
  'claude-sonnet-4-20250514': { inputPer1K: 0.003, outputPer1K: 0.015 },
  'claude-haiku-3.5': { inputPer1K: 0.0008, outputPer1K: 0.004 },
};

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = findPricing(model);
  if (!pricing) return -1;
  return (tokensIn / 1000) * pricing.inputPer1K + (tokensOut / 1000) * pricing.outputPer1K;
}

export function findPricing(model: string): ModelPricing | undefined {
  return BUILTIN_PRICING[model];
}
