"""Board runner + executors with a fake socket (offline)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.board_runner import create_board_tool_stats, run_board_tool


class FakeSocket:
    room_id = "room1"
    socket_id = "sid1"

    def __init__(self):
        self.context = {"strokes": [], "links": [], "chat": [], "members": {},
                        "strokeCount": 0, "lastActivityAt": 0}
        self.activities = []
        self.chats = []
        self.voice = None

    def broadcast_activity(self, payload):
        self.activities.append(payload)

    def broadcast_cursor(self, x, y=None):
        pass

    def emit_with_ack(self, event, payload, timeout_s=8):
        return {"ok": True}

    def send_chat_message(self, text):
        self.chats.append(text)
        return True


class FakeCursor:
    def should_broadcast(self, tool):
        return tool in ("chalkboard_draw_chalk", "chalkboard_write_text")

    def start_parallel_tool_cursor(self, tool, args):
        pass

    def glide_to(self, x, y, a=4, b=15):
        pass


def _ctx(sock, role="instructor"):
    return {"socket": sock, "cursorStreamer": FakeCursor(), "invokerRole": role,
            "requestId": "t1", "maxTurns": 15}


def test_send_chat_marks_stats_and_sends():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_send_chat", {"message": "Hello class"})
    assert stats["chatSent"] is True
    assert sock.chats == ["Hello class"]
    assert res["content"][0]["text"]


def test_narration_only_chat_blocked():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_send_chat",
                         {"message": "I should respond directly in the chat."})
    assert res.get("isError") is True
    assert sock.chats == []


def test_viewer_draw_forbidden():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock, "viewer"), stats, "chalkboard_draw_chalk",
                         {"points": [{"x": 0, "y": 0}]})
    assert res.get("isError") is True


def test_chunked_write_text():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_write_text",
                         {"text": "one two three four five", "x": 0, "y": 0})
    text = res["content"][0]["text"]
    assert "originalText" in text
    assert len(sock.context["strokes"]) >= 3
