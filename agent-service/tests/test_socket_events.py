"""Socket event dispatching guard tests (offline).

These protect the threading contract that caused the 'Reasoning task timed
out' deadlock: local event handlers must never run on the thread that holds
socket.context_lock, and the socket callbacks must never stall behind a slow
handler. See agent-service/THREADING.md.
"""

import sys
import threading
import time
from collections import defaultdict
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.socket_client import AgentRoomSocket


def _bare_socket() -> AgentRoomSocket:
    s = AgentRoomSocket("room-guard")
    s._handlers = defaultdict(set)
    s.context_lock = threading.RLock()
    s._event_queue = __import__("queue").Queue()
    s._dispatch_thread = None
    s._dispatcher_lock = threading.Lock()
    return s


def test_emit_local_does_not_run_handlers_under_context_lock():
    s = _bare_socket()
    caller_released = threading.Event()
    seen = {}
    handled = threading.Event()

    def handler(payload):
        # The producer may legitimately still hold the lock while we are
        # already queued — the invariant under test is that the handler does
        # not run on the producer's thread/stack. Wait for it to release,
        # then verify the lock is actually free for us.
        caller_released.wait(5)
        seen["lock_free"] = s.context_lock.acquire(blocking=False)
        if seen["lock_free"]:
            s.context_lock.release()
        seen["thread"] = threading.current_thread()
        handled.set()

    s.on_socket_event("chat:message", handler)
    with s.context_lock:
        started = time.monotonic()
        s._emit_local("chat:message", {"id": "m1"})
        # _emit_local must return immediately even while the caller holds
        # context_lock — the old synchronous dispatch deadlocked here.
        assert time.monotonic() - started < 2.0
        caller_released.set()
    assert handled.wait(5), "handler never ran"
    assert seen["thread"] is not threading.main_thread(), (
        "handler ran synchronously on the producer thread")
    assert seen["lock_free"] is True, "handler ran while context_lock was held"


def test_slow_handler_does_not_stall_socket_event_processing():
    s = _bare_socket()
    release = threading.Event()
    arrived = threading.Event()

    def slow_handler(payload):
        release.wait(10)  # simulates a blocking wait in a handler

    def next_handler(payload):
        arrived.set()

    s.on_socket_event("chat:message", slow_handler)
    s.on_socket_event("update-users", next_handler)

    started = time.monotonic()
    s._on_chat_message({"id": "m1", "message": "hello"})  # dispatches to the slow handler
    s._on_update_users({"sid-1": {"userId": "u1", "role": "owner"}})
    dispatch_time = time.monotonic() - started
    release.set()

    assert dispatch_time < 2.0, (
        f"socket callbacks blocked {dispatch_time:.1f}s behind a slow handler — "
        "handlers are running on the socket thread again")
    assert arrived.wait(5), "queued event never dispatched"
    assert s.context["chat"][0]["id"] == "m1"


def test_dispatcher_restarts_after_close():
    """close() stops the dispatcher with a sentinel. If the same socket object
    is reused afterwards (reconnect flow / session restart), the dispatcher
    must come back — otherwise every chat mention queues forever and the agent
    silently ignores the room."""
    s = AgentRoomSocket("room-restart")
    got = threading.Event()
    s.on_socket_event("chat:message", lambda p: got.set())

    s._emit_local("chat:message", {"first": True})
    assert got.wait(5), "initial dispatch failed"
    s.close()

    # simulate a reconnect on the same instance: connect() + RoomSession.start()
    # re-register handlers, just like session._attach() does
    s._closed = False
    s._connected = True
    s.on_socket_event("chat:message", lambda p: got.set())
    got.clear()
    s._emit_local("chat:message", {"second": True})
    assert got.wait(5), "dispatcher did not restart after close() — chat events are being dropped"
