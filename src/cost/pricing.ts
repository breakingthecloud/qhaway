export interface ModelPricing {
  model: string;
  provider: string;
  inputPer1K: number;
  outputPer1K: number;
  contextWindow: number;
  avgLatencyMs?: number;
  qualityScore?: number;
}

const BUILTIN_PRICING: ModelPricing[] = [
  { model: 'gpt-4o', provider: 'openai', inputPer1K: 0.005, outputPer1K: 0.015, contextWindow: 128000, avgLatencyMs: 800, qualityScore: 92 },
  { model: 'gpt-4o-mini', provider: 'openai', inputPer1K: 0.00015, outputPer1K: 0.0006, contextWindow: 128000, avgLatencyMs: 400, qualityScore: 78 },
  { model: 'gpt-4-turbo', provider: 'openai', inputPer1K: 0.01, outputPer1K: 0.03, contextWindow: 128000, avgLatencyMs: 900, qualityScore: 91 },
  { model: 'gpt-3.5-turbo', provider: 'openai', inputPer1K: 0.0005, outputPer1K: 0.0015, contextWindow: 16385, avgLatencyMs: 300, qualityScore: 65 },
  { model: 'claude-sonnet-4-20250514', provider: 'anthropic', inputPer1K: 0.003, outputPer1K: 0.015, contextWindow: 200000, avgLatencyMs: 900, qualityScore: 93 },
  { model: 'claude-sonnet-4', provider: 'anthropic', inputPer1K: 0.003, outputPer1K: 0.015, contextWindow: 200000, avgLatencyMs: 900, qualityScore: 93 },
  { model: 'claude-haiku-3.5', provider: 'anthropic', inputPer1K: 0.0008, outputPer1K: 0.004, contextWindow: 200000, avgLatencyMs: 400, qualityScore: 75 },
  { model: 'claude-opus-4', provider: 'anthropic', inputPer1K: 0.015, outputPer1K: 0.075, contextWindow: 200000, avgLatencyMs: 1200, qualityScore: 96 },
  { model: 'gemini-1.5-pro', provider: 'google', inputPer1K: 0.0035, outputPer1K: 0.0105, contextWindow: 1000000, avgLatencyMs: 700, qualityScore: 88 },
  { model: 'gemini-1.5-flash', provider: 'google', inputPer1K: 0.00035, outputPer1K: 0.00105, contextWindow: 1000000, avgLatencyMs: 300, qualityScore: 72 },
  { model: 'gemini-2.0-flash', provider: 'google', inputPer1K: 0.0001, outputPer1K: 0.0004, contextWindow: 1000000, avgLatencyMs: 250, qualityScore: 80 },
];

export function getBuiltinPricing(): ModelPricing[] {
  return BUILTIN_PRICING;
}

async function tryImportStyrr(): Promise<ModelPricing[] | null> {
  try {
    const styrr = await import('@carloscortezcloud/styrr-llm');
    if (styrr.MODEL_PRICING && Array.isArray(styrr.MODEL_PRICING)) {
      return styrr.MODEL_PRICING as ModelPricing[];
    }
    return null;
  } catch {
    return null;
  }
}

let styrrPricingCache: ModelPricing[] | null = null;
let styrrAttempted = false;

async function getStyrrPricing(): Promise<ModelPricing[] | null> {
  if (!styrrAttempted) {
    styrrAttempted = true;
    styrrPricingCache = await tryImportStyrr();
  }
  return styrrPricingCache;
}

export async function resolvePricing(
  model: string,
  provider?: string,
  customPricing?: ModelPricing[],
): Promise<ModelPricing | undefined> {
  if (customPricing) {
    const found = findInList(customPricing, model, provider);
    if (found) return found;
  }

  const styrr = await getStyrrPricing();
  if (styrr) {
    const found = findInList(styrr, model, provider);
    if (found) return found;
  }

  return findInList(BUILTIN_PRICING, model, provider);
}

export async function getDefaultPricing(
  model: string,
  provider?: string,
  customPricing?: ModelPricing[],
): Promise<{ inputPer1K: number; outputPer1K: number; contextWindow: number }> {
  const found = await resolvePricing(model, provider, customPricing);
  if (!found) {
    return { inputPer1K: 0.002, outputPer1K: 0.006, contextWindow: 4096 };
  }
  return { inputPer1K: found.inputPer1K, outputPer1K: found.outputPer1K, contextWindow: found.contextWindow };
}

function findInList(list: ModelPricing[], model: string, provider?: string): ModelPricing | undefined {
  const exact = list.find(p => p.model === model && (!provider || p.provider === provider));
  if (exact) return exact;

  const modelOnly = list.find(p => p.model === model);
  if (modelOnly) return modelOnly;

  const prefix = list.find(p => model.startsWith(p.model) || model.endsWith(p.model));
  if (prefix) return prefix;

  if (provider) {
    return list.find(p => p.provider === provider);
  }

  return undefined;
}
