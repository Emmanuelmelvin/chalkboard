"""Sanitize + layout + activity + providers unit tests (offline)."""

import sys
import threading
import time
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


def test_final_delivery_uses_exactly_one_approved_channel():
    class Socket:
        def __init__(self):
            self.messages = []

        def send_chat_message(self, message):
            self.messages.append(message)
            return True

    class Voice:
        can_speak = False

    session = RoomSession.__new__(RoomSession)
    session.room_id = "room-1"
    session.socket = Socket()
    session.voice = Voice()
    assert session._deliver_final_response("Fractions split a whole into equal parts.",
                                           {"chatDelivered": False}, "chat", "Learner") == "chat"
    assert session.socket.messages == ["Fractions split a whole into equal parts."]
    assert session._deliver_final_response("This must not be duplicated.",
                                           {"chatDelivered": True}, "chat", "Learner") == "chat-tool"
    assert len(session.socket.messages) == 1


def test_enqueue_does_not_block_on_context_lock():
    """Regression: invocations ran on the socket dispatch thread while that
    thread held socket.context_lock (@_with_context_lock). enqueue_reasoning_task
    then blocked on task completion, so the pump could never acquire the lock
    it needs to build the prompt — every invocation timed out after
    REASONING_TIMEOUT_S + 30 with 'Reasoning task timed out'."""
    class Socket:
        context = {}

        def __init__(self):
            self.context_lock = threading.RLock()

    session = RoomSession.__new__(RoomSession)
    session.room_id = "room-1"
    session.socket = Socket()
    session._lock = threading.Lock()
    session._queue = []
    session._processing = False
    session._active_task = None
    session._stopped = False
    session._gc_timer = None
    session.state = "IDLE_OBSERVING"
    session.tasks_completed = 0
    session.tasks_failed = 0
    session.total_turns = 0
    session.current_model = ""
    session.last_task_at = None
    session.lesson_history = []
    session._persist_memory = lambda entry: None

    reasoning_reached_lock = threading.Event()

    async def fake_reasoning(*args, **kwargs):
        # _build_prompt and every board tool acquire socket.context_lock.
        with session.socket.context_lock:
            reasoning_reached_lock.set()
        return {"success": True, "turns": 1}

    session._run_reasoning = fake_reasoning

    lock = session.socket.context_lock
    lock.acquire()
    try:
        started = time.monotonic()
        result = session.enqueue_reasoning_task("draw a circle", "Tester")
        elapsed = time.monotonic() - started
    finally:
        lock.release()
    assert result.get("queued") is True
    assert elapsed < 5.0, (
        f"enqueue blocked the caller for {elapsed:.1f}s while context_lock was "
        "held — the socket-thread deadlock is back")
    assert reasoning_reached_lock.wait(10), "pump never reached the reasoning task"
