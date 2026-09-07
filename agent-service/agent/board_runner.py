"""Single board-tool UX path (mirrors src/agent/boardToolRunner.ts).

Used by BOTH providers: Gemini and Bedrock tool closures call run_board_tool
directly in-process — no HTTP hop, identical cursor/activity/RBAC behavior.

Every canvas action owns a cursor trajectory derived from the SAME canonical
canvas coordinates as the action itself: the pen glides to the stroke start
(pen up), the stroke goes live (pen down), and the cursor traces the actual
ink path while stroke-draw packets are emitted on the same ticks the cursor
is broadcast. The final draw-stroke (persist + full-stroke relay) is the
pen-up. Receivers therefore see ink appear exactly under the cursor.
"""

from __future__ import annotations

import json
import time
from typing import Any

from agent.activity import format_tool_activity
from agent.cursor import CHUNK_PAUSE_MS, GLIDE_HOLD_MS, stroke_gap_s
from agent.sanitize import sanitize_chat_message, strip_narration
from logger import logger
from tools.executors import (
    append_stroke_locked,
    build_chalk_stroke,
    build_highlight_stroke,
    build_shape_strokes,
    can_invoker,
    execute_tool,
    valid_points,
)


def create_board_tool_stats() -> dict:
    return {"toolCalls": 0, "chatSent": False, "chatDelivered": False,
            "voiceDelivered": False, "finalAnswer": None}


def run_board_tool(ctx: dict, stats: dict, tool_name: str, raw_args: Any) -> Any:
    args = dict(raw_args) if isinstance(raw_args, dict) else {}
    stats["toolCalls"] = stats.get("toolCalls", 0) + 1
    socket = ctx["socket"]
    cursor = ctx["cursorStreamer"]

    activity = format_tool_activity(tool_name, args)
    try:
        socket.broadcast_activity({
            "stage": "executing_tool", "toolName": tool_name,
            "toolAction": activity["toolAction"], "toolSummary": activity["toolSummary"],
            "thought": f"{activity['toolAction']}...",
            "turnIndex": stats["toolCalls"], "maxTurns": ctx.get("maxTurns", 15),
            "requestId": ctx.get("requestId", ""),
        })
    except Exception:
        pass

    # Chunked write handles its own pen-synced glides — don't pre-glide.
    if tool_name == "chalkboard_write_text" and isinstance(args.get("text"), str):
        chunked = _execute_chunked_write_text(ctx, args)
        if chunked is not None:
            return chunked

    # Pen-synced cursor paths handle their own movement (glide -> pen down ->
    # trace ink -> pen up); the generic pre-glide only covers simple tools.
    pen_synced = tool_name in (
        "chalkboard_draw_chalk", "chalkboard_insert_shape", "chalkboard_highlight_area")
    is_draw_path = (
        tool_name == "chalkboard_draw_chalk"
        and isinstance(args.get("points"), list)
        and len(args["points"]) > 1
    )
    if cursor.should_broadcast(tool_name) and not pen_synced:
        try:
            from agent.activity import extract_cursor_position
            target = extract_cursor_position(tool_name, args)
            if target:
                cursor.glide_to_blocking(target["x"], target["y"])
        except Exception:
            pass

    if tool_name == "chalkboard_draw_chalk" and (is_draw_path or isinstance(args.get("points"), list)):
        return _execute_draw_with_pen(ctx, args)

    if tool_name == "chalkboard_insert_shape":
        return _execute_shape_with_pen(ctx, args)

    if tool_name == "chalkboard_highlight_area":
        return _execute_highlight_with_pen(ctx, args)

    if tool_name == "chalkboard_respond":
        return _record_final_answer(ctx, stats, args)

    if tool_name == "chalkboard_send_chat" and isinstance(args.get("message"), str):
        stripped = strip_narration(args["message"])
        if not stripped:
            logger.warning("blocked narration-only chat message room=%s", socket.room_id)
            return {"content": [{"type": "text",
                                 "text": "That message contained only internal reasoning, not a user-facing answer. "
                                         "Write ONLY the final answer the user should read."}], "isError": True}
        args["message"] = stripped

    try:
        result = execute_tool(socket, tool_name, args, ctx.get("invokerRole", "instructor"))
        if tool_name == "chalkboard_send_chat" and not result.get("isError"):
            # A delivery is counted only after the backend accepted it. This
            # keeps the final-response fallback available after a failed send.
            stats["chatSent"] = True
            stats["chatDelivered"] = True
        if tool_name == "chalkboard_speak_narration" and not result.get("isError"):
            try:
                import json
                content = (result.get("content") or [{}])[0]
                payload = json.loads(content.get("text") or "{}")
                stats["voiceDelivered"] = bool(payload.get("delivered"))
            except Exception:
                pass
        # Brief hold so pen lingers where ink landed — visible sync.
        if cursor.should_broadcast(tool_name):
            try:
                cursor.hold(GLIDE_HOLD_MS)
            except Exception:
                pass
        return result
    except Exception as exc:  # noqa: BLE001
        logger.warning("board tool exception tool=%s: %s", tool_name, exc)
        return {"content": [{"type": "text", "text": "That action could not be completed."}], "isError": True}


def _record_final_answer(ctx: dict, stats: dict, args: dict):
    """Structured final-answer channel (chalkboard_respond).

    Only the `message` argument of chalkboard_respond is ever delivered to the
    classroom; all other model output is scratch reasoning. The message passes
    the same narration-strip + sanitize gates as chat, is stored in
    stats["finalAnswer"], and RoomSession._deliver_final_response delivers it
    exactly once through the approved channel. Nothing is emitted here.
    """
    socket = ctx["socket"]
    message = args.get("message")
    stripped = strip_narration(message) if isinstance(message, str) else None
    clean = sanitize_chat_message(stripped) if stripped else None
    if not clean:
        logger.warning("blocked narration-only respond message room=%s", socket.room_id)
        return {"content": [{"type": "text",
                             "text": "That message contained only internal reasoning, not a user-facing answer. "
                                     "Call chalkboard_respond again with ONLY the final answer the requester should read."}],
                "isError": True}
    if stats.get("finalAnswer"):
        logger.warning("duplicate respond blocked room=%s", socket.room_id)
        return {"content": [{"type": "text",
                             "text": "Final answer already recorded. Do not call chalkboard_respond again. End your turn now."}],
                "isError": True}
    stats["finalAnswer"] = clean
    return {"content": [{"type": "text",
                         "text": "Final answer recorded for delivery. Do not repeat it as text. End your turn now."}]}


def _emit_stroke_draw(socket, stroke_id: str, x, y) -> None:
    """Fire-and-forget ink packet. Pairs with the cursor broadcast emitted on
    the same trace tick, so receivers see ink appear exactly under the pen."""
    sio = getattr(socket, "sio", None)
    if sio is None:
        return
    try:
        sio.emit("stroke-draw", {"roomId": socket.room_id, "strokeId": stroke_id,
                                 "point": {"x": round(float(x), 2), "y": round(float(y), 2)}})
    except Exception:
        pass


def _pen_down(socket, stroke: dict, first: dict) -> bool:
    """Start a live stroke (mouse down). Returns True if the room accepted it."""
    try:
        res = socket.emit_with_ack("stroke-start", {
            "roomId": socket.room_id, "strokeId": stroke["id"],
            "tool": "chalk", "color": stroke.get("color") or "#ffffff",
            "size": stroke.get("size") or 4,
            "intensity": stroke.get("intensity", 1),
            "startPoint": {"x": first["x"], "y": first.get("y", 0)},
        }, timeout_s=4)
        return isinstance(res, dict) and res.get("ok") is True
    except Exception:
        return False


def _pen_synced_strokes(ctx: dict, strokes: list) -> list:
    """Draw strokes like a person, sharing ONE action timeline:

    glide to start -> stroke-start (pen down) -> cursor traces the actual ink
    path while stroke-draw packets go out in lockstep -> draw-stroke (pen up:
    persists in Redis and relays the full stroke, which atomically replaces
    the live stroke on every client).

    Cancellation mid-trace keeps the ink drawn so far — no stuck pen-down
    state, no teleporting ink. Returns the delivered stroke ids.
    """
    socket = ctx["socket"]
    cursor = ctx["cursorStreamer"]
    delivered: list = []
    for idx, stroke in enumerate(strokes):
        pts = [p for p in (stroke.get("points") or [])
               if isinstance(p, dict) and isinstance(p.get("x"), (int, float))]
        if not pts:
            continue
        # 1) Move naturally toward the exact starting point (pen up)
        try:
            cursor.glide_to_blocking(pts[0]["x"], pts[0].get("y", 0))
        except Exception:
            pass
        # 2) Mouse down — stroke goes live under the pen
        started = _pen_down(socket, stroke, pts[0])
        # 3) Follow the ACTUAL drawing path; cursor and ink share the timeline
        traced = pts
        if started:
            try:
                traced = cursor.trace_path_blocking(
                    pts,
                    on_ink=lambda x, y, sid=stroke["id"]: _emit_stroke_draw(socket, sid, x, y),
                ) or [pts[0]]
            except Exception:
                traced = pts
        # 4) Mouse up — persist + relay the full stroke
        try:
            res = append_stroke_locked(socket, {**stroke, "points": traced})
            if res.get("ok"):
                delivered.append(stroke["id"])
            else:
                logger.warning("pen-synced stroke persist failed id=%s: %s",
                               stroke.get("id"), res.get("error"))
        except Exception as exc:  # noqa: BLE001
            logger.warning("pen-synced stroke exception: %s", exc)
        try:
            cursor.hold(GLIDE_HOLD_MS)
        except Exception:
            pass
        if idx < len(strokes) - 1:
            time.sleep(stroke_gap_s())
    return delivered


def _pen_synced_result(tool_name: str, args: dict, strokes: list, delivered: list) -> dict:
    def _ok(payload: dict) -> dict:
        return {"content": [{"type": "text", "text": json.dumps(payload)}]}

    def _err(msg: str) -> dict:
        return {"content": [{"type": "text", "text": msg}], "isError": True}

    if tool_name == "chalkboard_draw_chalk":
        if delivered:
            return _ok({"success": True, "strokeId": delivered[0]})
        return _err("Draw failed: stroke was not delivered.")
    if tool_name == "chalkboard_insert_shape":
        if delivered:
            return _ok({"success": True, "shape": args.get("shape"),
                        "strokeCount": len(strokes), "strokeIds": delivered})
        return _err(f"Insert shape failed: shape \"{args.get('shape')}\" was not delivered.")
    if delivered:
        return _ok({"success": True, "highlight": args})
    return _err("Highlight failed: stroke was not delivered.")


def _execute_draw_with_pen(ctx: dict, args: dict):
    """Pen-synced chalk stroke — the same coordinates feed cursor and canvas."""
    socket = ctx["socket"]
    role = ctx.get("invokerRole", "instructor")
    # Permission/validation failures fall through to the plain executor so the
    # model receives the exact same error text as before (no cursor theater).
    if not can_invoker(role, "chalkboard_draw_chalk") or not valid_points(args.get("points")):
        return execute_tool(socket, "chalkboard_draw_chalk", args, role)
    strokes = [build_chalk_stroke(socket, args)]
    return _pen_synced_result("chalkboard_draw_chalk", args, strokes,
                              _pen_synced_strokes(ctx, strokes))


def _execute_shape_with_pen(ctx: dict, args: dict):
    """Pen-synced shape: the cursor drags along each generated outline stroke."""
    socket = ctx["socket"]
    role = ctx.get("invokerRole", "instructor")
    if not can_invoker(role, "chalkboard_insert_shape"):
        return execute_tool(socket, "chalkboard_insert_shape", args, role)
    try:
        strokes = build_shape_strokes(socket, args)
    except Exception as exc:  # noqa: BLE001
        logger.warning("shape generation exception: %s", exc)
        strokes = []
    if not strokes:
        return execute_tool(socket, "chalkboard_insert_shape", args, role)
    return _pen_synced_result("chalkboard_insert_shape", args, strokes,
                              _pen_synced_strokes(ctx, strokes))


def _execute_highlight_with_pen(ctx: dict, args: dict):
    """Pen-synced highlight rectangle — the cursor traces the box outline."""
    socket = ctx["socket"]
    role = ctx.get("invokerRole", "instructor")
    if not can_invoker(role, "chalkboard_highlight_area"):
        return execute_tool(socket, "chalkboard_highlight_area", args, role)
    try:
        strokes = [build_highlight_stroke(socket, args)]
    except Exception as exc:  # noqa: BLE001
        logger.warning("highlight build exception: %s", exc)
        return execute_tool(socket, "chalkboard_highlight_area", args, role)
    return _pen_synced_result("chalkboard_highlight_area", args, strokes,
                              _pen_synced_strokes(ctx, strokes))


def _execute_chunked_write_text(ctx: dict, args: dict):
    raw_text = (args.get("text") or "").strip()
    words = [w for w in raw_text.split() if w]
    font_size = args.get("fontSize") if isinstance(args.get("fontSize"), (int, float)) else 26
    chunk_size = 1 if font_size >= 36 else 2
    if len(words) <= chunk_size:
        return None
    chunks = [" ".join(words[i:i + chunk_size]) for i in range(0, len(words), chunk_size)]
    cur_x = args.get("x", 0) if isinstance(args.get("x"), (int, float)) else 0
    base_y = args.get("y", 0) if isinstance(args.get("y"), (int, float)) else 0
    char_w = font_size * 0.6
    gap = font_size * 0.3
    results = []
    cursor = ctx["cursorStreamer"]
    for idx, chunk_text in enumerate(chunks):
        chunk_args = {**args, "text": chunk_text, "x": round(cur_x), "y": base_y,
                      "textAlign": "left", "fontSize": font_size}
        # Pen arrives where chunk will appear — then ink
        try:
            cursor.glide_to_blocking(chunk_args["x"], chunk_args["y"])
        except Exception:
            pass
        try:
            from tools.executors import execute_tool as _exec
            results.append(_exec(ctx["socket"], "chalkboard_write_text", chunk_args, ctx.get("invokerRole", "instructor")))
        except Exception:
            return {"content": [{"type": "text", "text": "That action could not be completed."}], "isError": True}
        try:
            cursor.hold(GLIDE_HOLD_MS)
        except Exception:
            pass
        cur_x += len(chunk_text) * char_w + gap
        if idx < len(chunks) - 1:
            time.sleep(CHUNK_PAUSE_MS / 1000.0)
    import json
    return {"content": [{"type": "text", "text": json.dumps(
        {"success": True, "originalText": raw_text, "chunks": chunks, "results": results})}]}
