"""Board runner + executors with a fake socket (offline)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.board_runner import create_board_tool_stats, run_board_tool

# Hard-coded on purpose: importing the service's own constants would make a
# regression surface as a collection/ImportError instead of a failing
# assertion, and NOTES_PLUGIN_ID would still pass if both sides drifted from
# the frontend together. MIRROR_CAP is asserted against the real limit in
# test_mirror_cap_matches_service.
NOTES_PLUGIN_ID = "chalkboard.notes"
MIRROR_CAP = 500
HISTORY_BYTE_CAP = 768 * 1024


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

    def trace_path_blocking(self, points, on_ink=None, progress=None):
        if progress is not None:
            progress["completed"] = True
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


# --- full-history payload contract -------------------------------------------
# undo-stroke replaces the ENTIRE board history and every stroke in it is
# validated against the backend stroke schema, which uses zod .optional() —
# NOT .nullish(). One explicit null anywhere in the array rejects the whole
# payload as invalid_payload, so undo/delete/change_color/nudge silently fail
# in any room that has synced strokes from the server.

_HISTORY_MUTATIONS = [
    ("chalkboard_clear_or_undo", {"action": "undo"}),
    ("chalkboard_select_and_transform", {"action": "delete", "strokeIds": ["srv-0"]}),
    ("chalkboard_select_and_transform", {"action": "change_color", "strokeIds": ["srv-0"], "color": "#ff0000"}),
    ("chalkboard_select_and_transform", {"action": "nudge", "strokeIds": ["srv-0"], "dx": 10, "dy": 5}),
]


class RecordingSocket(FakeSocket):
    def __init__(self):
        super().__init__()
        self.emitted = []

    def emit_with_ack(self, event, payload, timeout_s=8):
        self.emitted.append((event, payload))
        return {"ok": True}


def _server_strokes():
    """Strokes exactly as the in-memory mirror holds them after room-history."""
    from agent.socket_client import normalize_full_stroke
    return [normalize_full_stroke({
        "id": f"srv-{i}", "userId": "human", "tool": "chalk", "color": "#ffffff",
        "size": 4, "points": [{"x": i, "y": i}, {"x": i + 5, "y": i + 5}],
    }) for i in range(3)]


def test_normalized_server_strokes_carry_no_nulls():
    for stroke in _server_strokes():
        nulls = [key for key, value in stroke.items() if value is None]
        assert nulls == [], f"normalize_full_stroke emitted nulls: {nulls}"


@pytest.mark.parametrize("tool_name,args", _HISTORY_MUTATIONS)
def test_history_mutations_never_emit_null_optionals(tool_name, args):
    sock = RecordingSocket()
    sock.context["strokes"] = _server_strokes()
    run_board_tool(_ctx(sock), create_board_tool_stats(), tool_name, args)
    history = [payload for event, payload in sock.emitted if event == "undo-stroke"]
    assert history, f"{tool_name}/{args['action']} emitted no undo-stroke"
    for payload in history:
        for stroke in payload["strokes"]:
            nulls = sorted(key for key, value in stroke.items() if value is None)
            assert nulls == [], (
                f"{args['action']} would be rejected as invalid_payload — "
                f"null optionals in payload: {nulls}")


@pytest.mark.parametrize("tool_name,args", _HISTORY_MUTATIONS)
def test_history_mutations_keep_required_stroke_fields(tool_name, args):
    """Null-stripping must not drop the fields the backend requires."""
    sock = RecordingSocket()
    sock.context["strokes"] = _server_strokes()
    run_board_tool(_ctx(sock), create_board_tool_stats(), tool_name, args)
    for event, payload in sock.emitted:
        if event != "undo-stroke":
            continue
        for stroke in payload["strokes"]:
            assert {"id", "tool", "color", "size", "points"} <= set(stroke)
            assert stroke["points"], "stroke lost its points"


def test_nudge_offsets_only_targeted_strokes():
    sock = RecordingSocket()
    sock.context["strokes"] = _server_strokes()
    run_board_tool(_ctx(sock), create_board_tool_stats(), "chalkboard_select_and_transform",
                   {"action": "nudge", "strokeIds": ["srv-0"], "dx": 10, "dy": 5})
    strokes = {s["id"]: s for s in sock.emitted[-1][1]["strokes"]}
    assert strokes["srv-0"]["points"][0] == {"x": 10, "y": 5}
    assert strokes["srv-1"]["points"][0] == {"x": 1, "y": 1}


def test_history_payload_is_sanitized_whatever_the_mirror_holds():
    """Second line of defence, independent of normalize_full_stroke: whatever
    lands in the stroke mirror, the emitted history must satisfy the backend
    schema — no nulls, no point-less strokes."""
    sock = RecordingSocket()
    sock.context["strokes"] = [
        {"id": "dirty", "tool": "chalk", "color": "#fff", "size": 4, "closed": None,
         "fillColor": None, "text": None, "objectType": None,
         "points": [{"x": 0, "y": 0}, {"x": 9, "y": 9}]},
        {"id": "keep", "tool": "chalk", "color": "#fff", "size": 4,
         "points": [{"x": 1, "y": 1}, {"x": 2, "y": 2}]},
        {"id": "unrenderable", "tool": "chalk", "color": "#fff", "size": 4,
         "points": [{"x": float("inf"), "y": 0}]},
    ]
    run_board_tool(_ctx(sock), create_board_tool_stats(),
                   "chalkboard_select_and_transform", {"action": "delete", "strokeIds": ["keep"]})
    payload = sock.emitted[-1][1]["strokes"]
    assert [s["id"] for s in payload] == ["dirty"], "point-less strokes must be dropped"
    assert [k for s in payload for k, v in s.items() if v is None] == []


# --- data loss: full-history rewrites on a partial mirror --------------------
# undo-stroke REPLACES the server's history with what we send. The mirror is
# capped, so on a board bigger than the cap the payload is missing the oldest
# strokes and sending it deletes them permanently.

_DESTRUCTIVE = [
    ("chalkboard_clear_or_undo", {"action": "undo"}, "undo"),
    ("chalkboard_select_and_transform", {"action": "delete", "strokeIds": ["srv-600"]}, "delete"),
    ("chalkboard_select_and_transform", {"action": "change_color", "strokeIds": ["srv-600"], "color": "#f00"}, "colour"),
    ("chalkboard_select_and_transform", {"action": "nudge", "strokeIds": ["srv-600"], "dx": 5, "dy": 5}, "nudge"),
]


def _oversized_room_socket():
    """A socket whose mirror has dropped strokes, as after a 600-stroke sync."""
    sock = RecordingSocket()
    total = MIRROR_CAP + 100
    sock.context["strokes"] = [{
        "id": f"srv-{i}", "userId": "human", "tool": "chalk", "color": "#ffffff", "size": 4,
        "points": [{"x": i, "y": i}, {"x": i + 1, "y": i + 1}],
    } for i in range(total - MIRROR_CAP, total)]
    sock.context["strokeCount"] = total
    sock.context["historyComplete"] = False
    return sock


@pytest.mark.parametrize("tool_name,args,label", _DESTRUCTIVE)
def test_partial_mirror_refuses_to_rewrite_history(tool_name, args, label):
    sock = _oversized_room_socket()
    res = run_board_tool(_ctx(sock), create_board_tool_stats(), tool_name, args)
    assert res.get("isError") is True, f"{label} silently rewrote a partial history"
    assert not [e for e in sock.emitted if e[0] == "undo-stroke"], (
        f"{label} emitted a truncated history — strokes the agent cannot see would be deleted")
    assert "permanently delete" in res["content"][0]["text"]


def test_complete_mirror_still_allows_history_rewrites():
    """The guard must not disable undo on ordinary boards."""
    sock = RecordingSocket()
    sock.context["strokes"] = _server_strokes()
    sock.context["historyComplete"] = True
    res = run_board_tool(_ctx(sock), create_board_tool_stats(),
                         "chalkboard_clear_or_undo", {"action": "undo"})
    assert res.get("isError") is None
    assert [e[0] for e in sock.emitted] == ["undo-stroke"]


def test_duplicate_still_works_on_a_partial_mirror():
    """duplicate only appends, so a partial mirror cannot cause data loss."""
    sock = _oversized_room_socket()
    target = sock.context["strokes"][-1]["id"]
    res = run_board_tool(_ctx(sock), create_board_tool_stats(),
                         "chalkboard_select_and_transform",
                         {"action": "duplicate", "strokeIds": [target]})
    assert res.get("isError") is None
    assert [e[0] for e in sock.emitted] == ["draw-stroke"]


def test_oversized_history_is_refused_before_emitting():
    """Over maxHistoryBytes the backend rejects the whole array, so emitting is
    pointless — and a failed rewrite must never look like a successful one."""
    sock = RecordingSocket()
    sock.context["historyComplete"] = True
    sock.context["strokes"] = [{
        "id": f"big-{i}", "userId": "human", "tool": "chalk", "color": "#ffffff", "size": 4,
        "points": [{"x": i + j, "y": i - j} for j in range(60)],
    } for i in range(900)]
    res = run_board_tool(_ctx(sock), create_board_tool_stats(),
                         "chalkboard_clear_or_undo", {"action": "undo"})
    assert res.get("isError") is True
    assert not [e for e in sock.emitted if e[0] == "undo-stroke"]
    assert f"{HISTORY_BYTE_CAP // 1024} KiB" in res["content"][0]["text"]


def test_mirror_cap_matches_service():
    """Guards the constants these tests hard-code against silent drift."""
    import agent.socket_client as sc
    import tools.executors as ex
    assert getattr(sc, "MIRROR_STROKE_LIMIT", None) == MIRROR_CAP
    assert getattr(ex, "HISTORY_MAX_BYTES", None) == HISTORY_BYTE_CAP
    assert getattr(ex, "NOTES_PLUGIN_ID", None) == NOTES_PLUGIN_ID


def test_mirror_marks_itself_incomplete_when_it_drops_strokes():
    from agent.socket_client import AgentRoomSocket
    sock = AgentRoomSocket("room-cap")
    assert sock.context.get("historyComplete") is True
    sock._on_room_history([{
        "id": f"srv-{i}", "userId": "u", "tool": "chalk", "color": "#fff", "size": 4,
        "points": [{"x": i, "y": i}, {"x": i + 1, "y": i + 1}],
    } for i in range(MIRROR_CAP + 100)])
    assert len(sock.context["strokes"]) == MIRROR_CAP
    assert sock.context["strokeCount"] == MIRROR_CAP + 100
    assert sock.context.get("historyComplete") is False, (
        "mirror dropped strokes without recording it — undo would delete them")


def test_mirror_stays_complete_within_the_cap_and_resets_on_clear():
    from agent.socket_client import AgentRoomSocket
    sock = AgentRoomSocket("room-cap2")
    sock._on_room_history([{
        "id": f"srv-{i}", "userId": "u", "tool": "chalk", "color": "#fff", "size": 4,
        "points": [{"x": i, "y": i}, {"x": i + 1, "y": i + 1}],
    } for i in range(10)])
    assert sock.context.get("historyComplete") is True
    sock.context["historyComplete"] = False
    sock._on_clear()
    assert sock.context.get("historyComplete") is True, "a cleared board is fully known again"


# --- notes -------------------------------------------------------------------

def test_created_note_is_tagged_for_the_notes_layer():
    """The canvas renderer skips any stroke with noteHtml, and NotesLayer only
    renders strokes whose pluginId matches the notes plugin manifest id. Without
    that tag the note is persisted but drawn nowhere, while the tool still
    reports success."""
    sock = FakeSocket()
    res = run_board_tool(_ctx(sock), create_board_tool_stats(), "chalkboard_create_note",
                         {"content": "<b>Recap</b>", "x": 40, "y": 60})
    assert res.get("isError") is None
    note = sock.context["strokes"][-1]
    assert note["pluginId"] == "chalkboard.notes"
    assert note["objectType"] == "note"
    assert note["noteHtml"] == "<b>Recap</b>"


def test_note_plugin_id_matches_frontend_manifest():
    manifest = (Path(__file__).resolve().parents[2]
                / "frontend/src/plugins/builtin/notes/manifest.ts").read_text(encoding="utf-8")
    assert f"id: '{NOTES_PLUGIN_ID}'" in manifest, (
        "notes plugin id drifted from the frontend manifest — agent notes will stop rendering")


def test_note_requires_content():
    sock = FakeSocket()
    res = run_board_tool(_ctx(sock), create_board_tool_stats(), "chalkboard_create_note",
                         {"content": "   ", "x": 0, "y": 0})
    assert res.get("isError") is True
    assert sock.context["strokes"] == []
