"""Cost calculation with a local pricing map — no external dependency.

Mirrors the TypeScript `QhawayCost` / `calculateCost` API.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

ModelPricing = Dict[str, Any]

DEFAULT_PRICING: List[ModelPricing] = [
    {"model": "gpt-4o", "provider": "openai", "input_per_1k": 0.005, "output_per_1k": 0.015, "context_window": 128000},
    {"model": "gpt-4o-mini", "provider": "openai", "input_per_1k": 0.00015, "output_per_1k": 0.0006, "context_window": 128000},
    {"model": "gpt-4-turbo", "provider": "openai", "input_per_1k": 0.01, "output_per_1k": 0.03, "context_window": 128000},
    {"model": "gpt-3.5-turbo", "provider": "openai", "input_per_1k": 0.0005, "output_per_1k": 0.0015, "context_window": 16385},
    {"model": "claude-sonnet-4-20250514", "provider": "anthropic", "input_per_1k": 0.003, "output_per_1k": 0.015, "context_window": 200000},
    {"model": "claude-sonnet-4", "provider": "anthropic", "input_per_1k": 0.003, "output_per_1k": 0.015, "context_window": 200000},
    {"model": "claude-haiku-3.5", "provider": "anthropic", "input_per_1k": 0.0008, "output_per_1k": 0.004, "context_window": 200000},
    {"model": "claude-opus-4", "provider": "anthropic", "input_per_1k": 0.015, "output_per_1k": 0.075, "context_window": 200000},
    {"model": "gemini-1.5-pro", "provider": "google", "input_per_1k": 0.0035, "output_per_1k": 0.0105, "context_window": 1000000},
    {"model": "gemini-1.5-flash", "provider": "google", "input_per_1k": 0.00035, "output_per_1k": 0.00105, "context_window": 1000000},
    {"model": "gemini-2.0-flash", "provider": "google", "input_per_1k": 0.0001, "output_per_1k": 0.0004, "context_window": 1000000},
]

DEFAULT_FALLBACK = {"input_per_1k": 0.002, "output_per_1k": 0.006, "context_window": 4096}


def resolve_pricing(
    model: str,
    provider: Optional[str] = None,
    custom: Optional[List[ModelPricing]] = None,
) -> Optional[ModelPricing]:
    sources = []
    if custom:
        sources.append(custom)
    sources.append(DEFAULT_PRICING)

    for table in sources:
        for entry in table:
            if entry["model"] == model and (not provider or entry["provider"] == provider):
                return entry
        for entry in table:
            if entry["model"] == model:
                return entry
        for entry in table:
            if model.startswith(entry["model"]) or model.endswith(entry["model"]):
                return entry
        if provider:
            for entry in table:
                if entry["provider"] == provider:
                    return entry
    return None


def calculate_cost(
    model: str,
    tokens_in: int,
    tokens_out: int,
    provider: Optional[str] = None,
    custom: Optional[List[ModelPricing]] = None,
) -> float:
    """Cost in USD. Returns -1 when no pricing is known for the model."""
    pricing = resolve_pricing(model, provider, custom)
    if pricing is None:
        return -1.0
    return (tokens_in / 1000) * pricing["input_per_1k"] + (tokens_out / 1000) * pricing["output_per_1k"]
