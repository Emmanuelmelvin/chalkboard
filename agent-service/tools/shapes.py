"""Geometric shape stroke generators (mirrors src/tools/shapes.ts)."""

from __future__ import annotations

import math
import time
import uuid

BASE_RADIUS = 80


def generate_regular_polygon(sides: int, cx: float, cy: float, radius: float,
                             rotation: float = -math.pi / 2) -> list[dict]:
    points = []
    for i in range(sides):
        angle = rotation + (i / sides) * math.pi * 2
        points.append({
            "x": round((cx + radius * math.cos(angle)) * 10) / 10,
            "y": round((cy + radius * math.sin(angle)) * 10) / 10,
        })
    return points


def _base_stroke(points: list[dict], opts: dict, suffix: str = "", extra: dict | None = None) -> dict:
    stroke = {
        "id": f"agent-shape-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}{suffix}",
        "userId": opts.get("userId") or "agent:chalkboard-master",
        "tool": "chalk",
        "color": opts.get("color") or "#ffffff",
        "size": opts.get("size") or 3,
        "intensity": opts.get("intensity", 1),
        "points": points,
        "agentId": "chalkboard-master",
    }
    if extra:
        stroke.update(extra)
    return stroke


def generate_shape_strokes(opts: dict) -> list[dict]:
    shape = str(opts.get("shape") or "circle").lower()
    cx = opts.get("cx", 0) or 0
    cy = opts.get("cy", 0) or 0
    r = opts.get("radius") or BASE_RADIUS

    if shape == "triangle":
        return [_base_stroke(generate_regular_polygon(3, cx, cy, r), opts, "",
                             {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "square":
        return [_base_stroke(generate_regular_polygon(4, cx, cy, r, -math.pi / 4), opts, "",
                             {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "pentagon":
        return [_base_stroke(generate_regular_polygon(5, cx, cy, r), opts, "",
                             {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "hexagon":
        return [_base_stroke(generate_regular_polygon(6, cx, cy, r), opts, "",
                             {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "heptagon":
        return [_base_stroke(generate_regular_polygon(7, cx, cy, r), opts, "",
                             {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "octagon":
        return [_base_stroke(generate_regular_polygon(8, cx, cy, r, math.pi / 8), opts, "",
                             {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "nonagon":
        return [_base_stroke(generate_regular_polygon(9, cx, cy, r), opts, "",
                             {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "decagon":
        return [_base_stroke(generate_regular_polygon(10, cx, cy, r), opts, "",
                             {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "rectangle":
        half_w, half_h = r * 1.3, r * 0.8
        points = [
            {"x": cx - half_w, "y": cy - half_h},
            {"x": cx + half_w, "y": cy - half_h},
            {"x": cx + half_w, "y": cy + half_h},
            {"x": cx - half_w, "y": cy + half_h},
        ]
        return [_base_stroke(points, opts, "", {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "diamond":
        points = [
            {"x": cx, "y": cy - r * 1.1},
            {"x": cx + r * 0.8, "y": cy},
            {"x": cx, "y": cy + r * 1.1},
            {"x": cx - r * 0.8, "y": cy},
        ]
        return [_base_stroke(points, opts, "", {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "circle":
        points = []
        for i in range(36):
            angle = (i / 36) * math.pi * 2
            points.append({
                "x": round((cx + r * math.cos(angle)) * 10) / 10,
                "y": round((cy + r * math.sin(angle)) * 10) / 10,
            })
        return [_base_stroke(points, opts, "", {"pathType": "smooth", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "star":
        points = []
        for i in range(10):
            angle = (i / 10) * math.pi * 2 - math.pi / 2
            cur_r = r if i % 2 == 0 else r * 0.45
            points.append({
                "x": round((cx + cur_r * math.cos(angle)) * 10) / 10,
                "y": round((cy + cur_r * math.sin(angle)) * 10) / 10,
            })
        return [_base_stroke(points, opts, "", {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "line":
        return [_base_stroke([{"x": cx - r, "y": cy}, {"x": cx + r, "y": cy}], opts, "", {"pathType": "linear"})]
    if shape == "arrow":
        start_x, end_x = cx - r, cx + r
        arrow = r * 0.35
        shaft = _base_stroke([{"x": start_x, "y": cy}, {"x": end_x, "y": cy}], opts, "-shaft", {"pathType": "linear"})
        head = _base_stroke([
            {"x": end_x - arrow, "y": cy - arrow * 0.65},
            {"x": end_x, "y": cy},
            {"x": end_x - arrow, "y": cy + arrow * 0.65},
        ], opts, "-head", {"pathType": "linear"})
        return [shaft, head]
    if shape == "cross":
        arm, outer = r * 0.35, r
        points = [
            {"x": cx - arm, "y": cy - outer}, {"x": cx + arm, "y": cy - outer},
            {"x": cx + arm, "y": cy - arm}, {"x": cx + outer, "y": cy - arm},
            {"x": cx + outer, "y": cy + arm}, {"x": cx + arm, "y": cy + arm},
            {"x": cx + arm, "y": cy + outer}, {"x": cx - arm, "y": cy + outer},
            {"x": cx - arm, "y": cy + arm}, {"x": cx - outer, "y": cy + arm},
            {"x": cx - outer, "y": cy - arm}, {"x": cx - arm, "y": cy - arm},
        ]
        return [_base_stroke(points, opts, "", {"pathType": "linear", "closed": True, "fillColor": opts.get("fillColor")})]
    if shape == "heart":
        scale = r / 16
        points = []
        for i in range(40):
            t = (i / 40) * math.pi * 2
            x = 16 * math.sin(t) ** 3
            y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
            points.append({
                "x": round((cx + x * scale) * 10) / 10,
                "y": round((cy + y * scale) * 10) / 10,
            })
        return [_base_stroke(points, opts, "", {"pathType": "smooth", "closed": True, "fillColor": opts.get("fillColor")})]
    return generate_shape_strokes({**opts, "shape": "circle"})
