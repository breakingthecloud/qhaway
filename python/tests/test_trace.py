"""Tests for core trace + storage — runnable with pytest or unittest."""

import asyncio
import tempfile
import os
import unittest

from qhaway.trace import QhawayTrace, QhawaySpan
from qhaway.storage import MemoryStorage, ConsoleStorage, SqliteStorage, CompositeStorage


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class TestMemoryStorage(unittest.TestCase):
    def test_write_and_query(self):
        storage = MemoryStorage()
        span = QhawaySpan(
            id="s1", timestamp="2026-07-31T00:00:00", model="gpt-4o", provider="openai",
            latency_ms=100, tokens_in=10, tokens_out=5, cost_usd=0.001, user_id="alice",
        )
        run(storage.write(span))
        self.assertEqual(len(run(storage.query())), 1)
        by_user = run(storage.query(user_id="alice"))
        self.assertEqual(by_user[0].id, "s1")
        none = run(storage.query(user_id="bob"))
        self.assertEqual(none, [])

    def test_max_spans(self):
        storage = MemoryStorage(max_spans=2)
        for i in range(4):
            run(storage.write(QhawaySpan(
                id=str(i), timestamp="t", model="m", provider="p",
                latency_ms=0, tokens_in=0, tokens_out=0, cost_usd=0.0,
            )))
        self.assertEqual(len(storage.spans), 2)
        self.assertEqual(storage.spans[0].id, "2")


class TestQhawayTrace(unittest.TestCase):
    def test_wrap_records_success(self):
        storage = MemoryStorage()
        trace = QhawayTrace(storage=storage, agent_id="test-agent")

        @trace.wrap(model="gpt-4o", provider="openai", user_id="alice")
        async def call(prompt):
            return f"echo:{prompt}"

        result = run(call("hi"))
        self.assertEqual(result, "echo:hi")
        spans = run(storage.query())
        self.assertEqual(len(spans), 1)
        self.assertTrue(spans[0].success)
        self.assertEqual(spans[0].model, "gpt-4o")
        self.assertEqual(spans[0].agent_id, "test-agent")
        self.assertEqual(spans[0].user_id, "alice")
        self.assertGreaterEqual(spans[0].latency_ms, 0)

    def test_wrap_records_failure(self):
        storage = MemoryStorage()
        trace = QhawayTrace(storage=storage)

        @trace.wrap(model="gpt-4o", provider="openai")
        async def boom():
            raise ValueError("nope")

        with self.assertRaises(ValueError):
            run(boom())
        spans = run(storage.query())
        self.assertEqual(len(spans), 1)
        self.assertFalse(spans[0].success)
        self.assertIn("nope", spans[0].error)


class TestSqliteStorage(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test.db")

    def test_roundtrip(self):
        storage = SqliteStorage(path=self.db_path)
        span = QhawaySpan(
            id="persist-1", timestamp="2026-07-31T00:00:00", model="claude-sonnet-4",
            provider="anthropic", latency_ms=500, tokens_in=100, tokens_out=50,
            cost_usd=0.02, session_id="sess-1", metadata={"env": "prod"},
        )
        run(storage.write(span))

        storage2 = SqliteStorage(path=self.db_path)
        loaded = run(storage2.query(session_id="sess-1"))
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0].model, "claude-sonnet-4")
        self.assertEqual(loaded[0].metadata, {"env": "prod"})
        run(storage2.close())

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmpdir, ignore_errors=True)


class TestCompositeStorage(unittest.TestCase):
    def test_fanout_and_merge(self):
        mem1 = MemoryStorage()
        mem2 = MemoryStorage()
        comp = CompositeStorage([mem1, mem2])
        span = QhawaySpan(
            id="c1", timestamp="t", model="m", provider="p",
            latency_ms=1, tokens_in=1, tokens_out=1, cost_usd=0.0,
        )
        run(comp.write(span))
        self.assertEqual(len(mem1.spans), 1)
        self.assertEqual(len(mem2.spans), 1)
        self.assertEqual(len(run(comp.query())), 1)


if __name__ == "__main__":
    unittest.main()
