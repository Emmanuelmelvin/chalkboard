"""Sanitize + layout + activity + providers unit tests (offline)."""

import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.activity import extract_cursor_position, format_tool_activity
from agent.layout import analyze_canvas_layout, format_spatial_layout_prompt
from agent.providers import DirectCaller, get_instruction
from agent.sanitize import sanitize_chat_message, strip_narration
from agent.session import RoomSession
from errors import AgentError
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


def test_model_policy_contains_no_runtime_templates():
    instruction = get_instruction()
    assert "{" not in instruction and "}" not in instruction
    assert "registered function tools" in instruction


def test_voice_wake():
    assert is_agent_addressed("hey master, draw a circle")
    assert is_agent_addressed("ok ai explain this")
    assert not is_agent_addressed("hello everyone")
    assert VOICE_WAKE_PATTERN.search("computer, help me")


def test_unresolved_or_display_name_only_user_is_viewer():
    session = RoomSession.__new__(RoomSession)
    session.socket = type("Socket", (), {"context": {
        "roomMetadata": {"ownerId": "owner-1", "defaultRole": "instructor"},
        "members": {"owner-socket": {"id": "owner-socket", "userId": "owner-1",
                                     "name": "Teacher", "role": "owner"}},
        "persistedMembers": [],
    }})()
    # Display names are mutable/non-unique and must never confer owner rights.
    assert session._resolve_role({"userId": "unknown", "displayName": "Teacher"}) == "viewer"
    assert session._resolve_role({"userId": "owner-1", "displayName": "Anyone"}) == "owner"


def test_cancelled_task_cannot_invoke_a_tool():
    cancelled = threading.Event()
    cancelled.set()
    caller = DirectCaller({"cancelEvent": cancelled}, {})
    with pytest.raises(AgentError, match="stopped"):
        caller("chalkboard_send_chat", {"message": "should not send"})
