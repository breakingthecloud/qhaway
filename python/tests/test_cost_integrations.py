"""Tests for cost + integrations + CLI."""

import asyncio
import os
import tempfile
import unittest
from unittest import mock

from qhaway.cost import calculate_cost, resolve_pricing, DEFAULT_PRICING


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class TestCost(unittest.TestCase):
    def test_known_model(self):
        cost = calculate_cost("gpt-4o", 1000, 500)
        self.assertAlmostEqual(cost, 0.005 + 0.0075, places=6)

    def test_unknown_model_returns_minus_one(self):
        self.assertEqual(calculate_cost("made-up-model", 10, 10), -1.0)

    def test_custom_pricing_priority(self):
        custom = [{"model": "my-model", "provider": "acme", "input_per_1k": 0.01, "output_per_1k": 0.02, "context_window": 8000}]
        cost = calculate_cost("my-model", 1000, 1000, custom=custom)
        self.assertAlmostEqual(cost, 0.03, places=6)

    def test_provider_filter(self):
        pricing = resolve_pricing("gpt-4o", provider="openai")
        self.assertEqual(pricing["provider"], "openai")

    def test_default_pricing_has_major_models(self):
        models = {p["model"] for p in DEFAULT_PRICING}
        for expected in ("gpt-4o", "gpt-4o-mini", "claude-sonnet-4", "gemini-2.0-flash"):
            self.assertIn(expected, models)


class TestOpenAIPatch(unittest.TestCase):
    def test_auto_instrumentation(self):
        from qhaway.trace import QhawayTrace
        from qhaway.storage import MemoryStorage
        from qhaway.integrations import OpenAIPatch

        storage = MemoryStorage()
        trace = QhawayTrace(storage=storage, agent_id="ai-agent")
        patch = OpenAIPatch.apply(trace)

        usage = mock.Mock(prompt_tokens=200, completion_tokens=100)
        response = mock.Mock(usage=usage)
        fake_create = mock.AsyncMock(return_value=response)

        import openai.resources.chat.completions as completions_mod

        with mock.patch.object(OpenAIPatch, "_original", fake_create):
            result = run(completions_mod.Completions.create(mock.Mock(), model="gpt-4o"))
            self.assertEqual(result, response)

        spans = run(storage.query())
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].tokens_in, 200)
        self.assertEqual(spans[0].tokens_out, 100)
        self.assertGreater(spans[0].cost_usd, 0)
        patch.restore()


class TestAnthropicPatch(unittest.TestCase):
    def test_auto_instrumentation(self):
        from qhaway.trace import QhawayTrace
        from qhaway.storage import MemoryStorage
        from qhaway.integrations import AnthropicPatch

        storage = MemoryStorage()
        trace = QhawayTrace(storage=storage)
        patch = AnthropicPatch.apply(trace)

        usage = mock.Mock(input_tokens=300, output_tokens=150)
        response = mock.Mock(usage=usage)
        fake_create = mock.AsyncMock(return_value=response)

        import anthropic.resources.messages as messages_mod

        with mock.patch.object(AnthropicPatch, "_original", fake_create):
            result = run(messages_mod.Messages.create(mock.Mock(), model="claude-sonnet-4"))
            self.assertEqual(result, response)

        spans = run(storage.query())
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].provider, "anthropic")
        self.assertEqual(spans[0].tokens_in, 300)
        patch.restore()


class TestHttpStorage(unittest.TestCase):
    def test_posts_spans(self):
        import httpx

        from qhaway.trace import QhawaySpan
        from qhaway.storage import HttpStorage

        req = httpx.Request("POST", "https://qhaway.example.com/spans")
        ok_resp = httpx.Response(200, json={"ok": True}, request=req)

        storage = HttpStorage("https://qhaway.example.com", api_key="k-123", timeout=5)
        with mock.patch.object(httpx.AsyncClient, "post", new_callable=mock.AsyncMock) as mock_post:
            mock_post.return_value = ok_resp
            span = QhawaySpan(
                id="http-1", timestamp="t", model="gpt-4o", provider="openai",
                latency_ms=10, tokens_in=5, tokens_out=3, cost_usd=0.0001,
            )
            run(storage.write(span))
            run(storage.flush())

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(kwargs["json"][0]["id"], "http-1")
        self.assertIn("Authorization", kwargs["headers"])


if __name__ == "__main__":
    unittest.main()
