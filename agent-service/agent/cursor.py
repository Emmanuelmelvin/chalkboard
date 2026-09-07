"""Cursor broadcasting engine — human-speed, pen-synced (mirrors src/agent/cursorStreamer.ts).

A (blocking) path: glide_to_blocking / stream_path_blocking / hold are
sequential so the pen arrives where ink appears. Legacy async
glide_to / stream_path / start_parallel_tool_cursor remain for compat.
"""

from __future__ import annotations

import os
import threading
import time

from agent.activity import extract_cursor_position

MAX_COORD = 10_000_000

# Human-like defaults — pen arrives, ink appears, brief hold.
# CURSOR_SPEED scales every animation interval: 1.0 (default) = unchanged,
# 2.0 = twice as fast, 0.5 = slower. Individual values can be tuned with the
# env vars below; CURSOR_SPEED is the global knob (see THREADING.md sibling
# agent-service/.env.example for documented values).
def _cursor_speed() -> float:
    try:
        value = float(os.environ.get("CURSOR_SPEED", "1"))
    except (TypeError, ValueError):
        return 1.0
    return max(0.25, min(8.0, value))


_CURSOR_SPEED = _cursor_speed()


def _ms(base_ms: int, floor_ms: int = 8) -> int:
    return max(floor_ms, round(base_ms / _CURSOR_SPEED))


GLIDE_STEPS = 20
GLIDE_INTERVAL_MS = _ms(48)         # ~960ms total glide at speed 1.0
GLIDE_HOLD_MS = _ms(120, floor_ms=0)
DRAW_INTERVAL_MS = _ms(52)          # ~19 pts/sec when tracing after emit
POST_DRAW_INTERVAL_MS = _ms(36)     # faster flourish after ink
CHUNK_GLIDE_STEPS = 14
CHUNK_GLIDE_INTERVAL_MS = _ms(42)
CHUNK_PAUSE_MS = _ms(180, floor_ms=0)

VISUAL_TOOLS = {
    "chalkboard_draw_chalk",
    "chalkboard_write_text",
    "chalkboard_insert_shape",
    "chalkboard_create_note",
    "chalkboard_highlight_area",
    "chalkboard_move_cursor",
    "chalkboard_select_and_transform",
}


def is_visual_tool(tool_name: str) -> bool:
    return tool_name in VISUAL_TOOLS


def _clamp(n) -> int:
    try:
        f = float(n)
    except (TypeError, ValueError):
        return 0
    if f != f or f in (float("inf"), float("-inf")):
        return 0
    return max(-MAX_COORD, min(MAX_COORD, round(f)))


class ParallelCursorStreamer:
    def __init__(self, socket):
        self._socket = socket
        self._x = 0
        self._y = 0
        self._generation = 0
        self._lock = threading.Lock()

    def should_broadcast(self, tool_name: str) -> bool:
        return is_visual_tool(tool_name)

    def set_position(self, x, y) -> None:
        cx, cy = _clamp(x), _clamp(y)
        self._x, self._y = cx, cy
        self._socket.broadcast_cursor(cx, cy)

    # --- blocking (pen-synced) primitives ---

    def glide_to_blocking(self, tx, ty, steps: int = GLIDE_STEPS,
                          interval_ms: int = GLIDE_INTERVAL_MS) -> None:
        """Eased glide that blocks until the pen arrives."""
        import math
        tx, ty = _clamp(tx), _clamp(ty)
        with self._lock:
            self._generation += 1
            gen = self._generation
            sx, sy = self._x, self._y
        if math.hypot(tx - sx, ty - sy) < 5:
            self.set_position(tx, ty)
            return
        for step in range(1, steps + 1):
            with self._lock:
                if gen != self._generation:
                    return
            progress = min(1.0, step / steps)
            ease = 1 - (1 - progress) ** 3
            x = round(sx + (tx - sx) * ease)
            y = round(sy + (ty - sy) * ease)
            self._x, self._y = x, y
            try:
                self._socket.broadcast_cursor(x, y)
            except Exception:
                return
            time.sleep(interval_ms / 1000.0)

    def stream_path_blocking(self, points: list, max_samples: int = 24,
                             interval_ms: int = DRAW_INTERVAL_MS) -> None:
        """Trace a sampled path blocking — used after ink to show where pen went."""
        if not points:
            return
        step = max(1, len(points) // max_samples)
        sampled = [p for p in points[::step]
                   if isinstance(p, dict) and isinstance(p.get("x"), (int, float))]
        if not sampled:
            return
        with self._lock:
            self._generation += 1
            gen = self._generation
        for p in sampled:
            with self._lock:
                if gen != self._generation:
                    return
            self._x, self._y = _clamp(p["x"]), _clamp(p.get("y", 0))
            try:
                self._socket.broadcast_cursor(self._x, self._y)
            except Exception:
                return
            time.sleep(interval_ms / 1000.0)

    def hold(self, duration_ms: int = GLIDE_HOLD_MS) -> None:
        if duration_ms > 0:
            time.sleep(duration_ms / 1000.0)

    # --- legacy async (kept for compat) ---

    def glide_to(self, tx, ty, steps: int = 8, interval_ms: int = 25) -> None:
        threading.Thread(
            target=self.glide_to_blocking, args=(tx, ty, steps, interval_ms), daemon=True
        ).start()

    def stream_path(self, points: list, max_samples: int = 16, interval_ms: int = 30) -> None:
        threading.Thread(
            target=self.stream_path_blocking, args=(points, max_samples, interval_ms), daemon=True
        ).start()

    def start_parallel_tool_cursor(self, tool_name: str, args: dict) -> None:
        if not self.should_broadcast(tool_name):
            return
        if isinstance((args or {}).get("points"), list) and len(args["points"]) > 1:
            self.stream_path(args["points"])
            return
        target = extract_cursor_position(tool_name, args or {})
        if target:
            self.glide_to(target["x"], target["y"])

    def cancel_active_stream(self) -> None:
        with self._lock:
            self._generation += 1

    def return_to_default_dock(self) -> None:
        self.cancel_active_stream()
        try:
            self._socket.broadcast_cursor(None)
        except Exception:
            pass
