"""Cursor engine + pen-synced board tools (offline, fake sockets).

Covers:
- distance-aware glide/trace durations
- cursor follows the ACTUAL ink path (lockstep with stroke-draw)
- event sequence: stroke-start -> stroke-draw* -> draw-stroke
- cancellation keeps partial ink and never leaves a stuck pen state
- viewer role cannot trigger pen-synced drawing
"""

import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from agent.board_runner import create_board_tool_stats, run_board_tool
from agent.cursor import (
    DRAW_MAX_MS,
    DRAW_MIN_MS,
    GLIDE_MAX_MS,
    GLIDE_MIN_MS,
    ParallelCursorStreamer,
    draw_duration_ms,
    glide_duration_ms,
)


class FakeSio:
    def __init__(self):
        self.emits = []

    def emit(self, event, payload=None):
        self.emits.append((event, payload))


class PenSocket:
    """Fake room socket recording every emitted event (offline)."""

    room_id = "room1"
    socket_id = "sid1"

    def __init__(self):
        self.context = {"strokes": [], "links": [], "chat": [], "members": {},
                        "strokeCount": 0, "lastActivityAt": 0}
        self.activities = []
        self.chats = []
        self.cursor_positions = []
        self.sio = FakeSio()
        self.context_lock = threading.Lock()

    def broadcast_activity(self, payload):
        self.activities.append(payload)

    def broadcast_cursor(self, x, y=None):
        self.cursor_positions.append(None if x is None else (x, y))

    def emit_with_ack(self, event, payload, timeout_s=8):
        self.sio.emits.append((event, payload))
        return {"ok": True}

    def send_chat_message(self, text):
        self.chats.append(text)
        return True


@pytest.fixture(autouse=True)
def fast_cursor(monkeypatch):
    """Keep animation real but 8x faster so tests stay snappy."""
    monkeypatch.setenv("CURSOR_SPEED", "8")


def _ctx(sock, role="instructor"):
    return {"socket": sock, "cursorStreamer": ParallelCursorStreamer(sock),
            "invokerRole": role, "requestId": "t1", "maxTurns": 15}


def _on_path(p, pts, eps=0.51):
    """True if point p lies on the polyline through pts."""
    for a, b in zip(pts, pts[1:]):
        cross = (b["x"] - a["x"]) * (p[1] - a["y"]) - (b["y"] - a["y"]) * (p[0] - a["x"])
        if abs(cross) > eps:
            continue
        dot = (p[0] - a["x"]) * (b["x"] - a["x"]) + (p[1] - a["y"]) * (b["y"] - a["y"])
        length2 = (b["x"] - a["x"]) ** 2 + (b["y"] - a["y"]) ** 2
        if -eps <= dot <= length2 + eps:
            return True
    return False


# --- duration model --------------------------------------------------------

def test_glide_duration_is_distance_aware(monkeypatch):
    monkeypatch.setenv("CURSOR_SPEED", "1")  # compare against raw constant bounds
    short, mid, long_ = glide_duration_ms(10), glide_duration_ms(400), glide_duration_ms(10_000)
    assert 0 < short <= mid <= long_
    assert short >= GLIDE_MIN_MS - 1  # not faster than the floor
    assert long_ <= GLIDE_MAX_MS + 1  # clamped, never excessively slow


def test_draw_duration_is_distance_aware(monkeypatch):
    monkeypatch.setenv("CURSOR_SPEED", "1")
    short, long_ = draw_duration_ms(50), draw_duration_ms(50_000)
    assert 0 < short < long_
    assert short >= DRAW_MIN_MS - 1
    assert long_ <= DRAW_MAX_MS + 1


# --- glide ------------------------------------------------------------------

def test_glide_broadcast_count_scales_with_distance():
    sock = PenSocket()
    streamer = ParallelCursorStreamer(sock)
    streamer.set_position(0, 0)
    before = len(sock.cursor_positions)
    streamer.glide_to_blocking(10, 0)
    short_hops = len(sock.cursor_positions) - before
    before = len(sock.cursor_positions)
    streamer.glide_to_blocking(10, 800)
    long_hops = len(sock.cursor_positions) - before
    assert long_hops > short_hops  # distance-aware, not a fixed step count
    assert sock.cursor_positions[-1] == (10, 800)  # exact arrival


def test_glide_deviates_from_straight_line_but_arrives_exactly():
    sock = PenSocket()
    streamer = ParallelCursorStreamer(sock)
    streamer.set_position(0, 0)
    streamer.glide_to_blocking(600, 0)
    path = [p for p in sock.cursor_positions if p is not None]
    assert path[-1] == (600, 0)
    deviations = [abs(p[1]) for p in path]
    assert max(deviations) > 0  # subtle human-like curvature, not a ruler line
    assert max(deviations) <= 60 + 1  # ...but never wanders far off-course


# --- ink tracing ------------------------------------------------------------

def test_trace_follows_actual_path_and_fires_ink_in_lockstep():
    sock = PenSocket()
    streamer = ParallelCursorStreamer(sock)
    streamer.set_position(0, 0)
    pts = [{"x": 0, "y": 0}, {"x": 300, "y": 0}, {"x": 300, "y": 300}]
    ink = []
    traced = streamer.trace_path_blocking(pts, on_ink=lambda x, y: ink.append((x, y)))
    assert traced and traced[-1] == {"x": 300, "y": 300}
    assert len(ink) >= 2  # ink is broadcast during the action, not only at the end
    for x, y in ink:
        assert _on_path((x, y), pts)  # every ink packet is ON the stroke path
    for pos in sock.cursor_positions:
        assert pos is not None and _on_path(pos, pts)  # cursor never leaves the ink


def test_trace_paces_by_path_length_not_point_count():
    sock = PenSocket()
    streamer = ParallelCursorStreamer(sock)
    streamer.set_position(0, 0)
    short = streamer.trace_path_blocking([{"x": 0, "y": 0}, {"x": 50, "y": 0}])
    assert short
    sock.cursor_positions.clear()
    long_pts = [{"x": i * 10, "y": 0} for i in range(100)]  # 990 units
    long_ = streamer.trace_path_blocking(long_pts)
    assert long_
    assert len(sock.cursor_positions) > 4  # long path gets proportionally more updates


def test_trace_cancellation_keeps_partial_ink_and_recovers():
    sock = PenSocket()
    streamer = ParallelCursorStreamer(sock)
    streamer.set_position(0, 0)
    pts = [{"x": i * 10, "y": 0} for i in range(120)]  # ~1190 units
    result = {}

    def run():
        result["traced"] = streamer.trace_path_blocking(pts)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    time.sleep(0.03)
    streamer.cancel_active_stream()
    thread.join(timeout=5)
    assert not thread.is_alive()  # no leaked animation
    traced = result.get("traced") or []
    assert 0 < len(traced) < len(pts)  # partial ink, not the full path
    assert all(_on_path((p["x"], p["y"]), pts) for p in traced)
    # Recovery: a new movement works and lands exactly (no stuck pen state).
    streamer.glide_to_blocking(0, 0)
    assert sock.cursor_positions[-1] == (0, 0)


# --- pen-synced board tools ---------------------------------------------------

def test_draw_event_sequence_is_pen_synced():
    sock = PenSocket()
    stats = create_board_tool_stats()
    pts = [{"x": 0, "y": 0}, {"x": 300, "y": 0}, {"x": 300, "y": 300}]
    res = run_board_tool(_ctx(sock), stats, "chalkboard_draw_chalk",
                         {"points": pts, "color": "#ffffff"})
    assert res.get("isError") is None
    events = sock.sio.emits
    assert events, "no events emitted"
    assert events[0][0] == "stroke-start"  # pen down before any ink
    assert events[0][1]["startPoint"] == {"x": 0, "y": 0}
    draws = [e for e in events if e[0] == "stroke-draw"]
    assert len(draws) >= 2  # ink streamed DURING the movement
    for _, payload in draws:
        assert _on_path((payload["point"]["x"], payload["point"]["y"]), pts)
    assert events[-1][0] == "draw-stroke"  # pen up persists the full stroke
    persisted = events[-1][1]["stroke"]["points"]
    assert persisted[0] == {"x": 0, "y": 0}  # exact start preserved
    assert persisted[-1] == {"x": 300, "y": 300}  # exact endpoint preserved
    assert len(persisted) >= len(pts)  # continuously traced, not just the vertices
    for p in persisted:
        assert _on_path((p["x"], p["y"]), pts)  # ink matches the cursor path
    assert sock.context["strokes"][-1]["points"] == persisted
    # Cursor was broadcast during the action too (>= one per ink packet).
    assert len(sock.cursor_positions) >= len(draws)


def test_shape_event_sequence_has_stroke_per_outline():
    sock = PenSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_insert_shape",
                         {"shape": "arrow", "x": 0, "y": 0})
    assert res.get("isError") is None
    events = sock.sio.emits
    starts = [e for e in events if e[0] == "stroke-start"]
    persists = [e for e in events if e[0] == "draw-stroke"]
    assert len(starts) == len(persists) == 2  # shaft + head, each pen-synced
    assert starts[0][1]["startPoint"] == persists[0][1]["stroke"]["points"][0]


def test_highlight_traces_rectangle_outline():
    sock = PenSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock), stats, "chalkboard_highlight_area",
                         {"minX": 0, "minY": 0, "maxX": 400, "maxY": 200})
    assert res.get("isError") is None
    events = sock.sio.emits
    assert events[0][0] == "stroke-start"
    draws = [e for e in events if e[0] == "stroke-draw"]
    assert len(draws) >= 2
    box = [{"x": 0, "y": 0}, {"x": 400, "y": 0}, {"x": 400, "y": 200},
           {"x": 0, "y": 200}, {"x": 0, "y": 0}]
    for _, payload in draws:
        assert _on_path((payload["point"]["x"], payload["point"]["y"]), box)


def test_viewer_draw_forbidden_no_pen_events():
    sock = PenSocket()
    stats = create_board_tool_stats()
    res = run_board_tool(_ctx(sock, "viewer"), stats, "chalkboard_draw_chalk",
                         {"points": [{"x": 0, "y": 0}, {"x": 10, "y": 10}]})
    assert res.get("isError") is True
    assert sock.sio.emits == []  # no stroke-start / stroke-draw for viewers
    assert sock.context["strokes"] == []


def test_partial_trace_persists_partial_ink_without_stuck_state():
    """Simulates a cancelled action: trace returns only the ink drawn so far,
    and the pen-up persist still completes with a valid stroke."""
    from agent.board_runner import _pen_synced_strokes

    class PartialCursor:
        def glide_to_blocking(self, x, y, steps=None, interval_ms=None):
            pass

        def trace_path_blocking(self, pts, on_ink=None):
            return [{"x": 5, "y": 0}]  # cancellation hit after one tick

        def hold(self, duration_ms=120):
            pass

    sock = PenSocket()
    stroke = {"id": "s1", "tool": "chalk", "color": "#fff", "size": 4,
              "points": [{"x": 0, "y": 0}, {"x": 300, "y": 0}]}
    delivered = _pen_synced_strokes({"socket": sock, "cursorStreamer": PartialCursor()}, [stroke])
    assert delivered == ["s1"]
    persisted = sock.context["strokes"][-1]["points"]
    assert persisted == [{"x": 5, "y": 0}]  # partial ink persisted (mouse up done)
    assert any(e[0] == "draw-stroke" for e in sock.sio.emits)


