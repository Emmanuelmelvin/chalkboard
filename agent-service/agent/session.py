"""Persistent room session daemon (mirrors src/agent/roomSession.ts).

Owns one AgentRoomSocket + voice client + FIFO reasoning queue. Reasoning
runs in-process via agent.providers (Gemini or Bedrock) — no agent-brain.
"""

from __future__ import annotations

import asyncio
import re
import threading
import time
import uuid
from datetime import datetime, timezone

import config
from agent.board_runner import create_board_tool_stats, run_board_tool
from agent.cursor import ParallelCursorStreamer
from agent.prompt import build_reasoning_message
from agent.sanitize import get_friendly_error_message, sanitize_chat_message, strip_narration
from agent.socket_client import AgentRoomSocket
from errors import AgentError
from logger import logger
from memory.store import create_lesson_store, merge_lessons
from system_info import get_policy_metadata
from tools.definitions import TOOL_SPECS
from voice.transcriber import is_agent_addressed

_MENTION = re.compile(r"(?:^|\s)@(Chalkboard\s*Master|chalkboard-master|master|ai|agent)(?:\s|$|[:,])", re.I)
_SLASH = re.compile(r"^/(ask|teach|draw|solve|master|ai|help)\b", re.I)


class RoomSession:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.state = "INITIALIZING"
        self._lessons = create_lesson_store()
        self.socket = AgentRoomSocket(room_id)
        self.cursor = ParallelCursorStreamer(self.socket)
        from voice.client import AgentVoiceClient
        self.voice = AgentVoiceClient()
        self.socket.voice = self.voice
        self.voice.on_transcript = lambda t: self._handle_voice_transcript(t)
        self._processing = False
        self._queue: list[dict] = []
        self._gc_timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self._stopped = False
        self._active_task: dict | None = None
        self.current_model = (config.get_model_waterfall() or [""])[0]
        self.tasks_completed = 0
        self.tasks_failed = 0
        self.tool_calls = 0
        self.total_turns = 0
        self.last_task_at: str | None = None
        self.last_prompt_metadata: dict = {}
        self.lesson_history: list[dict] = []

    # ---- lifecycle ----

    def start(self) -> bool:
        try:
            with self._lock:
                self._stopped = False
            self.state = "INITIALIZING"
            logger.info("RoomSession starting room=%s", self.room_id)
            if not self.socket.connect():
                self.state = "ERROR"
                return False
            self._attach()
            self.state = "IDLE_OBSERVING"
            try:
                if (self.socket.context.get("roomMetadata") or {}).get("voiceEnabled", True) is not False:
                    threading.Thread(target=self.voice.join, args=(self.room_id,), daemon=True).start()
            except Exception:
                pass
            self._hydrate_memory()
            logger.info("RoomSession observing room=%s tools=%d", self.room_id, len(TOOL_SPECS))
            return True
        except Exception as exc:  # noqa: BLE001
            logger.exception("RoomSession start failed room=%s: %s", self.room_id, exc)
            self.state = "ERROR"
            return False

    def stop(self) -> None:
        # asyncio tasks cannot be safely killed from this thread.  Mark active
        # and queued work cancelled so no further model-selected tool can
        # mutate the room after /stop has returned.
        with self._lock:
            self._stopped = True
            for task in self._queue:
                task["cancelEvent"].set()
                task["error"] = AgentError("agent_stopped", "Agent session stopped")
                task["done"].set()
            self._queue.clear()
            if self._active_task is not None:
                self._active_task["cancelEvent"].set()
        if self._gc_timer is not None:
            try:
                self._gc_timer.cancel()
            except Exception:
                pass
            self._gc_timer = None
        try:
            self.cursor.cancel_active_stream()
            self.socket.broadcast_cursor(None)
        except Exception:
            pass
        self.state = "DISCONNECTED"
        try:
            self.voice.leave()
        except Exception:
            pass
        try:
            self.socket.close()
        except Exception:
            pass

    def _hydrate_memory(self) -> None:
        try:
            lessons = self._lessons.load_lessons(self.room_id, 5)
            stats = self._lessons.load_stats(self.room_id)
            if lessons:
                self.lesson_history = merge_lessons(self.lesson_history, lessons, 5)
            if stats:
                self.tasks_completed = stats.get("tasksCompleted", 0)
                self.tasks_failed = stats.get("tasksFailed", 0)
                self.tool_calls = stats.get("toolCalls", 0)
                self.total_turns = stats.get("totalTurns", 0)
                self.last_task_at = stats.get("updatedAt")
        except Exception as exc:  # noqa: BLE001
            logger.warning("memory hydration failed room=%s: %s", self.room_id, exc)

    def _persist_memory(self, entry: dict) -> None:
        try:
            self._lessons.append_lesson(self.room_id, entry)
            self._lessons.save_stats(self.room_id, {
                "tasksCompleted": self.tasks_completed, "tasksFailed": self.tasks_failed,
                "toolCalls": self.tool_calls, "totalTurns": self.total_turns,
                "updatedAt": self.last_task_at or datetime.now(timezone.utc).isoformat()})
        except Exception:
            pass

    # ---- listeners ----

    def _attach(self) -> None:
        self.socket.on_socket_event("chat:message", self._handle_chat)
        self.socket.on_socket_event("update-users", self._handle_presence)
        self.socket.on_socket_event("presence:count", lambda p: self._handle_presence_count(
            (p or {}).get("count", len(self.socket.context.get("members", {})))
            if isinstance(p, dict) else len(self.socket.context.get("members", {}))))
        self.socket.on_socket_event("voice:invited", lambda p: self._on_voice_invite(p, True))
        self.socket.on_socket_event("voice:removed", lambda p: self._on_voice_invite(p, False))

    def _on_voice_invite(self, payload, invited: bool) -> None:
        if isinstance(payload, dict) and payload.get("roomId") and payload["roomId"] != self.room_id:
            return
        self.voice.set_invited(invited, self.room_id)
        try:
            self.socket.send_chat_message(
                "Thanks — I can speak in voice now! Ask me anything and I'll answer out loud."
                if invited else "Understood — I'll stay quiet and keep listening. Ping me in chat anytime!")
        except Exception:
            pass

    def _handle_presence(self, users_map) -> None:
        humans = [u for u in (users_map or {}).values()
                  if not str((u or {}).get("userId") or "").startswith("agent:")]
        self._handle_presence_count(len(humans))

    def _handle_presence_count(self, count: int) -> None:
        if count <= 0:
            if self._gc_timer is None:
                logger.info("room empty, scheduling GC room=%s", self.room_id)
                self._gc_timer = threading.Timer(5 * 60, self.stop)
                self._gc_timer.daemon = True
                self._gc_timer.start()
        elif self._gc_timer is not None:
            try:
                self._gc_timer.cancel()
            except Exception:
                pass
            self._gc_timer = None

    def _resolve_role(self, msg: dict) -> str:
        meta = self.socket.context.get("roomMetadata") or {}
        owner_id = meta.get("ownerId")
        if msg.get("userId") and owner_id and msg["userId"] == owner_id:
            return "owner"
        for u in self.socket.context.get("members", {}).values():
            match_id = bool(msg.get("userId") and (u.get("userId") == msg["userId"] or u.get("id") == msg["userId"]))
            if match_id and u.get("role") in ("owner", "instructor", "viewer"):
                return u["role"]
        for m in self.socket.context.get("persistedMembers", []) or []:
            if not isinstance(m, dict):
                continue
            if msg.get("userId") and m.get("userId") == msg["userId"]:
                if m.get("role") in ("owner", "instructor", "viewer"):
                    return m["role"]
        # Room events are untrusted until their stable user ID can be matched
        # against room membership.  Never promote based on a display name or a
        # room-wide default role.
        return "viewer"

    def _handle_chat(self, msg: dict) -> None:
        if not (msg or {}).get("message"):
            return
        if str(msg.get("userId") or "").startswith("agent:") or "chalkboard-master" in str(msg.get("userId") or ""):
            return
        raw = msg["message"].strip()
        mentioned = isinstance(msg.get("mentionedUserIds"), list) and any(
            m in ("agent:chalkboard-master", "chalkboard-master", "__all__") for m in msg["mentionedUserIds"])
        if not (mentioned or _MENTION.search(raw) or _SLASH.search(raw)):
            return
        role = self._resolve_role(msg)
        logger.info("invoked room=%s user=%s", self.room_id, msg.get("displayName"))
        clean = _MENTION.sub(" ", raw)
        clean = _SLASH.sub("", clean).strip()[:2000] or "Hello! How can I assist with the chalkboard lesson today?"
        self._handle_invocation(msg, clean, role, "chat")

    def _handle_voice_transcript(self, t: dict) -> None:
        raw = str((t or {}).get("text") or "").strip()[:2000]
        if not raw or not is_agent_addressed(raw):
            return
        entry = {"id": f"voice-{uuid.uuid4().hex[:8]}", "userId": t.get("participantIdentity"),
                 "displayName": str(t.get("participantName") or "Classmate")[:128], "message": raw}
        if str(entry.get("userId") or "").startswith("agent:"):
            return
        self._handle_invocation(entry, raw, self._resolve_role(entry), "voice")

    def _handle_invocation(self, chat_entry: dict, prompt: str, invoker_role: str, modality: str = "chat") -> None:
        role = invoker_role if invoker_role in ("owner", "viewer") else "instructor"
        if self._processing:
            try:
                self.socket.send_chat_message(
                    f"Got it, {chat_entry.get('displayName')} — queued behind the current board work, I'll get to you next!")
            except Exception:
                pass
        try:
            self.enqueue_reasoning_task(prompt, chat_entry.get("displayName") or "Classmate", role, modality,
                                        notify_on_failure=True)
        except Exception as exc:  # noqa: BLE001
            logger.exception("reasoning error room=%s: %s", self.room_id, exc)
            try:
                self.socket.send_chat_message(get_friendly_error_message(chat_entry.get("displayName") or "Classmate"))
            except Exception:
                pass

    # ---- queue ----

    def enqueue_reasoning_task(self, prompt: str, requested_by: str,
                               invoker_role: str = "instructor", modality: str = "chat",
                               wait: bool = False, notify_on_failure: bool = False) -> dict:
        """Queue one reasoning task. Returns immediately by default.

        Invocation handlers run on the socket event-dispatch thread while that
        thread holds socket.context_lock (see @_with_context_lock in
        socket_client.py). Blocking here deadlocks the pump: _build_prompt and
        every board tool need that same lock, so the reasoning task cannot
        start until the caller's wait expires (~REASONING_TIMEOUT_S + 30).
        Only opt-in callers that hold no locks (ephemeral session lifecycle in
        app.py) may pass wait=True.
        """
        with self._lock:
            if self._stopped or self.state in ("DISCONNECTED", "ERROR"):
                raise AgentError("agent_stopped", "Agent session is not active")
            if len(self._queue) >= 5:
                raise AgentError("agent_busy", "Agent is busy — please try again in a moment.")
            task = {"requestId": uuid.uuid4().hex, "prompt": prompt, "requestedBy": requested_by,
                    "invokerRole": invoker_role, "modality": modality,
                    "notifyOnFailure": notify_on_failure,
                    "enqueuedAt": time.time(), "done": threading.Event(), "result": None, "error": None,
                    "cancelEvent": threading.Event()}
            self._queue.append(task)
        threading.Thread(target=self._pump, daemon=True).start()
        if wait:
            if not task["done"].wait(timeout=config.REASONING_TIMEOUT_S + 30):
                task["cancelEvent"].set()
                raise AgentError("reasoning_timeout", "Reasoning task timed out")
            if task["error"] is not None:
                raise task["error"]
            return task["result"] or {"success": True, "turns": 0}
        return {"requestId": task["requestId"], "queued": True}

    def _pump(self) -> None:
        with self._lock:
            if self._processing or not self._queue:
                return
            task = self._queue.pop(0)
            if task["cancelEvent"].is_set() or self._stopped:
                task["error"] = AgentError("agent_stopped", "Agent session stopped")
                task["done"].set()
                more = bool(self._queue)
                task = None
            else:
                more = False
                self._processing = True
                self._active_task = task
                self.state = "ACTIVE_REASONING"
        if task is None:
            if more:
                self._pump()
            return
        try:
            logger.debug("reasoning start room=%s", self.room_id)
            result = asyncio.run(asyncio.wait_for(
                self._run_reasoning(task["prompt"], task["requestedBy"], task["invokerRole"],
                                    task["requestId"], task["modality"], task["cancelEvent"]),
                timeout=config.REASONING_TIMEOUT_S))
            self.tasks_completed += 1
            self.total_turns += result.get("turns", 0)
            self.last_task_at = datetime.now(timezone.utc).isoformat()
            entry = {"prompt": task["prompt"][:160], "requester": task["requestedBy"][:64],
                     "turns": result.get("turns", 0), "model": self.current_model, "at": self.last_task_at}
            self.lesson_history.append(entry)
            if len(self.lesson_history) > 5:
                self.lesson_history.pop(0)
            self._persist_memory(entry)
            task["result"] = result
        except Exception as exc:  # noqa: BLE001
            self.tasks_failed += 1
            logger.exception("reasoning failed room=%s req=%s: %s", self.room_id, task["requestId"], exc)
            task["error"] = exc
            # The invoking thread no longer waits on the result, so failure
            # notification to the room moves here. Skipped when the task was
            # cancelled via /stop — nobody wants a chat bubble after that.
            if task.get("notifyOnFailure") and not task["cancelEvent"].is_set():
                try:
                    self.socket.send_chat_message(get_friendly_error_message(task["requestedBy"]))
                except Exception:
                    pass
        finally:
            task["done"].set()
            with self._lock:
                self._processing = False
                self._active_task = None
                if not self._stopped:
                    self.state = "IDLE_OBSERVING"
                more = bool(self._queue)
            if more:
                self._pump()

    def execute_board_tool(self, tool_name: str, args: dict, invoker_role: str, request_id: str):
        stats = create_board_tool_stats()
        return run_board_tool({"socket": self.socket, "cursorStreamer": self.cursor,
                               "invokerRole": invoker_role, "requestId": request_id,
                               "maxTurns": config.MAX_TURNS_PER_INSTRUCTION},
                              stats, tool_name, args or {})

    # ---- reasoning ----

    async def _run_reasoning(self, prompt: str, requested_by: str, invoker_role: str,
                             request_id: str, modality: str = "chat",
                             task_cancel_event: threading.Event | None = None) -> dict:
        from agent import providers
        message, safe_requester, prompt_metadata = self._build_prompt(
            prompt, requested_by, invoker_role, modality)
        self.last_prompt_metadata = prompt_metadata
        logger.info("prompt compiled room=%s chars=%s chat=%s/%s history=%s/%s request_truncated=%s",
                    self.room_id, prompt_metadata["promptChars"], prompt_metadata["recentChatIncluded"],
                    prompt_metadata["recentChatDropped"], prompt_metadata["lessonHistoryIncluded"],
                    prompt_metadata["lessonHistoryDropped"], prompt_metadata["requestTruncated"])
        logger.debug("reasoning with provider=%s room=%s", config.LLM_PROVIDER, self.room_id)
        try:
            self.socket.broadcast_activity({"stage": "thinking", "thought": "Analyzing classroom request...",
                                            "requestId": request_id})
        except Exception:
            pass
        try:
            stats = create_board_tool_stats()
            ctx = {"socket": self.socket, "cursorStreamer": self.cursor, "invokerRole": invoker_role,
                   "requestId": request_id, "maxTurns": config.MAX_TURNS_PER_INSTRUCTION,
                   "cancelEvent": task_cancel_event, "promptMetadata": prompt_metadata}
            outcome = await providers.run_reasoning(message, safe_requester, ctx, stats, request_id,
                                                    config.MAX_TURNS_PER_INSTRUCTION)
            if task_cancel_event is not None and task_cancel_event.is_set():
                raise AgentError("agent_stopped", "Agent session stopped")
            self.current_model = outcome.get("model") or self.current_model
            self.tool_calls += stats.get("toolCalls", 0)
            final_text = stats.get("finalAnswer") or outcome.get("finalText") or ""
            delivery = self._deliver_final_response(final_text, stats, modality, safe_requester)
            try:
                self.socket.broadcast_activity({"stage": "completed", "thought": "Done", "requestId": request_id})
                self.cursor.return_to_default_dock()
            except Exception:
                pass
            return {"success": True, "turns": outcome.get("turns", 0), "delivery": delivery,
                    "policy": outcome.get("policy", {}), "prompt": outcome.get("prompt", {})}
        finally:
            try:
                self.cursor.cancel_active_stream()
                self.socket.broadcast_cursor(None)
                self.socket.broadcast_activity({"stage": "idle"})
            except Exception:
                pass

    def _deliver_final_response(self, final_text: str, stats: dict, modality: str,
                                requester: str) -> str:
        """Deliver a model final answer exactly once through the approved channel."""
        if stats.get("chatDelivered"):
            return "chat-tool"
        if modality == "voice" and stats.get("voiceDelivered"):
            return "voice-tool"
        stripped = strip_narration(final_text)
        clean = sanitize_chat_message(stripped) if stripped else None
        if not clean:
            return "none"
        if modality == "voice" and getattr(self.voice, "can_speak", False):
            try:
                spoken = self.voice.speak(clean, self.room_id)
                if spoken.get("delivered"):
                    return "voice"
            except Exception as exc:  # noqa: BLE001
                logger.warning("final voice delivery failed room=%s: %s", self.room_id, exc)
        # Chat is the approved default and the safe fallback when voice is not
        # connected or cannot publish. Never claim a delivery that failed.
        if self.socket.send_chat_message(clean):
            return "chat"
        logger.warning("final chat delivery failed room=%s requester=%s", self.room_id, requester)
        return "failed"

    def _build_prompt(self, prompt: str, requested_by: str, invoker_role: str,
                      modality: str = "chat") -> tuple[str, str, dict]:
        lock = getattr(self.socket, "context_lock", None)
        if lock is None:
            source = self.socket.context
            context = dict(source)
        else:
            with lock:
                source = self.socket.context
                context = {
                    "roomMetadata": dict(source.get("roomMetadata") or {}),
                    "strokes": list(source.get("strokes") or []),
                    "chat": [dict(item) for item in source.get("chat", []) if isinstance(item, dict)],
                    "members": {key: dict(value) for key, value in (source.get("members") or {}).items()
                                if isinstance(value, dict)},
                    "strokeCount": source.get("strokeCount", 0),
                }
        return build_reasoning_message(
            room_id=self.room_id, prompt=prompt, requested_by=requested_by,
            invoker_role=invoker_role, modality=modality, context=context,
            lesson_history=list(self.lesson_history), voice_state=self.voice.state,
            voice_can_speak=bool(getattr(self.voice, "can_speak", False)),
            tool_count=len(TOOL_SPECS), include_metadata=True,
        )

    def get_status(self) -> dict:
        policy = get_policy_metadata()
        return {"roomId": self.room_id, "roomMetadata": self.socket.context.get("roomMetadata"),
                "state": self.state, "isProcessing": self._processing, "queuedTasks": len(self._queue),
                "connected": self.socket.is_connected(), "toolsCount": len(TOOL_SPECS),
                "activeUsersCount": len(self.socket.context.get("members", {})),
                "strokeCount": self.socket.context.get("strokeCount", 0),
                "recentChatCount": len(self.socket.context.get("chat", [])),
                "lastActivityAt": datetime.fromtimestamp(
                    self.socket.context.get("lastActivityAt", int(time.time() * 1000)) / 1000,
                    tz=timezone.utc).isoformat(),
                "tasksCompleted": self.tasks_completed, "tasksFailed": self.tasks_failed,
                "toolCalls": self.tool_calls, "totalTurns": self.total_turns,
                "lastTaskAt": self.last_task_at, "currentModel": self.current_model,
                "lessonHistoryCount": len(self.lesson_history), "memoryBackend": self._lessons.backend,
                "voiceState": self.voice.state, "voiceCanSpeak": self.voice.can_speak,
                "policy": {"version": policy["version"], "sha256": policy["sha256"]},
                "lastPrompt": self.last_prompt_metadata}
