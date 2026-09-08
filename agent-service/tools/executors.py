"""Socket-emitting executors with invokerRole permission inheritance.

Mirrors src/tools/executors.ts. Each tool maps to a socket event plus a
minimum role; the invoker role is pre-checked before emitting.
"""

from __future__ import annotations

import json
import math
import time
import uuid
from typing import Any

from agent.socket_client import MIRROR_STROKE_LIMIT
from logger import logger
from tools.shapes import generate_shape_strokes

Role = str

# Must match frontend/src/plugins/builtin/notes/manifest.ts (`id`), which
# NotesLayer.tsx filters on to render notes.
NOTES_PLUGIN_ID = "chalkboard.notes"

# Backend SOCKET_LIMITS.maxHistoryBytes — the whole undo-stroke payload is
# measured against this, and an oversized one is rejected as invalid_payload.
HISTORY_MAX_BYTES = 768 * 1024

TOOL_MIN_ROLE: dict[str, str] = {
    "chalkboard_get_state": "viewer",
    "chalkboard_draw_chalk": "instructor",
    "chalkboard_write_text": "instructor",
    "chalkboard_insert_shape": "instructor",
    "chalkboard_move_cursor": "instructor",
    "chalkboard_create_note": "instructor",
    "chalkboard_highlight_area": "instructor",
    "chalkboard_select_and_transform": "instructor",
    "chalkboard_manage_topic_links": "instructor",
    "chalkboard_send_chat": "viewer",
    "chalkboard_speak_narration": "viewer",
    "chalkboard_clear_or_undo": "instructor",
    "chalkboard_send_reaction": "viewer",
    "chalkboard_toggle_hand": "viewer",
    "chalkboard_kick_member": "instructor",
    "chalkboard_update_member_role": "owner",
    "chalkboard_close_room": "owner",
    "chalkboard_manage_voice": "owner",
    "chalkboard_clipboard": "instructor",
}


def _rank(role: str) -> int:
    return {"owner": 2, "instructor": 1}.get(role, 0)


def can_invoker(role: str, tool: str) -> bool:
    return _rank(role) >= _rank(TOOL_MIN_ROLE.get(tool, "viewer"))


def forbidden_message(tool: str, invoker_role: str) -> str:
    if tool == "chalkboard_kick_member":
        return f"I can't kick — only instructors/owners can. Your role is {invoker_role}. Ask the owner."
    if tool in ("chalkboard_update_member_role", "chalkboard_close_room", "chalkboard_manage_voice"):
        return f"That action requires owner permission. Your role is {invoker_role}."
    if TOOL_MIN_ROLE.get(tool) == "instructor":
        return f"Viewers can't draw or modify the board. Your role is {invoker_role}."
    return f"Permission denied for {tool} with role {invoker_role}."


def _make_stroke_id(socket, suffix: str) -> str:
    sid = "".join(c for c in (getattr(socket, "socket_id", "") or "agent") if c.isalnum() or c in "-_")[:48]
    return f"{sid}-{suffix}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"


def _valid_points(points: Any) -> bool:
    if not isinstance(points, list) or not (1 <= len(points) <= 10_000):
        return False
    return all(
        isinstance(point, dict)
        and _valid_coordinate(point.get("x"))
        and _valid_coordinate(point.get("y"))
        for point in points
    )


def _valid_coordinate(value: Any) -> bool:
    """Match the backend's finite, bounded canvas-number contract."""
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and -10_000_000 <= value <= 10_000_000)


def _coordinate_or(value: Any, default: float = 0) -> float:
    return value if _valid_coordinate(value) else default


def _positive_coordinate_or(value: Any, default: float) -> float:
    return value if _valid_coordinate(value) and value > 0 else default


def _ok_text(payload: Any) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(payload)}]}


def _err_text(msg: str) -> dict:
    return {"content": [{"type": "text", "text": msg}], "isError": True}


def _clean_stroke(stroke: dict) -> dict:
    """Drop None optionals (backend zod .optional() rejects null) + clamp ranges."""
    cleaned = {k: v for k, v in (stroke or {}).items() if v is not None}
    # points must be [{x, y}] finite numbers within backend limits
    pts = []
    for p in cleaned.get("points") or []:
        try:
            x, y = float(p.get("x")), float(p.get("y"))
        except (TypeError, ValueError, AttributeError):
            continue
        if not math.isfinite(x) or not math.isfinite(y):
            continue
        pts.append({"x": max(-10_000_000, min(10_000_000, x)),
                    "y": max(-10_000_000, min(10_000_000, y))})
    cleaned["points"] = pts
    try:
        size = float(cleaned.get("size", 4))
    except (TypeError, ValueError):
        size = 4
    cleaned["size"] = max(0.1, min(1_000, size))
    if "intensity" in cleaned:
        try:
            inten = float(cleaned["intensity"])
        except (TypeError, ValueError):
            inten = 1
        cleaned["intensity"] = max(0, min(1, inten))
    for key in ("color", "fillColor", "noteTextColor", "noteBackgroundColor"):
        if isinstance(cleaned.get(key), str):
            v = cleaned[key].strip()[:64]
            # model sometimes sends '>#000000' or 'fill:#fff' — extract hex
            if key in ("color", "fillColor") and v and v[0] not in ("#",):
                import re as _re
                m = _re.search(r"#[0-9a-fA-F]{3,8}", v)
                v = m.group(0) if m else ""
            cleaned[key] = v or None
            if not cleaned[key]:
                cleaned.pop(key, None)
    for key in ("id", "userId"):
        if isinstance(cleaned.get(key), str):
            cleaned[key] = cleaned[key][:256]
    if isinstance(cleaned.get("text"), str):
        cleaned["text"] = cleaned["text"][:64 * 1024]
    if isinstance(cleaned.get("noteHtml"), str):
        cleaned["noteHtml"] = cleaned["noteHtml"][:64 * 1024]
    # backend allows only smooth|linear
    if cleaned.get("pathType") not in ("smooth", "linear"):
        cleaned["pathType"] = "smooth"
    # closed must be bool, drop if not
    if "closed" in cleaned and not isinstance(cleaned["closed"], bool):
        cleaned["closed"] = bool(cleaned["closed"]) if isinstance(cleaned["closed"], (int, float)) else None
        if cleaned["closed"] is None:
            cleaned.pop("closed", None)
    return {k: v for k, v in cleaned.items() if v is not None}


def history_is_complete(socket) -> bool:
    """Is the in-memory mirror the WHOLE board?

    ``undo-stroke`` replaces the entire server-side history with the array we
    send. That array is rebuilt from the mirror, so if the mirror is missing
    older strokes they are permanently deleted from the room. Default to True
    only because a fresh mirror starts empty and complete; the socket sets it
    False the moment it drops a stroke it received.
    """
    context = getattr(socket, "context", None) or {}
    return context.get("historyComplete", True) is not False


def _cannot_rewrite_history(action: str, reason: str) -> dict:
    return _err_text(
        f"Cannot {action}: {reason} Rewriting this board's history would permanently delete "
        f"strokes, so I stopped. Ask a person to use the board's own undo or eraser instead."
    )


def sanitize_history(strokes: Any) -> list[dict]:
    """Prepare a full-history array for undo-stroke.

    ``undo-stroke`` replaces the entire board history, and every stroke in it
    is validated against the same backend schema as a single draw. Strokes in
    the in-memory mirror can come straight off the wire, so they must go
    through the same null-stripping/clamping as freshly built ones — one
    explicit null anywhere in the array rejects the whole payload with
    ``invalid_payload`` and the undo/delete/recolor/nudge silently fails.
    """
    cleaned = []
    for stroke in (strokes or []):
        if not isinstance(stroke, dict):
            continue
        candidate = _clean_stroke(stroke)
        if candidate.get("points"):
            cleaned.append(candidate)
    return cleaned


def prepare_history_replacement(socket, strokes: Any, action: str) -> tuple[dict | None, dict | None]:
    """Build a safe ``undo-stroke`` payload, or explain why it is not safe.

    Returns ``(payload, error)`` with exactly one of the two set. Both refusals
    are data-loss guards, not cosmetic validation:

    * an incomplete mirror cannot describe the whole board, so sending it
      deletes every stroke the agent never received;
    * a payload over the backend's byte ceiling is rejected wholesale, and
      emitting one just to watch it fail tells the model nothing useful.
    """
    if not history_is_complete(socket):
        return None, _cannot_rewrite_history(
            action, "this board has more strokes than I can track.")
    payload = {"roomId": getattr(socket, "room_id", ""), "strokes": sanitize_history(strokes)}
    size = len(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    if size > HISTORY_MAX_BYTES:
        return None, _cannot_rewrite_history(
            action,
            f"the board's history is {size // 1024} KiB, over the "
            f"{HISTORY_MAX_BYTES // 1024} KiB a single update may carry.")
    return payload, None


def _append_single_stroke(s, stroke: dict) -> dict:
    stroke = _clean_stroke(stroke)
    if not stroke.get("points"):
        return {"ok": False, "error": "draw-stroke rejected: no valid points"}
    res = s.emit_with_ack("draw-stroke", {"roomId": s.room_id, "stroke": stroke})
    if not res.get("ok"):
        return {"ok": False, "error": str(res.get("error") or "draw-stroke rejected")}
    s.context["strokes"].append(stroke)
    if len(s.context["strokes"]) > MIRROR_STROKE_LIMIT:
        # Dropping a stroke makes the mirror an incomplete record of the board,
        # so full-history rewrites must stop being offered (see
        # history_is_complete) rather than delete what is no longer tracked.
        s.context["strokes"].pop(0)
        s.context["historyComplete"] = False
    s.context["strokeCount"] = s.context.get("strokeCount", 0) + 1
    s.context["lastActivityAt"] = int(time.time() * 1000)
    return {"ok": True}


def append_stroke_locked(socket, stroke: dict) -> dict:
    """Persist a stroke via draw-stroke (Redis + full-stroke relay) while
    holding the context lock, so in-memory history stays consistent with
    concurrent socket callbacks."""
    lock = getattr(socket, "context_lock", None)
    if lock is None:
        return _append_single_stroke(socket, stroke)
    with lock:
        return _append_single_stroke(socket, stroke)


def valid_points(points: Any) -> bool:
    return _valid_points(points)


def build_chalk_stroke(socket, args: dict) -> dict:
    """Pure chalk stroke builder (shared by the executor and the pen-synced
    draw path — the SAME coordinates feed cursor and canvas)."""
    return {"id": _make_stroke_id(socket, "chalk"),
            "userId": getattr(socket, "socket_id", "") or "agent:chalkboard-master",
            "tool": "chalk", "color": args.get("color") or "#ffffff",
            "size": args.get("size") or 4, "intensity": args.get("intensity", 1),
            "pathType": args.get("pathType") or "smooth",
            "closed": args.get("closed"), "fillColor": args.get("fillColor"),
            "points": args["points"], "agentId": "chalkboard-master"}


def build_shape_strokes(socket, args: dict) -> list[dict]:
    return generate_shape_strokes({
        "shape": args.get("shape"), "cx": _coordinate_or(args.get("x")),
        "cy": _coordinate_or(args.get("y")),
        "radius": _positive_coordinate_or(args.get("radius"), 80),
        "color": args.get("color") or "#ffffff", "size": args.get("size") or 3,
        "intensity": args.get("intensity", 1), "fillColor": args.get("fillColor"),
        "userId": getattr(socket, "socket_id", "") or "agent:chalkboard-master"})


def build_highlight_stroke(socket, args: dict) -> dict:
    points = [{"x": args["minX"], "y": args["minY"]}, {"x": args["maxX"], "y": args["minY"]},
              {"x": args["maxX"], "y": args["maxY"]}, {"x": args["minX"], "y": args["maxY"]},
              {"x": args["minX"], "y": args["minY"]}]
    return {"id": _make_stroke_id(socket, "hl"),
            "userId": getattr(socket, "socket_id", "") or "agent:chalkboard-master",
            "tool": "chalk", "color": "#38bdf8", "size": 3,
            "points": points, "agentId": "chalkboard-master"}


def execute_tool(socket, tool_name: str, args: dict | None, invoker_role: str) -> dict:
    # Socket callbacks also update this in-memory mirror.  Keep each board
    # operation atomic with respect to those callbacks so full-list updates
    # (undo/delete/links) cannot overwrite a concurrently received update.
    lock = getattr(socket, "context_lock", None)
    if lock is None:
        return _execute_tool(socket, tool_name, args, invoker_role)
    with lock:
        return _execute_tool(socket, tool_name, args, invoker_role)


def _execute_tool(socket, tool_name: str, args: dict | None, invoker_role: str) -> dict:
    args = dict(args or {})
    logger.debug("Tool invoked tool=%s room=%s",
                tool_name, socket.room_id)
    if not can_invoker(invoker_role, tool_name):
        msg = forbidden_message(tool_name, invoker_role)
        logger.warning("Permission denied tool=%s role=%s room=%s", tool_name, invoker_role, socket.room_id)
        return _err_text(msg)

    room_id = socket.room_id
    s = socket
    try:
        if tool_name == "chalkboard_get_state":
            include_details = args.get("includeStrokeDetails") is True
            strokes = s.context.get("strokes", [])
            summary = [{"id": st.get("id"), "color": st.get("color"), "tool": st.get("tool"),
                        "text": st.get("text"), "pointCount": len(st.get("points") or [])} for st in strokes]
            board_total = s.context.get("strokeCount", len(strokes))
            complete = history_is_complete(s)
            payload = {"roomId": room_id, "totalStrokes": board_total,
                       "inspectableStrokes": len(strokes),
                       "strokes": strokes if include_details else summary,
                       "links": s.context.get("links", []),
                       "members": [{"socketId": sid, **u} for sid, u in s.context.get("members", {}).items()]}
            if not complete:
                # Tell the model up front, so a refused undo/delete is expected
                # rather than looking like an unexplained tool failure.
                payload["historyComplete"] = False
                payload["note"] = (
                    f"Only the {len(strokes)} most recent of {board_total} strokes are visible to me. "
                    "Undo, delete, recolour and nudge are unavailable on this board because "
                    "rewriting its history would delete the strokes I cannot see.")
            return _ok_text(payload)
        if tool_name == "chalkboard_move_cursor":
            x, y = args.get("x"), args.get("y")
            if not _valid_coordinate(x) or not _valid_coordinate(y):
                return _err_text("x and y must be finite canvas coordinates within +/-10000000")
            s.broadcast_cursor(x, y)
            return _ok_text({"success": True, "cursor": {"x": x, "y": y}})
        if tool_name == "chalkboard_draw_chalk":
            if not _valid_points(args.get("points")):
                return _err_text("points required (1-10000 finite {x,y})")
            stroke = build_chalk_stroke(socket, args)
            res = _append_single_stroke(s, stroke)
            if not res["ok"]:
                return _err_text(f"Draw failed: {res['error']}")
            return _ok_text({"success": True, "strokeId": stroke["id"]})
        if tool_name == "chalkboard_write_text":
            if not args.get("text"):
                return _err_text("text required")
            font_size = args.get("fontSize") or 26
            char_w = font_size * 0.55
            x, y = args.get("x", 0), args.get("y", 0)
            stroke = {"id": _make_stroke_id(socket, "txt"),
                      "userId": getattr(socket, "socket_id", "") or "agent:chalkboard-master",
                      "tool": "chalk", "color": args.get("color") or "#ffffff", "size": 2,
                      "text": args["text"], "fontSize": font_size,
                      "textAlign": args.get("textAlign") or "left", "pathType": "linear",
                      "points": [{"x": x, "y": y}, {"x": x + len(args["text"]) * char_w, "y": y}],
                      "agentId": "chalkboard-master"}
            res = _append_single_stroke(s, stroke)
            if not res["ok"]:
                return _err_text(f"Write failed: {res['error']}")
            return _ok_text({"success": True, "strokeId": stroke["id"]})
        if tool_name == "chalkboard_insert_shape":
            shape_strokes = build_shape_strokes(socket, args)
            if not shape_strokes:
                return _err_text(f"Failed to generate shape \"{args.get('shape')}\"")
            for st in shape_strokes:
                res = _append_single_stroke(s, st)
                if not res["ok"]:
                    return _err_text(f"Insert shape failed: {res['error']}")
            return _ok_text({"success": True, "shape": args.get("shape"),
                             "strokeCount": len(shape_strokes), "strokeIds": [st["id"] for st in shape_strokes]})
        if tool_name == "chalkboard_create_note":
            content = args.get("content")
            if not isinstance(content, str) or not content.strip():
                return _err_text("content required (note HTML)")
            w, h = args.get("width") or 260, args.get("height") or 160
            x, y = args.get("x", 0), args.get("y", 0)
            stroke = {"id": _make_stroke_id(socket, "note"),
                      "userId": getattr(socket, "socket_id", "") or "agent:chalkboard-master",
                      "tool": "chalk", "color": args.get("textColor") or "#f8fafc", "size": 1,
                      "noteHtml": content, "noteWidth": w, "noteHeight": h,
                      "noteBackgroundColor": args.get("backgroundColor") or "#1e293b",
                      "noteTextColor": args.get("textColor") or "#f8fafc", "objectType": "note",
                      # NotesLayer renders ONLY strokes tagged with the notes
                      # plugin id, and the canvas renderer skips anything with
                      # noteHtml. Without this the note is persisted but drawn
                      # nowhere — invisible while the tool reports success.
                      "pluginId": NOTES_PLUGIN_ID,
                      "pathType": "linear",
                      "points": [{"x": x, "y": y}, {"x": x + w, "y": y},
                                 {"x": x + w, "y": y + h}, {"x": x, "y": y + h}],
                      "agentId": "chalkboard-master"}
            res = _append_single_stroke(s, stroke)
            if not res["ok"]:
                return _err_text(f"Create note failed: {res['error']}")
            return _ok_text({"success": True, "strokeId": stroke["id"]})
        if tool_name == "chalkboard_highlight_area":
            res = _append_single_stroke(s, build_highlight_stroke(socket, args))
            if not res["ok"]:
                return _err_text(f"Highlight failed: {res['error']}")
            return _ok_text({"success": True, "highlight": args})
        if tool_name == "chalkboard_clear_or_undo":
            action = args.get("action") or "undo"
            if action == "clear":
                res = s.emit_with_ack("clear-board", {"roomId": room_id})
                if not res.get("ok"):
                    return _err_text(f"Clear board failed: {res.get('error')}")
                s.context["strokes"] = []
                s.context["strokeCount"] = 0
                return _ok_text({"success": True, "action": "clear", "message": "Board cleared successfully."})
            if action == "undo":
                if not s.context.get("strokes"):
                    return _ok_text({"success": False, "message": "Board has no strokes to undo."})
                updated = s.context["strokes"][:-1]
                payload, err = prepare_history_replacement(s, updated, "undo")
                if err:
                    return err
                res = s.emit_with_ack("undo-stroke", payload)
                if not res.get("ok"):
                    return _err_text(f"Undo failed: {res.get('error')}")
                s.context["strokes"] = updated
                s.context["strokeCount"] = len(updated)
                return _ok_text({"success": True, "action": "undo", "remainingStrokes": len(updated)})
            return _err_text(f"Unsupported clear_or_undo action \"{action}\". Supported: undo, clear. Redo is not supported.")
        if tool_name == "chalkboard_manage_topic_links":
            action = args.get("action") or "list"
            if action == "list":
                return _ok_text({"success": True, "links": s.context.get("links", [])})
            if action == "create":
                tag = (args.get("tag") or "Untitled Section").strip()
                stroke_ids = args.get("strokeIds") if isinstance(args.get("strokeIds"), list) and args.get("strokeIds") else [
                    st["id"] for st in s.context.get("strokes", [])[-8:]]
                new_link = {"id": f"link-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}", "tag": tag,
                            "strokeIds": stroke_ids,
                            "userId": getattr(socket, "socket_id", "") or "agent:chalkboard-master"}
                updated = [*s.context.get("links", []), new_link]
                res = s.emit_with_ack("links-update", {"roomId": room_id, "links": updated})
                if not res.get("ok"):
                    return _err_text(f"Create link failed: {res.get('error')}")
                s.context["links"] = updated
                return _ok_text({"success": True, "action": "create", "link": new_link})
            if action == "delete":
                updated = [lnk for lnk in s.context.get("links", [])
                           if lnk.get("id") != args.get("linkId") and lnk.get("tag") != args.get("tag")]
                res = s.emit_with_ack("links-update", {"roomId": room_id, "links": updated})
                if not res.get("ok"):
                    return _err_text(f"Delete link failed: {res.get('error')}")
                s.context["links"] = updated
                return _ok_text({"success": True, "action": "delete", "remainingCount": len(updated)})
            if action == "rename":
                new_tag = (args.get("newTag") or args.get("tag") or "").strip()
                if not new_tag:
                    return _err_text("newTag is required for rename")
                updated = [{**lnk, "tag": new_tag} if lnk.get("id") == args.get("linkId") else lnk
                           for lnk in s.context.get("links", [])]
                res = s.emit_with_ack("links-update", {"roomId": room_id, "links": updated})
                if not res.get("ok"):
                    return _err_text(f"Rename link failed: {res.get('error')}")
                s.context["links"] = updated
                return _ok_text({"success": True, "action": "rename", "linkId": args.get("linkId"), "newTag": new_tag})
            if action == "focus":
                link = next((lnk for lnk in s.context.get("links", [])
                             if lnk.get("id") == args.get("linkId") or lnk.get("tag") == args.get("tag")), None)
                if not link:
                    return _err_text(f"Link \"{args.get('linkId') or args.get('tag')}\" not found")
                matched = [st for st in s.context.get("strokes", []) if st.get("id") in (link.get("strokeIds") or [])]
                return _ok_text({"success": True, "link": link, "matchedStrokesCount": len(matched)})
            return _ok_text({"success": True, "action": action, "links": s.context.get("links", [])})
        if tool_name == "chalkboard_select_and_transform":
            action = args.get("action") or "select_only"
            target_ids = set(args.get("strokeIds") or [])
            if action in ("select_only", "deselect"):
                return _ok_text({"success": True, "action": action, "delivered": False,
                                 "note": "Selection is local UI state only; no board change was made."})
            if action in ("rotate", "change_size", "group", "ungroup"):
                return _err_text(f"Unsupported select_and_transform action \"{action}\". Supported: delete, change_color, nudge, duplicate.")
            if action == "delete":
                if not target_ids:
                    return _err_text("No strokeIds specified for deletion")
                updated = [st for st in s.context.get("strokes", []) if st.get("id") not in target_ids]
                payload, err = prepare_history_replacement(s, updated, "delete strokes")
                if err:
                    return err
                res = s.emit_with_ack("undo-stroke", payload)
                if not res.get("ok"):
                    return _err_text(f"Delete failed: {res.get('error')}")
                s.context["strokes"] = updated
                s.context["strokeCount"] = len(updated)
                return _ok_text({"success": True, "action": "delete", "deletedCount": len(target_ids)})
            if action == "change_color":
                color = args.get("color") or "#ffffff"
                updated = [{**st, "color": color} if st.get("id") in target_ids else st
                           for st in s.context.get("strokes", [])]
                payload, err = prepare_history_replacement(s, updated, "change stroke colour")
                if err:
                    return err
                res = s.emit_with_ack("undo-stroke", payload)
                if not res.get("ok"):
                    return _err_text(f"Change color failed: {res.get('error')}")
                s.context["strokes"] = updated
                return _ok_text({"success": True, "action": "change_color",
                                 "updatedCount": len(target_ids), "color": color})
            if action == "nudge":
                dx, dy = args.get("dx", 0) or 0, args.get("dy", 0) or 0
                updated = [{**st, "points": [{"x": p["x"] + dx, "y": p["y"] + dy} for p in st.get("points", [])]}
                           if st.get("id") in target_ids else st for st in s.context.get("strokes", [])]
                payload, err = prepare_history_replacement(s, updated, "nudge strokes")
                if err:
                    return err
                res = s.emit_with_ack("undo-stroke", payload)
                if not res.get("ok"):
                    return _err_text(f"Nudge failed: {res.get('error')}")
                s.context["strokes"] = updated
                return _ok_text({"success": True, "action": "nudge", "dx": dx, "dy": dy})
            if action == "duplicate":
                to_dup = [st for st in s.context.get("strokes", []) if st.get("id") in target_ids]
                if not to_dup:
                    return _err_text("No matching strokeIds to duplicate")
                new_ids = []
                for st in to_dup:
                    dup = {**st, "id": f"agent-dup-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}",
                           "points": [{"x": p["x"] + 25, "y": p["y"] + 25} for p in st.get("points", [])]}
                    res = _append_single_stroke(s, dup)
                    if not res["ok"]:
                        return _err_text(f"Duplicate failed: {res['error']}")
                    new_ids.append(dup["id"])
                return _ok_text({"success": True, "action": "duplicate", "count": len(new_ids), "strokeIds": new_ids})
            return _err_text(f"Unsupported select_and_transform action \"{action}\".")
        if tool_name == "chalkboard_clipboard":
            action = args.get("action") or "copy"
            if action == "duplicate":
                recent = (s.context.get("strokes", []) or [])[-1:]
                if recent:
                    dup = {**recent[0], "id": _make_stroke_id(socket, "clip"),
                           "points": [{"x": p["x"] + 20, "y": p["y"] + 20} for p in recent[0].get("points", [])]}
                    res = _append_single_stroke(s, dup)
                    if not res["ok"]:
                        return _err_text(f"Clipboard duplicate failed: {res['error']}")
                    return _ok_text({"success": True, "action": "duplicate", "strokeId": dup["id"]})
                return _err_text("Board is empty, nothing to duplicate")
            return _err_text(f"Clipboard action \"{action}\" is a local UI operation with no board effect. Only \"duplicate\" mutates the board.")
        if tool_name == "chalkboard_send_chat":
            if not args.get("message"):
                return _err_text("message required")
            ok = s.send_chat_message(args["message"])
            if not ok:
                return _err_text("Send chat failed")
            return _ok_text({"success": True, "message": args["message"]})
        if tool_name == "chalkboard_speak_narration":
            if not args.get("text") or not isinstance(args.get("text"), str):
                return _err_text("text required")
            voice = getattr(s, "voice", None)
            if not voice or not getattr(voice, "connected", False):
                return _ok_text({"success": True, "delivered": False,
                                 "note": "Voice call not connected. Use chalkboard_send_chat for text unless voice was explicitly requested."})
            if not getattr(voice, "can_speak", False):
                return _ok_text({"success": True, "delivered": False,
                                 "note": "Not added to voice — only the room owner can invite the agent to speak. Use chalkboard_send_chat."})
            spoken = voice.speak(args["text"], room_id)
            payload = {"success": True, "delivered": spoken.get("delivered", False)}
            if spoken.get("reason"):
                payload["reason"] = spoken["reason"]
            return _ok_text(payload)
        if tool_name == "chalkboard_send_reaction":
            allowed = {"👍", "👏", "😂", "😮", "❤️", "🎉"}
            emoji = args.get("emoji")
            if emoji not in allowed:
                # Model tried 🚀 which backend rejects as invalid_payload
                return _err_text(f"Unsupported reaction \"{emoji}\". Allowed: 👍 👏 😂 😮 ❤️ 🎉 — use one of these.")
            res = s.emit_with_ack("reaction:send", {"roomId": room_id, "emoji": emoji})
            if not res.get("ok"):
                return _err_text(f"Reaction failed: {res.get('error')}")
            return _ok_text({"success": True, "emoji": emoji})
        if tool_name == "chalkboard_toggle_hand":
            res = s.emit_with_ack("hand:raise", {"roomId": room_id, "raised": bool(args.get("raised"))})
            if not res.get("ok"):
                return _err_text(f"Hand toggle failed: {res.get('error')}")
            return _ok_text({"success": True, "raised": args.get("raised")})
        if tool_name == "chalkboard_kick_member":
            res = s.emit_with_ack("member:kick", {"roomId": room_id,
                                                 "targetSocketId": args.get("targetSocketId"), "reason": args.get("reason")})
            if not res.get("ok"):
                return _err_text(f"Kick failed: {res.get('error')}")
            return _ok_text({"success": True})
        if tool_name == "chalkboard_update_member_role":
            res = s.emit_with_ack("member:update-role", {"roomId": room_id,
                                                        "targetUserId": args.get("targetUserId"), "role": args.get("role")})
            if not res.get("ok"):
                return _err_text(f"Update role failed: {res.get('error')}")
            return _ok_text({"success": True})
        if tool_name == "chalkboard_close_room":
            res = s.emit_with_ack("room:close", {"roomId": room_id})
            if not res.get("ok"):
                return _err_text(f"Close failed: {res.get('error')}")
            return _ok_text({"success": True})
        if tool_name == "chalkboard_manage_voice":
            event = "voice:invite" if args.get("action") == "invite" else "voice:remove"
            res = s.emit_with_ack(event, {"roomId": room_id, "targetUserId": args.get("targetUserId")})
            if not res.get("ok"):
                return _err_text(f"Voice {args.get('action')} failed: {res.get('error')}")
            return _ok_text({"success": True})
        return _err_text(f"Unknown tool {tool_name}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Executor exception tool=%s room=%s: %s", tool_name, socket.room_id, exc)
        return _err_text(f"Tool exception: {exc}")
