"""Cursor broadcasting engine — human-speed, pen-synced.

All coordinates are CANVAS (world) coordinates — the same canonical space
the strokes use. Receiving clients convert to screen space with their own
zoom/pan, so the cursor stays aligned with ink under any viewport transform.

Blocking primitives (glide_to_blocking / trace_path_blocking / hold) run
sequentially so the pen arrives where ink appears:

    glide to stroke start (pen up, distance-aware duration)
      -> stroke-start  (pen down)
      -> trace the ACTUAL ink path; cursor-move and stroke-draw are emitted
         on the SAME ticks, so ink appears exactly under the cursor
      -> draw-stroke   (pen up, persists + relays the full stroke)

Cancellation is generation-based (cancel_active_stream); a cancelled trace
returns the points drawn so far so the caller can persist partial ink and
never leave a dangling "pen down" state.
"""

from __future__ import annotations

import math
import os
import random
import threading
import time

from agent.activity import extract_cursor_position

MAX_COORD = 10_000_000


def _cursor_speed() -> float:
    """Global speed knob, read per call so tests/runtime can retune live.

    CURSOR_SPEED scales every animation duration: 1.0 (default) = unchanged,
    2.0 = twice as fast, 0.5 = slower (see agent-service/.env.example).
    """
    try:
        value = float(os.environ.get("CURSOR_SPEED", "1"))
    except (TypeError, ValueError):
        return 1.0
    return max(0.25, min(8.0, value))


def _ms(base_ms: float, floor_ms: float = 8) -> int:
    return max(floor_ms, round(base_ms / _cursor_speed()))


# --- Movement model --------------------------------------------------------
# Pen-up glide: duration grows with travel distance, clamped so short hops
# stay snappy and long cross-board moves never feel sluggish.
GLIDE_BASE_MS = 120.0
GLIDE_PER_UNIT_MS = 0.9
GLIDE_MIN_MS = 140.0
GLIDE_MAX_MS = 900.0
# Pen-down tracing: near-constant human writing/hand-moving speed.
DRAW_UNITS_PER_SECOND = 1_300.0
DRAW_MIN_MS = 150.0
DRAW_MAX_MS = 6_000.0
# Internal animation tick (~60Hz) + wire broadcast throttle (~30Hz).
TICK_MS = 16
BROADCAST_MIN_INTERVAL_MS = 33
# Subtle quadratic-bezier curvature on pen-up glides (never on ink paths).
GLIDE_ARC_RATIO = 0.08
GLIDE_ARC_MAX_UNITS = 60.0
# Pause between consecutive pen-synced strokes (e.g. arrow shaft -> head).
STROKE_GAP_MS = 90
# Pen lingers where ink landed before moving on.
GLIDE_HOLD_MS = 120
# Pause between text chunks while live-writing.
CHUNK_PAUSE_MS = 180


def stroke_gap_s() -> float:
    """Speed-scaled pause between consecutive pen-synced strokes."""
    return _ms(STROKE_GAP_MS, floor_ms=0) / 1000.0

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


def glide_duration_ms(distance: float) -> int:
    """Distance-aware pen-up travel duration (already speed-scaled)."""
    if distance <= 0:
        return 0
    raw = GLIDE_BASE_MS + distance * GLIDE_PER_UNIT_MS
    return _ms(min(GLIDE_MAX_MS, max(GLIDE_MIN_MS, raw)), floor_ms=8)


def draw_duration_ms(distance: float) -> int:
    """Pen-down tracing duration for a path of `distance` canvas units."""
    if distance <= 0:
        return 0
    raw = (distance / DRAW_UNITS_PER_SECOND) * 1_000.0
    return _ms(min(DRAW_MAX_MS, max(DRAW_MIN_MS, raw)), floor_ms=8)


def _clamp(n) -> int:
    try:
        f = float(n)
    except (TypeError, ValueError):
        return 0
    if f != f or f in (float("inf"), float("-inf")):
        return 0
    return max(-MAX_COORD, min(MAX_COORD, round(f)))


def _clampf(n) -> float:
    try:
        f = float(n)
    except (TypeError, ValueError):
        return 0.0
    if f != f or f in (float("inf"), float("-inf")):
        return 0.0
    return max(-MAX_COORD, min(MAX_COORD, round(f, 2)))


def _ease_in_out(t: float) -> float:
    """Cubic ease-in/out — controlled acceleration and deceleration."""
    if t <= 0:
        return 0.0
    if t >= 1:
        return 1.0
    return 4 * t * t * t if t < 0.5 else 1 - ((-2 * t + 2) ** 3) / 2


def _draw_ease(t: float) -> float:
    """Near-constant writing speed with a soft start/stop (65% linear)."""
    smooth = t * t * (3 - 2 * t)
    return 0.65 * t + 0.35 * smooth


def _glide_path(sx: float, sy: float, tx: float, ty: float, steps: int) -> list:
    """Sampled quadratic-bezier path: subtle arc, exact endpoint, eased.

    The perpendicular bow is capped (<=8% of distance, <=60 units) so the
    cursor stays deliberate — never wandering through unrelated canvas.
    """
    dist = math.hypot(tx - sx, ty - sy)
    if steps < 1 or dist < 1:
        return [(tx, ty)]
    px, py = -(ty - sy) / dist, (tx - sx) / dist
    bow = min(GLIDE_ARC_MAX_UNITS, dist * GLIDE_ARC_RATIO)
    bow *= random.uniform(0.4, 1.0) * random.choice((-1.0, 1.0))
    cx = (sx + tx) / 2 + px * bow
    cy = (sy + ty) / 2 + py * bow
    samples = []
    for i in range(1, steps + 1):
        e = _ease_in_out(i / steps)
        inv = 1 - e
        samples.append((
            _clampf(inv * inv * sx + 2 * inv * e * cx + e * e * tx),
            _clampf(inv * inv * sy + 2 * inv * e * cy + e * e * ty),
        ))
    return samples


def _polyline_lengths(points: list) -> tuple[list, float]:
    lengths = [0.0]
    total = 0.0
    for a, b in zip(points, points[1:]):
        total += math.hypot(b[0] - a[0], b[1] - a[1])
        lengths.append(total)
    return lengths, total


def _point_at(points: list, lengths: list, s: float) -> tuple:
    for i in range(1, len(lengths)):
        if s <= lengths[i] or i == len(lengths) - 1:
            seg = lengths[i] - lengths[i - 1]
            if seg <= 0:
                return points[i - 1]
            t = (s - lengths[i - 1]) / seg
            a, b = points[i - 1], points[i]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return points[-1]


class ParallelCursorStreamer:
    def __init__(self, socket):
        self._socket = socket
        self._x = 0
        self._y = 0
        self._generation = 0
        self._lock = threading.Lock()
        self._last_broadcast = 0.0

    def should_broadcast(self, tool_name: str) -> bool:
        return is_visual_tool(tool_name)

    def _emit_position(self, x, y, final: bool = False) -> bool:
        """Broadcast a throttled cursor position (~30Hz) — exact on `final`."""
        now = time.monotonic()
        if not final and (now - self._last_broadcast) * 1000.0 < _ms(
                BROADCAST_MIN_INTERVAL_MS, floor_ms=1):
            return False
        self._last_broadcast = now
        cx, cy = _clampf(x), _clampf(y)
        self._x, self._y = cx, cy
        try:
            self._socket.broadcast_cursor(cx, cy)
            return True
        except Exception:
            return False

    def set_position(self, x, y) -> None:
        self._last_broadcast = time.monotonic()
        cx, cy = _clamp(x), _clamp(y)
        self._x, self._y = cx, cy
        self._socket.broadcast_cursor(cx, cy)

    # --- blocking (pen-synced) primitives ---

    def glide_to_blocking(self, tx, ty, steps: int | None = None,
                          interval_ms: int | None = None) -> None:
        """Eased, distance-aware glide that blocks until the pen arrives.

        `steps`/`interval_ms` are legacy overrides; when omitted the duration
        is derived from travel distance (glide_duration_ms) at ~60Hz ticks.
        """
        tx, ty = _clampf(tx), _clampf(ty)
        with self._lock:
            self._generation += 1
            gen = self._generation
            sx, sy = self._x, self._y
        dist = math.hypot(tx - sx, ty - sy)
        if dist < 5:
            self.set_position(tx, ty)
            return
        if steps is None:
            steps = max(3, round(glide_duration_ms(dist) / TICK_MS))
        step_ms = (interval_ms if interval_ms is not None else TICK_MS) / _cursor_speed()
        for gx, gy in _glide_path(sx, sy, tx, ty, steps):
            with self._lock:
                if gen != self._generation:
                    return
            self._emit_position(gx, gy)
            time.sleep(max(step_ms, 0.001) / 1000.0)
        # Exact arrival — the hotspot lands precisely on the target.
        self._emit_position(tx, ty, final=True)

    def trace_path_blocking(self, points: list, on_ink=None) -> list:
        """Pace along the ACTUAL ink polyline, blocking.

        The cursor follows the very coordinates the stroke uses — there is
        no second path. `on_ink(x, y)` fires on exactly the ticks where the
        cursor position is broadcast, so callers can emit stroke-draw events
        in lockstep: receivers see ink appear under the pen.

        Returns the traced points as [{'x', 'y'}] — the full path normally,
        truncated to what was actually drawn if cancelled.
        """
        pts = [(float(p["x"]), float(p.get("y", 0) or 0)) for p in (points or [])
               if isinstance(p, dict) and isinstance(p.get("x"), (int, float))]
        if not pts:
            return []
        with self._lock:
            self._generation += 1
            gen = self._generation
        lengths, total = _polyline_lengths(pts)
        # The pen is already at the exact start (the glide ended there) —
        # mark it as the first ink point so the persisted stroke keeps it.
        traced = [{"x": _clampf(pts[0][0]), "y": _clampf(pts[0][1])}]
        self._emit_position(pts[0][0], pts[0][1])
        if on_ink is not None:
            on_ink(pts[0][0], pts[0][1])
        if len(pts) == 1 or total < 0.5:
            return traced
        steps = max(2, round(draw_duration_ms(total) / TICK_MS))
        for i in range(1, steps + 1):
            with self._lock:
                if gen != self._generation:
                    return traced  # cancelled — caller persists partial ink
            s = _draw_ease(i / steps) * total
            x, y = _point_at(pts, lengths, s)
            traced.append({"x": _clampf(x), "y": _clampf(y)})
            emitted = self._emit_position(x, y, final=(i == steps))
            if on_ink is not None and (emitted or i == steps):
                on_ink(x, y)
            if i < steps:
                time.sleep(TICK_MS / 1000.0)
        return traced

    def hold(self, duration_ms: int = 120) -> None:
        if duration_ms > 0:
            time.sleep(duration_ms / 1000.0)

    # --- legacy async (kept for compat) ---

    def glide_to(self, tx, ty, steps: int = 8, interval_ms: int = 25) -> None:
        threading.Thread(
            target=self.glide_to_blocking, args=(tx, ty, steps, interval_ms), daemon=True
        ).start()

    def stream_path_blocking(self, points: list, max_samples: int = 24,
                             interval_ms: int = 16) -> None:
        """Legacy: trace a path blocking (no ink callback)."""
        self.trace_path_blocking(points)

    def start_parallel_tool_cursor(self, tool_name: str, args: dict) -> None:
        if not self.should_broadcast(tool_name):
            return
        if isinstance((args or {}).get("points"), list) and len(args["points"]) > 1:
            self.stream_path(args["points"])
            return
        target = extract_cursor_position(tool_name, args or {})
        if target:
            self.glide_to(target["x"], target["y"])

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
