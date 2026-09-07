"""Single board-tool UX path (mirrors src/agent/boardToolRunner.ts).

Used by BOTH providers: Gemini and Bedrock tool closures call run_board_tool
directly in-process — no HTTP hop, identical cursor/activity/RBAC behavior.
"""

from __future__ import annotations

import time
from typing import Any

from agent.activity import format_tool_activity
from agent.cursor import (
    CHUNK_GLIDE_INTERVAL_MS,
    CHUNK_GLIDE_STEPS,
    CHUNK_PAUSE_MS,
    GLIDE_HOLD_MS,
    GLIDE_INTERVAL_MS,
    GLIDE_STEPS,
    POST_DRAW_INTERVAL_MS,
)
from agent.sanitize import sanitize_chat_message, strip_narration
from logger import logger
from tools.executors import execute_tool


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

    # Pen-synced cursor: glide arrives where ink appears, then hold.
    # For draw_chalk with a path, the generic pre-glide is skipped — the
    # draw path (below) already does: glide to start -> emit -> trace rest.
    is_draw_path = (
        tool_name == "chalkboard_draw_chalk"
        and isinstance(args.get("points"), list)
        and len(args["points"]) > 1
    )
    if cursor.should_broadcast(tool_name) and not is_draw_path:
        try:
            from agent.activity import extract_cursor_position
            target = extract_cursor_position(tool_name, args)
            if target:
                cursor.glide_to_blocking(
                    target["x"], target["y"],
                    steps=GLIDE_STEPS, interval_ms=GLIDE_INTERVAL_MS,
                )
        except Exception:
            pass

    if tool_name == "chalkboard_draw_chalk" and is_draw_path:
        return _execute_draw_with_pen(ctx, args)

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


def _execute_draw_with_pen(ctx: dict, args: dict):
    """Pen-synced draw: glide to start -> emit (ink appears under pen) -> trace rest -> hold."""
    socket = ctx["socket"]
    cursor = ctx["cursorStreamer"]
    points = args.get("points") or []
    # Glide to first point so pen is at stroke start when ink appears
    try:
        first = points[0] if isinstance(points[0], dict) else None
        if first and isinstance(first.get("x"), (int, float)):
            cursor.glide_to_blocking(first["x"], first.get("y", 0),
                                     steps=GLIDE_STEPS, interval_ms=GLIDE_INTERVAL_MS)
    except Exception:
        pass
    try:
        result = execute_tool(socket, "chalkboard_draw_chalk", args, ctx.get("invokerRole", "instructor"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("board tool exception tool=%s: %s", "chalkboard_draw_chalk", exc)
        return {"content": [{"type": "text", "text": "That action could not be completed."}], "isError": True}
    # Trace remaining points over the fresh ink so pen path matches stroke
    try:
        if len(points) > 1:
            cursor.stream_path_blocking(points[1:], max_samples=24, interval_ms=POST_DRAW_INTERVAL_MS)
            cursor.hold(GLIDE_HOLD_MS)
    except Exception:
        pass
    return result


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
            cursor.glide_to_blocking(chunk_args["x"], chunk_args["y"],
                                     steps=CHUNK_GLIDE_STEPS,
                                     interval_ms=CHUNK_GLIDE_INTERVAL_MS)
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
