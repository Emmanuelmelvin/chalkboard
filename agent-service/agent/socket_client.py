"""Regular socket user daemon

Joins a room as agent:chalkboard-master (instructor), listens to all room
events, and maintains bounded context for reasoning. Uses python-socketio.
"""

from __future__ import annotations

import queue
import threading
import time
from collections import defaultdict
from typing import Any, Callable

import config
from logger import logger

MAX_COORD = 10_000_000
# Cap on the in-memory stroke mirror.
#
# The mirror is what undo/delete/change_color/nudge send back as the FULL board
# history, so a mirror smaller than the board would silently delete whatever it
# cannot see — `historyComplete` exists to block exactly that.
#
# 500 is not raised to the backend's 10_000-stroke ceiling on purpose: the
# binding limit on a history replacement is maxHistoryBytes (768 KiB), and a
# 500-stroke board of 20-point strokes already serializes to ~226 KiB. A
# 2_000-stroke mirror overruns the byte ceiling (~958 KiB) so those undos could
# not be delivered anyway, while costing ~10 MiB per room (~52 MiB at 10_000).
MIRROR_STROKE_LIMIT = 500
# How long an idle dispatcher thread waits before retiring itself after the
# socket has been closed (see _dispatch_loop).
DISPATCH_IDLE_TIMEOUT_S = 30.0


def _with_context_lock(method):
    """Serialize socket state callbacks with board-tool state mutations."""
    def _wrapped(self, *args, **kwargs):
        started = time.monotonic()
        with self.context_lock:
            try:
                return method(self, *args, **kwargs)
            finally:
                held = time.monotonic() - started
                if held > 2.0:
                    # A blocking call inside a locked callback starves the
                    # reasoning pump and the socket event loop (THREADING.md).
                    logger.warning("context_lock held %.1fs by %s room=%s",
                                   held, method.__name__, getattr(self, "room_id", "?"))
    return _wrapped


def _finite_coord(n: Any) -> bool:
    return isinstance(n, (int, float)) and n == n and abs(n) <= MAX_COORD


def _valid_point(p: Any) -> bool:
    return isinstance(p, dict) and _finite_coord(p.get("x")) and _finite_coord(p.get("y"))


def normalize_full_stroke(payload: Any, fallback_id: str | None = None) -> dict | None:
    if not isinstance(payload, dict):
        return None
    sid = payload.get("id") if isinstance(payload.get("id"), str) else (
        payload.get("strokeId") if isinstance(payload.get("strokeId"), str) else fallback_id)
    points = payload.get("points") if isinstance(payload.get("points"), list) else None
    if not sid or not points or not (1 <= len(points) <= 10_000):
        return None
    if not all(_valid_point(p) for p in points):
        return None
    tool = "eraser" if payload.get("tool") == "eraser" else "chalk"
    color = str(payload.get("color") or "#ffffff")[:64]
    size = payload.get("size")
    size = min(1000, max(0.1, size)) if isinstance(size, (int, float)) else 4
    stroke = {
        "id": sid[:256],
        "userId": str(payload.get("userId") or "unknown")[:256],
        "tool": tool, "color": color, "size": size,
        "intensity": payload.get("intensity", 1),
        "pathType": "linear" if payload.get("pathType") == "linear" else "smooth",
        "closed": True if payload.get("closed") is True else None,
        "fillColor": str(payload.get("fillColor") or "")[:64] or None,
        "points": points,
        "text": str(payload.get("text") or "")[:64000] or None,
        "fontSize": payload.get("fontSize"),
        "textAlign": payload.get("textAlign") if payload.get("textAlign") in ("left", "center", "right") else None,
        "noteHtml": str(payload.get("noteHtml") or "")[:64000] or None,
        "noteWidth": payload.get("noteWidth"), "noteHeight": payload.get("noteHeight"),
        "noteBackgroundColor": str(payload.get("noteBackgroundColor") or "")[:64] or None,
        "noteTextColor": str(payload.get("noteTextColor") or "")[:64] or None,
        "objectType": str(payload.get("objectType") or "")[:128] or None,
        "pluginId": str(payload.get("pluginId") or "")[:128] or None,
        "agentId": str(payload.get("agentId") or "")[:128] or None,
    }
    # Absent optionals must be OMITTED, never null. The backend stroke schema
    # uses zod .optional() (not .nullish()), so an explicit null fails
    # validation. These normalized strokes are re-emitted verbatim inside the
    # full-history payloads of undo-stroke/links-update, so a single null here
    # makes undo, delete, change_color and nudge fail with invalid_payload.
    return {k: v for k, v in stroke.items() if v is not None}


class AgentRoomSocket:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.sio = None
        self.socket_id: str = ""
        self.room_metadata: dict | None = None
        self.context: dict = {"roomId": room_id, "roomMetadata": None, "strokes": [],
                              "links": [], "chat": [], "members": {}, "persistedMembers": [],
                              "strokeCount": 0, "historyComplete": True,
                              "lastActivityAt": int(time.time() * 1000)}
        self.voice = None
        self._handlers: dict[str, set[Callable]] = defaultdict(set)
        self.context_lock = threading.RLock()
        self._event_queue: queue.Queue = queue.Queue()
        self._dispatch_thread: threading.Thread | None = None
        self._dispatcher_lock = threading.Lock()
        self._connected = False
        self._closed = False
        self._joined = False
        self._heartbeat: threading.Timer | None = None
        self._live_counts: dict[str, int] = {}

    # ---- lifecycle ----

    def connect(self) -> bool:
        import socketio  # type: ignore
        if self.sio is not None and self._joined:
            return True
        self._closed = False
        sio = socketio.Client(reconnection=True, reconnection_attempts=0,
                              reconnection_delay=1, reconnection_delay_max=5)
        self.sio = sio
        self._attach(sio)
        try:
            sio.connect(config.MAIN_BACKEND_SOCKET_URL, auth={
                "isAgent": True, "token": config.AGENT_SECRET,
                "agentId": "agent:chalkboard-master", "displayName": "Chalkboard Master (AI)",
            }, transports=["websocket", "polling"], wait_timeout=10)
        except Exception as exc:  # noqa: BLE001
            logger.warning("socket connect failed room=%s", self.room_id)
            return False
        deadline = time.time() + 15
        while time.time() < deadline:
            if self._joined:
                return True
            time.sleep(0.1)
        logger.warning("initial join timeout room=%s", self.room_id)
        return self._joined

    def _attach(self, sio) -> None:
        @sio.event
        def connect():
            self._connected = True
            try:
                self.socket_id = sio.sid or ""
            except Exception:
                pass
            logger.info("socket connected room=%s", self.room_id)
            self._do_join()

        @sio.event
        def connect_error(err):
            logger.warning("socket connect_error room=%s", self.room_id)
            if "unauthorized" in str(err).lower():
                logger.error(
                    "Agent socket unauthorized room=%s. Check that AGENT_SECRET in agent-service/.env "
                    "matches AGENT_SERVICE_SECRET in backend/.env",
                    self.room_id,
                )
                self.close()

        @sio.event
        def disconnect():
            self._connected = False
            logger.warning("socket disconnected room=%s", self.room_id)

        sio.on("room-history", self._on_room_history)
        sio.on("room-state", self._on_room_state)
        sio.on("chat:history", self._on_chat_history)
        sio.on("chat:message", self._on_chat_message)
        sio.on("update-users", self._on_update_users)
        sio.on("presence:count", lambda p: self._emit_local("presence:count", p))
        sio.on("stroke-start", self._on_stroke_start)
        sio.on("stroke-draw", lambda p: self._emit_local("stroke-draw", p))
        sio.on("undo-stroke", self._on_undo)
        sio.on("clear-board", self._on_clear)
        sio.on("links-update", self._on_links)
        sio.on("reaction:received", lambda p: self._emit_local("reaction:received", p))
        sio.on("raised-hands:update", lambda p: self._emit_local("raised-hands:update", p))
        sio.on("voice:invited", lambda p: self._emit_local("voice:invited", p))
        sio.on("voice:removed", lambda p: self._emit_local("voice:removed", p))
        sio.on("voice:speaker-added", lambda p: self._emit_local("voice:speaker-added", p))
        sio.on("room-members-updated", self._on_members_updated)
        sio.on("agent:activity", lambda p: self._emit_local("agent:activity", p))

    def _do_join(self) -> None:
        if self.sio is None or self._closed:
            return

        def _ack(res):
            if isinstance(res, dict) and res.get("ok"):
                if res.get("room"):
                    self.room_metadata = res["room"]
                    self.context["roomMetadata"] = res["room"]
                self._joined = True
                self._start_heartbeat()
                self._resync()

        try:
            self.sio.emit("join-room", {"roomId": self.room_id, "color": "#a3e5ff",
                                        "clientSessionId": f"agent-{self.room_id}"}, callback=_ack)
        except Exception as exc:  # noqa: BLE001
            logger.warning("join-room failed room=%s", self.room_id)

    def _resync(self) -> None:
        try:
            self.emit_with_ack("room:sync", {"roomId": self.room_id}, timeout_s=8)
        except Exception:
            pass

    def _start_heartbeat(self) -> None:
        if self._heartbeat is not None:
            return

        def _beat():
            if self._closed or not self._connected:
                return
            self._resync()
            self._heartbeat = threading.Timer(60.0, _beat)
            self._heartbeat.daemon = True
            self._heartbeat.start()

        self._heartbeat = threading.Timer(60.0, _beat)
        self._heartbeat.daemon = True
        self._heartbeat.start()

    def close(self) -> None:
        self._closed = True
        self._connected = False
        self._joined = False
        if self._heartbeat is not None:
            try:
                self._heartbeat.cancel()
            except Exception:
                pass
            self._heartbeat = None
        self._handlers.clear()
        if self.sio is not None:
            try:
                self.sio.disconnect()
            except Exception:
                pass
            self.sio = None

    def is_connected(self) -> bool:
        return self._connected and self.sio is not None and getattr(self.sio, "connected", False)

    # ---- events ----

    def on_socket_event(self, event: str, handler: Callable) -> None:
        self._handlers[event].add(handler)

    def _emit_local(self, event: str, payload: Any) -> None:
        """Queue a local event for the dispatcher thread and return immediately.

        Handlers must NEVER run on the thread that produced the event: the
        socket callbacks are wrapped in @_with_context_lock, so a blocking
        handler would run while context_lock is held and deadlock the
        reasoning pump, which needs that same lock to build prompts and run
        board tools (see THREADING.md — the 'Reasoning task timed out'
        incident). The single dispatcher thread preserves event ordering.
        """
        self._ensure_dispatcher()
        self._event_queue.put((event, payload))

    def _ensure_dispatcher(self) -> None:
        """Start (or restart) the dispatcher thread.

        The dispatcher retires itself when the socket is closed and idle. If
        this socket object is reused afterwards (reconnect flow, session
        restart), the thread must come back — otherwise every _emit_local
        event queues forever and the session silently stops reacting to chat
        mentions.
        """
        t = self._dispatch_thread
        if t is not None and t.is_alive():
            return
        with self._dispatcher_lock:
            t = self._dispatch_thread
            if t is not None and t.is_alive():
                return
            self._dispatch_thread = threading.Thread(
                target=self._dispatch_loop, daemon=True, name="socket-event-dispatch")
            self._dispatch_thread.start()

    def _dispatch_loop(self) -> None:
        current = threading.current_thread()
        while True:
            try:
                event, payload = self._event_queue.get(timeout=DISPATCH_IDLE_TIMEOUT_S)
            except queue.Empty:
                # Idle. Retire only when the socket is closed and nothing is
                # pending, under the same lock _ensure_dispatcher uses — that
                # closes the race where a dying consumer strands queued events.
                with self._dispatcher_lock:
                    if (self._closed and self._event_queue.empty()
                            and self._dispatch_thread is current):
                        self._dispatch_thread = None
                        return
                    continue
            if event is None:  # defensive: ignore poison placeholders
                continue
            for h in list(self._handlers.get(event, ())):
                try:
                    h(payload)
                except Exception:
                    # Never silent: a raising handler must be diagnosable from
                    # logs alone, since it runs off-thread with no caller.
                    logger.exception("local event handler failed event=%s room=%s",
                                     event, getattr(self, "room_id", "?"))

    def _push_full_stroke(self, stroke: dict) -> None:
        if any(st.get("id") == stroke.get("id") for st in self.context["strokes"]):
            return
        self.context["strokes"].append(stroke)
        if len(self.context["strokes"]) > MIRROR_STROKE_LIMIT:
            self.context["strokes"].pop(0)
            self.context["historyComplete"] = False
        self.context["strokeCount"] += 1
        self.context["lastActivityAt"] = int(time.time() * 1000)

    def _replace_history(self, raw_strokes: list) -> None:
        """Adopt a server-authoritative stroke list.

        Records whether the mirror ended up holding the WHOLE board. Anything
        beyond MIRROR_STROKE_LIMIT is invisible to the agent, and the board
        tools reconstruct full history from this mirror — so the flag is what
        stops an undo from deleting the strokes it never received.
        """
        valid = [st for st in (normalize_full_stroke(s) for s in raw_strokes) if st]
        self.context["strokes"] = valid[-MIRROR_STROKE_LIMIT:]
        self.context["strokeCount"] = len(valid)
        self.context["historyComplete"] = len(valid) <= MIRROR_STROKE_LIMIT
        self._live_counts.clear()

    @_with_context_lock
    def _on_room_history(self, payload) -> None:
        strokes = payload if isinstance(payload, list) else (payload or {}).get("strokes")
        if isinstance(strokes, list):
            self._replace_history(strokes)
            self.context["lastActivityAt"] = int(time.time() * 1000)

    @_with_context_lock
    def _on_room_state(self, payload) -> None:
        if isinstance((payload or {}).get("strokes"), list):
            self._replace_history(payload["strokes"])
        if isinstance((payload or {}).get("links"), list):
            self.context["links"] = [lnk for lnk in payload["links"]
                                     if isinstance(lnk, dict) and isinstance(lnk.get("id"), str)][-1000:]

    def _clean_chat(self, m: dict) -> dict | None:
        if not isinstance(m, dict) or not isinstance(m.get("id"), str) or not isinstance(m.get("message"), str):
            return None
        return {"id": str(m["id"])[:256], "userId": str(m.get("userId") or "")[:256] or None,
                "displayName": str(m.get("displayName") or "Classmate")[:128],
                "message": str(m["message"])[:2000],
                "createdAt": m.get("createdAt") or "",
                "mentionedUserIds": [x for x in (m.get("mentionedUserIds") or []) if isinstance(x, str)][:32]}

    @_with_context_lock
    def _on_chat_history(self, messages) -> None:
        if isinstance(messages, list):
            cleaned = [c for c in (self._clean_chat(m) for m in messages) if c]
            self.context["chat"] = cleaned[-25:]

    @_with_context_lock
    def _on_chat_message(self, msg) -> None:
        clean = self._clean_chat(msg or {})
        if not clean:
            return
        if any(m.get("id") == clean["id"] for m in self.context["chat"]):
            return
        self.context["chat"].append(clean)
        if len(self.context["chat"]) > 25:
            self.context["chat"].pop(0)
        self.context["lastActivityAt"] = int(time.time() * 1000)
        self._emit_local("chat:message", clean)

    @_with_context_lock
    def _on_update_users(self, users_map) -> None:
        if not users_map:
            return
        members = {}
        for sid, u in (users_map or {}).items():
            u = u or {}
            members[sid] = {"id": sid, "userId": u.get("userId") or sid,
                            "name": u.get("name") or "Classmate", "role": u.get("role") or "viewer"}
        self.context["members"] = members
        self._emit_local("update-users", users_map)

    @_with_context_lock
    def _on_stroke_start(self, payload) -> None:
        self.context["lastActivityAt"] = int(time.time() * 1000)
        full = normalize_full_stroke(payload or {})
        if full:
            self._push_full_stroke(full)
            self._emit_local("stroke-start", payload)
            return
        live_id = (payload or {}).get("strokeId") or (payload or {}).get("id")
        if isinstance(live_id, str) and live_id not in self._live_counts:
            self._live_counts[live_id] = 0
            self.context["strokeCount"] += 1
        self._emit_local("stroke-start", payload)

    @_with_context_lock
    def _on_undo(self, payload) -> None:
        if isinstance((payload or {}).get("strokes"), list):
            self._replace_history(payload["strokes"])
        self._emit_local("undo-stroke", payload)

    @_with_context_lock
    def _on_clear(self, _payload=None) -> None:
        self.context["strokes"] = []
        self.context["strokeCount"] = 0
        self.context["historyComplete"] = True
        self._live_counts.clear()
        self._emit_local("clear-board", {})

    @_with_context_lock
    def _on_links(self, payload) -> None:
        if isinstance((payload or {}).get("links"), list):
            self.context["links"] = [lnk for lnk in payload["links"] if isinstance(lnk, dict)][:1000]
        self._emit_local("links-update", payload)

    @_with_context_lock
    def _on_members_updated(self, payload) -> None:
        if isinstance((payload or {}).get("room"), dict):
            self.room_metadata = payload["room"]
            self.context["roomMetadata"] = payload["room"]
        if isinstance((payload or {}).get("members"), list):
            self.context["persistedMembers"] = payload["members"]
        self._emit_local("room-members-updated", payload)

    # ---- emits ----

    def send_chat_message(self, text: str) -> bool:
        if self.sio is None or not self._connected:
            return False
        done = threading.Event()
        outcome = {"ok": False}

        def _ack(res):
            outcome["ok"] = bool((res or {}).get("ok"))
            done.set()

        try:
            self.sio.emit("chat:send", {"roomId": self.room_id, "message": text, "mentionedUserIds": []}, callback=_ack)
            done.wait(timeout=8)
            return outcome["ok"]
        except Exception:
            return False

    def broadcast_activity(self, payload: dict) -> None:
        try:
            if self.sio is not None:
                self.sio.emit("agent:activity", {**payload, "roomId": self.room_id})
        except Exception:
            pass

    def broadcast_cursor(self, x, y=None) -> None:
        try:
            if self.sio is None:
                return
            if x is None:
                self.sio.emit("cursor-move", {"roomId": self.room_id, "cursor": None})
            else:
                self.sio.emit("cursor-move", {"roomId": self.room_id, "cursor": {"x": x, "y": y or 0}})
        except Exception:
            pass

    def emit_with_ack(self, event: str, payload: dict, timeout_s: float = 8) -> dict:
        if self.sio is None or not self._connected:
            return {"ok": False, "error": "not_connected"}
        done = threading.Event()
        outcome = {"result": {"ok": False, "error": "timeout"}}

        def _ack(res):
            outcome["result"] = res if isinstance(res, dict) else {"ok": True}
            done.set()

        try:
            self.sio.emit(event, payload, callback=_ack)
            done.wait(timeout=timeout_s)
            return outcome["result"]
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}
