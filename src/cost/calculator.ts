import type { QhawaySpan } from '../trace/index.js';
import type { ModelPricing } from './pricing.js';
import { resolvePricing } from './pricing.js';

export interface CostConfig {
  customPricing?: ModelPricing[];
}

export class QhawayCost {
  constructor(private config: CostConfig = {}) {}

  async calculate(model: string, tokensIn: number, tokensOut: number, provider?: string): Promise<number> {
    const pricing = await resolvePricing(model, provider, this.config.customPricing);
    if (!pricing) return -1;
    return (tokensIn / 1000) * pricing.inputPer1K + (tokensOut / 1000) * pricing.outputPer1K;
  }

  async apply(span: QhawaySpan): Promise<QhawaySpan> {
    const cost = await this.calculate(span.model, span.tokens_in, span.tokens_out, span.provider);
    return { ...span, cost_usd: cost >= 0 ? cost : span.cost_usd };
  }
}

export async function calculateCost(model: string, tokensIn: number, tokensOut: number, provider?: string): Promise<number> {
  const pricing = await resolvePricing(model, provider);
  if (!pricing) return -1;
  return (tokensIn / 1000) * pricing.inputPer1K + (tokensOut / 1000) * pricing.outputPer1K;
}
