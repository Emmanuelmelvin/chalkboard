"""Sanitize + layout + activity + providers unit tests (offline)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.activity import extract_cursor_position, format_tool_activity
from agent.layout import analyze_canvas_layout, format_spatial_layout_prompt
from agent.providers import neutralize_templates
from agent.sanitize import sanitize_chat_message, strip_narration
from voice.transcriber import VOICE_WAKE_PATTERN, is_agent_addressed


def test_sanitize_rejects_json_and_traceback():
    assert sanitize_chat_message('{"foo": 1}') is None
    assert sanitize_chat_message('Traceback blah') is None
    assert sanitize_chat_message('  Hello class  ') == 'Hello class'


def test_strip_narration_removes_meta():
    out = strip_narration("The user is asking about fractions. The answer is one half.")
    assert out is not None and "one half" in out and "is asking" not in out
    assert strip_narration("I should respond directly in the chat.") is None


def test_layout_empty_and_occupied():
    assert analyze_canvas_layout([])["bounds"] is None
    assert "Clean/Empty" in format_spatial_layout_prompt([])
    strokes = [{"points": [{"x": 0, "y": 0}, {"x": 100, "y": 50}]}]
    text = format_spatial_layout_prompt(strokes)
    assert "Occupied Bounds" in text and "Below existing content" in text


def test_activity_and_cursor_extract():
    act = format_tool_activity("chalkboard_draw_chalk", {"points": [{"x": 1, "y": 2}] * 5})
    assert "Drawing" in act["toolAction"]
    assert extract_cursor_position("chalkboard_write_text", {"x": 10, "y": 20}) == {"x": 10, "y": 20}
    assert extract_cursor_position("chalkboard_send_chat", {"message": "hi"}) is None


def test_neutralize_templates():
    assert neutralize_templates('Room "{ROOM_TITLE}" ok') == 'Room "[ROOM_TITLE]" ok'
    assert neutralize_templates('no braces') == 'no braces'


def test_voice_wake():
    assert is_agent_addressed("hey master, draw a circle")
    assert is_agent_addressed("ok ai explain this")
    assert not is_agent_addressed("hello everyone")
    assert VOICE_WAKE_PATTERN.search("computer, help me")
