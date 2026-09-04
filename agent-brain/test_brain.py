"""Unit tests for agent-brain. No network/AWS calls — all offline."""

import sys
import unittest

sys.path.insert(0, ".")

from app import app
from master import NodeCaller, build_agent, neutralize_templates, summarize_args
from toolspec import EXPECTED_TOOL_NAMES, TOOL_SPECS


class FakeCaller:
    def __call__(self, tool, args):
        return {"ok": True}


class TestToolTable(unittest.TestCase):
    def test_tool_count_and_unique_names(self):
        self.assertEqual(len(TOOL_SPECS), 18)
        names = [n for n, _, _ in TOOL_SPECS]
        self.assertEqual(len(set(names)), 18)
        self.assertEqual(sorted(names), sorted(EXPECTED_TOOL_NAMES))

    def test_every_tool_has_description_and_params(self):
        for name, desc, params in TOOL_SPECS:
            self.assertTrue(desc, name)
            self.assertIsInstance(params, list, name)


class TestAgentBuild(unittest.TestCase):
    def test_build_registers_all_tools_with_declarations(self):
        agent = build_agent("bedrock/test-model", FakeCaller())
        self.assertEqual(agent.name, "chalkboard_master")
        self.assertEqual(len(agent.tools), 18)
        names = sorted(t.name for t in agent.tools)
        self.assertEqual(names, sorted(EXPECTED_TOOL_NAMES))
        for tool in agent.tools:
            decl = tool._get_declaration()
            self.assertTrue(decl.name)
            self.assertTrue(decl.description)

    def test_required_fields_survive(self):
        agent = build_agent("bedrock/test-model", FakeCaller())
        by_name = {t.name: t for t in agent.tools}
        schema = by_name["chalkboard_write_text"]._get_declaration().parameters_json_schema
        self.assertEqual(sorted(schema["required"]), ["text", "x", "y"])


class TestNeutralize(unittest.TestCase):
    def test_placeholders_neutralized(self):
        self.assertEqual(neutralize_templates('Title: "{ROOM_TITLE}"'), 'Title: "[ROOM_TITLE]"')

    def test_code_braces_untouched(self):
        self.assertEqual(neutralize_templates('{"role": "user"}'), '{"role": "user"}')


class TestSummarizeArgs(unittest.TestCase):
    def test_points_collapse_to_counts(self):
        out = summarize_args("chalkboard_draw_chalk", {
            "points": [{"x": 1, "y": 2}] * 40, "color": "#fff"})
        self.assertEqual(out["points"], "[40 points]")
        self.assertEqual(out["color"], "#fff")

    def test_long_strings_truncate(self):
        out = summarize_args("chalkboard_send_chat", {"message": "x" * 200})
        self.assertTrue(out["message"].endswith("..."))
        self.assertEqual(len(out["message"]), 83)


class TestNodeCallerTrace(unittest.TestCase):
    def test_records_trace_and_stats_against_stub_node(self):
        import json
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                seen.append(json.loads(self.rfile.read(length) or b"{}"))
                body = json.dumps({"ok": True, "result": {"ok": True}}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            caller = NodeCaller(f"http://127.0.0.1:{server.server_port}",
                                "s3cret", "room-1", "instructor", "req-1")
            caller("chalkboard_insert_shape", {"shape": "circle", "x": 0, "y": 0})
            caller("chalkboard_send_chat", {"message": "done"})
        finally:
            server.shutdown()

        self.assertEqual(caller.tool_calls, 2)
        self.assertTrue(caller.chat_sent)
        self.assertEqual([t["tool"] for t in caller.trace],
                         ["chalkboard_insert_shape", "chalkboard_send_chat"])
        self.assertEqual(caller.trace[0]["args"]["shape"], "circle")
        # Payload contract Node expects
        self.assertEqual(seen[0]["roomId"], "room-1")
        self.assertEqual(seen[0]["invokerRole"], "instructor")
        self.assertEqual(seen[0]["requestId"], "req-1")


class TestRoutes(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["tools"], 18)

    def test_run_rejects_without_secret(self):
        res = self.client.post("/run", json={"message": "hi", "roomId": "r"})
        self.assertEqual(res.status_code, 401)

    def test_transcribe_rejects_without_secret(self):
        res = self.client.post("/transcribe", json={"wavBase64": ""})
        self.assertEqual(res.status_code, 401)


if __name__ == "__main__":
    unittest.main()
