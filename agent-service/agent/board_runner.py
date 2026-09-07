"""Single board-tool UX path (mirrors src/agent/boardToolRunner.ts).

Used by BOTH providers: Gemini and Bedrock tool closures call run_board_tool
directly in-process — no HTTP hop, identical cursor/activity/RBAC behavior.
"""

from __future__ import annotations

import time
from typing import Any

from agent.activity import format_tool_activity
from agent.sanitize import strip_narration
from logger import logger
from tools.executors import execute_tool


def create_board_tool_stats() -> dict:
    return {"toolCalls": 0, "chatSent": False}


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

    if cursor.should_broadcast(tool_name):
        try:
            cursor.start_parallel_tool_cursor(tool_name, args)
        except Exception:
            pass

    if tool_name == "chalkboard_write_text" and isinstance(args.get("text"), str):
        chunked = _execute_chunked_write_text(ctx, args)
        if chunked is not None:
            return chunked

    if tool_name == "chalkboard_send_chat" and isinstance(args.get("message"), str):
        stripped = strip_narration(args["message"])
        if not stripped:
            logger.warning("blocked narration-only chat message room=%s", socket.room_id)
            return {"content": [{"type": "text",
                                 "text": "That message contained only internal reasoning, not a user-facing answer. "
                                         "Write ONLY the final answer the user should read."}], "isError": True}
        args["message"] = stripped

    if tool_name == "chalkboard_send_chat":
        stats["chatSent"] = True

    try:
        return execute_tool(socket, tool_name, args, ctx.get("invokerRole", "instructor"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("board tool exception tool=%s: %s", tool_name, exc)
        return {"content": [{"type": "text", "text": "That action could not be completed."}], "isError": True}


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
    for idx, chunk_text in enumerate(chunks):
        chunk_args = {**args, "text": chunk_text, "x": round(cur_x), "y": base_y,
                      "textAlign": "left", "fontSize": font_size}
        try:
            ctx["cursorStreamer"].glide_to(chunk_args["x"], chunk_args["y"], 4, 15)
        except Exception:
            pass
        try:
            from tools.executors import execute_tool as _exec
            results.append(_exec(ctx["socket"], "chalkboard_write_text", chunk_args, ctx.get("invokerRole", "instructor")))
        except Exception:
            return {"content": [{"type": "text", "text": "That action could not be completed."}], "isError": True}
        cur_x += len(chunk_text) * char_w + gap
        if idx < len(chunks) - 1:
            time.sleep(0.035)
    import json
    return {"content": [{"type": "text", "text": json.dumps(
        {"success": True, "originalText": raw_text, "chunks": chunks, "results": results})}]}
