"""Unit tests for agent-brain. No network/AWS calls — all offline."""

import sys
import unittest

sys.path.insert(0, ".")

from app import app
from master import build_agent, neutralize_templates
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
