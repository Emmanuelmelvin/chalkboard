"""HTTP entrypoint for the Python Chalkboard Master agent-service.

Single service, no agent-brain. Mirrors src/index.ts routes:
  GET  /health
  POST /sessions/join | /sessions/leave
  GET  /sessions/status/:roomId
  POST /instruct | /stop
Auth: x-agent-secret or Authorization: Bearer <AGENT_SECRET>.
Rate limits: join/leave/stop 30/min, instruct 20/min (per IP+path, in-memory).
"""

from __future__ import annotations

import hmac
import re
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, jsonify, request

import config
from agent.session import RoomSession
from errors import AgentError
from logger import logger

config.validate_or_warn()

app = Flask(__name__)
sessions: dict[str, RoomSession] = {}
_sessions_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = defaultdict(list)

_CONTROL_CHARS = re.compile(r"[\u0000-\u001f\u007f]")


def _valid_room_id(value) -> str | None:
    if not isinstance(value, str) or not (1 <= len(value) <= 128):
        return None
    if _CONTROL_CHARS.search(value):
        return None
    return value


def require_auth(fn):
    @wraps(fn)
    def _wrap(*args, **kwargs):
        provided = request.headers.get("x-agent-secret")
        auth = request.headers.get("authorization") or ""
        bearer = auth[7:] if auth.startswith("Bearer ") else None
        candidate = provided or bearer
        if not isinstance(candidate, str) or not hmac.compare_digest(
            candidate.encode("utf-8"), config.AGENT_SECRET.encode("utf-8")
        ):
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        return fn(*args, **kwargs)
    return _wrap


def rate_limit(max_per_minute: int):
    def _deco(fn):
        @wraps(fn)
        def _wrap(*args, **kwargs):
            key = f"{request.remote_addr}:{request.path}"
            now = time.time()
            hits = [t for t in _rate_buckets[key] if t > now - 60]
            if len(hits) >= max_per_minute:
                return jsonify({"ok": False, "error": "rate_limited"}), 429
            hits.append(now)
            _rate_buckets[key] = hits
            return fn(*args, **kwargs)
        return _wrap
    return _deco


@app.after_request
def _headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@app.get("/health")
def health():
    models = config.get_model_waterfall()
    return jsonify({"status": "healthy", "service": "chalkboard-agent-service",
                    "model": models[0] if models else "", "models": models,
                    "provider": config.LLM_PROVIDER,
                    "activeRoomSessions": len(sessions),
                    "timestamp": datetime.now(timezone.utc).isoformat()})


@app.post("/sessions/join")
@require_auth
@rate_limit(30)
def sessions_join():
    body = request.get_json(force=True, silent=True) or {}
    room_id = _valid_room_id(body.get("roomId"))
    if not room_id:
        return jsonify({"error": "roomId is required (1-128 chars)"}), 400
    with _sessions_lock:
        existing = sessions.get(room_id)
        if existing and existing.state not in ("DISCONNECTED", "ERROR"):
            return jsonify({"ok": True, "message": "Chalkboard Master already active",
                            "status": existing.get_status()})
        session = RoomSession(room_id)
        sessions[room_id] = session
    if session.start():
        return jsonify({"ok": True, "message": "Chalkboard Master joined and observing",
                        "status": session.get_status()})
    with _sessions_lock:
        sessions.pop(room_id, None)
    return jsonify({"ok": False, "error": f"Failed to connect to room {room_id}"}), 500


@app.post("/sessions/leave")
@require_auth
@rate_limit(30)
def sessions_leave():
    body = request.get_json(force=True, silent=True) or {}
    room_id = _valid_room_id(body.get("roomId"))
    if not room_id:
        return jsonify({"error": "roomId is required"}), 400
    with _sessions_lock:
        session = sessions.pop(room_id, None)
    if session:
        try:
            session.stop()
        except Exception:
            pass
        return jsonify({"ok": True, "message": f"Chalkboard Master left {room_id}"})
    return jsonify({"ok": True, "message": f"No active session in {room_id}"})


@app.get("/sessions/status/<path:room_id>")
@require_auth
def sessions_status(room_id: str):
    valid = _valid_room_id(room_id)
    if not valid:
        return jsonify({"ok": False, "error": "invalid roomId"}), 400
    session = sessions.get(valid)
    if session:
        return jsonify({"ok": True, "session": session.get_status()})
    return jsonify({"ok": False, "error": f"No active session for {valid}"}), 404


@app.post("/instruct")
@require_auth
@rate_limit(20)
def instruct():
    body = request.get_json(force=True, silent=True) or {}
    room_id = _valid_room_id(body.get("roomId"))
    prompt = body.get("prompt") if isinstance(body.get("prompt"), str) else ""
    prompt = prompt.strip()[:2000]
    if not room_id or not prompt:
        return jsonify({"error": "roomId and prompt required"}), 400
    requested_by = str(body.get("requestedBy") or "Classmate").strip()[:128] or "Classmate"
    # Reuse an existing usable session so /stop can reach it and concurrent
    # instructs queue on the same session. Only when no usable session exists
    # create a *tracked* ephemeral: stored in `sessions` so /stop and
    # /sessions/status can see it, and with locked start/cleanup so a racing
    # /stop cannot orphan it.
    with _sessions_lock:
        session = sessions.get(room_id)
        if session and session.state not in ("DISCONNECTED", "ERROR"):
            threading.Thread(target=_run_instruct, args=(session, prompt, requested_by), daemon=True).start()
            return jsonify({"ok": True, "message": "Chalkboard Master received instruction",
                            "roomId": room_id, "prompt": prompt})
        # No usable session — create a tracked ephemeral.
        ephemeral = RoomSession(room_id)
        sessions[room_id] = ephemeral
    if not ephemeral.start():
        with _sessions_lock:
            if sessions.get(room_id) is ephemeral:
                sessions.pop(room_id, None)
        return jsonify({"error": "Failed to join room"}), 500
    threading.Thread(target=_run_ephemeral, args=(ephemeral, prompt, requested_by), daemon=True).start()
    return jsonify({"ok": True, "message": "Chalkboard Master joining and preparing lesson",
                    "roomId": room_id, "prompt": prompt})


def _run_instruct(session: RoomSession, prompt: str, requested_by: str) -> None:
    try:
        session.enqueue_reasoning_task(prompt, requested_by, "instructor")
    except Exception as exc:  # noqa: BLE001
        logger.exception("instruct error room=%s: %s", session.room_id, exc)


def _run_ephemeral(session: RoomSession, prompt: str, requested_by: str) -> None:
    try:
        session.enqueue_reasoning_task(prompt, requested_by, "instructor")
    except Exception as exc:  # noqa: BLE001
        logger.exception("ephemeral error room=%s: %s", session.room_id, exc)
    finally:
        try:
            session.stop()
        except Exception:
            pass
        # Clean up the tracked ephemeral so a later /instruct or /sessions/join
        # sees a fresh state, but only if the same object is still stored —
        # avoids removing a newer session created after this ephemeral started.
        with _sessions_lock:
            if sessions.get(session.room_id) is session:
                sessions.pop(session.room_id, None)


@app.post("/stop")
@require_auth
@rate_limit(30)
def stop():
    body = request.get_json(force=True, silent=True) or {}
    room_id = _valid_room_id(body.get("roomId"))
    if not room_id:
        return jsonify({"error": "roomId required"}), 400
    with _sessions_lock:
        session = sessions.pop(room_id, None)
    if session:
        try:
            session.stop()
        except Exception:
            pass
    return jsonify({"ok": True, "message": f"Agent stopped in {room_id}"})


@app.post("/tools/execute")
@require_auth
@rate_limit(120)
def tools_execute():
    """Kept for backward compatibility (old agent-brain callbacks).

    Executes one board tool in the live session — same run_board_tool path
    the in-process providers use. Returns 404 when no session is active.
    """
    body = request.get_json(force=True, silent=True) or {}
    room_id = _valid_room_id(body.get("roomId"))
    tool = body.get("tool")
    if not room_id or not isinstance(tool, str) or not (1 <= len(tool) <= 128):
        return jsonify({"ok": False, "error": "invalid tool call"}), 400
    role = body.get("invokerRole", "instructor")
    if role not in ("owner", "instructor", "viewer"):
        role = "instructor"
    session = sessions.get(room_id)
    if not session or session.state in ("DISCONNECTED", "ERROR"):
        return jsonify({"ok": False, "error": "no_active_session"}), 404
    try:
        result = session.execute_board_tool(tool, body.get("args") or {}, role,
                                            str(body.get("requestId") or "external"))
        return jsonify({"ok": True, "result": result})
    except Exception as exc:  # noqa: BLE001
        logger.exception("tool execute error room=%s tool=%s: %s", room_id, tool, exc)
        return jsonify({"ok": False, "error": "tool_failed"}), 500


if __name__ == "__main__":
    logger.info("Chalkboard Master Agent Service (python) running port=%s provider=%s backend=%s",
                config.PORT, config.LLM_PROVIDER, config.MAIN_BACKEND_SOCKET_URL)
    app.run(host="0.0.0.0", port=config.PORT, threaded=True)
