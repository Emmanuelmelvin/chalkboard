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
    def __init__(self):
        self.glides = []

    def should_broadcast(self, tool):
        return tool in ("chalkboard_draw_chalk", "chalkboard_write_text")

    def start_parallel_tool_cursor(self, tool, args):
        pass

    def glide_to(self, x, y, a=4, b=15):
        pass

    def glide_to_blocking(self, x, y, steps=None, interval_ms=None):
        self.glides.append((x, y))

    def trace_path_blocking(self, points, on_ink=None):
        return [p for p in points if isinstance(p, dict)]

    def hold(self, duration_ms=120):
        pass

    def cancel_active_stream(self):
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


def test_move_cursor_broadcasts_exact_canvas_position():
    sock = FakeSocket()
    positions = []
    sock.broadcast_cursor = lambda x, y=None: positions.append((x, y))
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_move_cursor", {"x": -120, "y": 45})
    assert res.get("isError") is None
    assert positions[-1] == (-120, 45)


def test_chunked_write_text():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_write_text",
                         {"text": "one two three four five", "x": 0, "y": 0})
    text = res["content"][0]["text"]
    assert "originalText" in text
    assert len(sock.context["strokes"]) >= 3


def test_respond_records_final_answer_without_sending():
    """chalkboard_respond is the structured final-answer channel: the message
    is recorded for once-only delivery and never sent to chat directly."""
    sock = FakeSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_respond",
                         {"message": "The board is currently empty."})
    assert res.get("isError") is None
    assert stats["finalAnswer"] == "The board is currently empty."
    assert sock.chats == []


def test_visual_request_cannot_be_claimed_complete_without_canvas_success():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    ctx = {**_ctx(sock), "requiresCanvasMutation": True}
    res = run_board_tool(ctx, stats, "chalkboard_respond", {"message": "Triangle drawn on the board."})
    assert res.get("isError") is True
    assert stats["finalAnswer"] is None


def test_visual_request_cannot_bypass_completion_gate_through_chat():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    ctx = {**_ctx(sock), "requiresCanvasMutation": True}
    res = run_board_tool(ctx, stats, "chalkboard_send_chat", {"message": "Triangle drawn on the board."})
    assert res.get("isError") is True
    assert sock.chats == []


def test_visual_request_can_respond_after_canvas_success():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    ctx = {**_ctx(sock), "requiresCanvasMutation": True}
    draw = run_board_tool(ctx, stats, "chalkboard_insert_shape", {"shape": "triangle", "x": 0, "y": 0})
    assert draw.get("isError") is None
    assert stats["canvasMutationSucceeded"] is True
    response = run_board_tool(ctx, stats, "chalkboard_respond", {"message": "Triangle drawn on the board."})
    assert response.get("isError") is None


def test_unspecified_agent_shapes_are_placed_in_clear_space():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    ctx = _ctx(sock)
    first = run_board_tool(ctx, stats, "chalkboard_insert_shape", {"shape": "triangle"})
    second = run_board_tool(ctx, stats, "chalkboard_insert_shape", {"shape": "rectangle"})
    assert first.get("isError") is None and second.get("isError") is None
    first_max_x = max(point["x"] for point in sock.context["strokes"][0]["points"])
    second_min_x = min(point["x"] for point in sock.context["strokes"][1]["points"])
    assert second_min_x > first_max_x


def test_respond_narration_only_rejected():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_respond",
                         {"message": "I can confirm this information to the requester."})
    assert res.get("isError") is True
    assert not stats["finalAnswer"]


def test_respond_duplicate_rejected():
    sock = FakeSocket()
    stats = create_board_tool_stats()
    run_board_tool(_ctx(sock), stats, "chalkboard_respond", {"message": "First answer."})
    res = run_board_tool(_ctx(sock), stats, "chalkboard_respond", {"message": "Second answer."})
    assert res.get("isError") is True
    assert stats["finalAnswer"] == "First answer."
