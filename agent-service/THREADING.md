# Threading rules for agent-service

These rules exist because of the **"Reasoning task timed out" deadlock**
(fixed 2026-09-07): every room invocation froze for `REASONING_TIMEOUT_S + 30`
because a handler blocked while `socket.context_lock` was held.

## The lock graph that deadlocked

```
socket dispatch thread            pump thread (asyncio.run)
-----------------------------     -----------------------------
_on_chat_message                  _run_reasoning
  holds context_lock                _build_prompt -> with context_lock  (BLOCKS)
  -> _handle_chat
  -> enqueue_reasoning_task
  -> task["done"].wait(150s)  (BLOCKS)
```

Each thread waited on something only the other could release.

## Rules

1. **Never block while holding `context_lock`** (or any lock, for that
   matter). That includes `Event.wait`, `queue.get`, network calls, and
   `enqueue_reasoning_task(..., wait=True)`.
2. **Local event handlers run on the `socket-event-dispatch` thread, never
   under `context_lock`.** `AgentRoomSocket._emit_local` only enqueues;
   `_dispatch_loop` invokes handlers. Keep it that way — a blocking handler
   must cost one stalled event, not the whole session. The dispatcher retires
   itself only when the socket is closed AND idle, and `_ensure_dispatcher`
   restarts it on the next event — never assume it is dead, and never poison
   its queue with stop sentinels (a FIFO sentinel strands every event queued
   behind it).
3. **`enqueue_reasoning_task` is fire-and-forget by default.** Only pass
   `wait=True` from a thread that holds no locks and genuinely needs the
   result (currently only the ephemeral-session lifecycle in `app.py`).
4. **Lock-hold watchdog**: every `@_with_context_lock` callback logs a
   warning when it holds the lock longer than 2s
   (`context_lock held ...s by ...`). Treat that warning as a bug.

## Guard tests (run in CI via `.github/workflows/agent-service-tests.yml`)

- `tests/test_core.py::test_enqueue_does_not_block_on_context_lock` —
  enqueue must return immediately while the caller holds `context_lock`.
- `tests/test_socket_events.py::test_emit_local_does_not_run_handlers_under_context_lock`
- `tests/test_socket_events.py::test_slow_handler_does_not_stall_socket_event_processing`
- `tests/test_socket_events.py::test_dispatcher_restarts_after_close` —
  chat events must flow again after close() + reconnect on the same socket.

If a change fails one of these, the change is re-introducing the deadlock —
fix the design, do not loosen the test.
