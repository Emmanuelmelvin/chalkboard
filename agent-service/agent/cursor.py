"""Parallel cursor broadcasting engine (mirrors src/agent/cursorStreamer.ts)."""

from __future__ import annotations

import threading
import time

from agent.activity import extract_cursor_position

MAX_COORD = 10_000_000

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

    def glide_to(self, tx, ty, steps: int = 8, interval_ms: int = 25) -> None:
        tx, ty = _clamp(tx), _clamp(ty)
        with self._lock:
            self._generation += 1
            gen = self._generation
            sx, sy = self._x, self._y

        def _run():
            import math
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

        threading.Thread(target=_run, daemon=True).start()

    def stream_path(self, points: list, max_samples: int = 16, interval_ms: int = 30) -> None:
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

        def _run():
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

        threading.Thread(target=_run, daemon=True).start()

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
